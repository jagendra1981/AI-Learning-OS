import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StreamEvent } from '../ai-gateway/ai-gateway.types';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { TutorOrchestratorError } from './tutor-orchestrator.errors';
import { TutorOrchestratorService } from './tutor-orchestrator.service';
import {
  ActiveTutorInteraction,
  TutorInteractionRuntimeService,
} from './tutor-interaction-runtime.service';
import {
  TutorInteractionRequest,
  TutorInteractionResponse,
  TutorIntent,
  TutorStreamEvent,
  tutorIntents,
} from './tutor-serving.dto';
import { TutorInteraction, TutorRequest } from './tutor-orchestrator.types';
import { TutorAssessmentRestrictionService } from './tutor-assessment-restriction.service';

type SseResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  flushHeaders?(): void;
  write(value: string): boolean;
  end(): void;
};

const allowedFields = new Set([
  'sessionId',
  'interactionId',
  'message',
  'intent',
  'attachmentIds',
  'clientRequestId',
]);
const opaqueId = /^[A-Za-z0-9_-]{1,128}$/;

function invalid(): never {
  throw new BadRequestException({
    code: 'TUTOR_REQUEST_INVALID',
    message: 'Check the Tutor request and try again.',
  });
}

function parseRequest(value: unknown): TutorInteractionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((field) => !allowedFields.has(field))) invalid();
  if (typeof body.sessionId !== 'string' || !opaqueId.test(body.sessionId))
    invalid();
  if (
    typeof body.message !== 'string' ||
    body.message.trim().length < 1 ||
    body.message.trim().length > 4000
  )
    invalid();
  if (!tutorIntents.includes(body.intent as TutorIntent)) invalid();
  if (
    typeof body.clientRequestId !== 'string' ||
    !opaqueId.test(body.clientRequestId)
  )
    invalid();
  if (body.interactionId !== undefined) {
    if (
      typeof body.interactionId !== 'string' ||
      !opaqueId.test(body.interactionId)
    )
      invalid();
  }
  if (body.attachmentIds !== undefined) {
    if (
      !Array.isArray(body.attachmentIds) ||
      body.attachmentIds.length > 4 ||
      body.attachmentIds.some(
        (id) => typeof id !== 'string' || !opaqueId.test(id),
      )
    )
      invalid();
  }
  return {
    sessionId: body.sessionId,
    ...(body.interactionId ? { interactionId: body.interactionId } : {}),
    message: body.message.trim(),
    intent: body.intent as TutorIntent,
    ...(body.attachmentIds
      ? { attachmentIds: [...body.attachmentIds] as string[] }
      : {}),
    clientRequestId: body.clientRequestId,
  };
}

function interaction(intent: TutorIntent): TutorInteraction {
  const mapped: Record<TutorIntent, TutorInteraction> = {
    ASK_DOUBT: 'REQUESTED_CLARIFICATION',
    EXPLAIN: 'EXPLANATION_REQUESTED',
    HINT: 'HINT_REQUESTED',
    STRONGER_HINT: 'HINT_REQUESTED',
    WORKED_EXAMPLE: 'EXPLANATION_REQUESTED',
    DEBUG: 'DEBUG_ATTEMPT_SUBMITTED',
    RECOMMEND_NEXT: 'UNSUPPORTED',
  };
  return mapped[intent];
}

function requestedAssistance(intent: TutorIntent) {
  const mapped = {
    ASK_DOUBT: 'EXPLANATION',
    EXPLAIN: 'EXPLANATION',
    HINT: 'HINT',
    STRONGER_HINT: 'STRONGER_HINT',
    WORKED_EXAMPLE: 'WORKED_EXAMPLE',
    DEBUG: 'DEBUG_GUIDANCE',
    RECOMMEND_NEXT: 'RECOMMENDATION',
  } as const;
  return mapped[intent];
}

@Controller('api/tutor/interactions')
@UseGuards(AuthGuard)
export class TutorServingController {
  constructor(
    private readonly tutor: TutorOrchestratorService,
    private readonly runtime: TutorInteractionRuntimeService,
    private readonly assessmentRestriction?: TutorAssessmentRestrictionService,
  ) {}

  @Post()
  async submit(
    @Req() request: AuthenticatedRequest,
    @Body() rawBody: unknown,
  ): Promise<TutorInteractionResponse> {
    const body = parseRequest(rawBody);
    const auth = request.auth!;
    if (body.sessionId !== auth.sessionId)
      throw new ForbiddenException({
        code: 'TUTOR_SESSION_FORBIDDEN',
        message: 'This Tutor session is not available.',
      });
    if (body.interactionId)
      throw new ForbiddenException({
        code: 'TUTOR_INTERACTION_FORBIDDEN',
        message: 'This Tutor interaction is not available for continuation.',
      });
    await this.assertAssessmentAllowed(auth.userId);

    const active = this.runtime.accept(
      auth.userId,
      randomUUID(),
      randomUUID(),
      body,
    );
    return {
      interactionId: active.interactionId,
      sessionId: auth.sessionId,
      status: 'ACCEPTED',
      assistance: requestedAssistance(body.intent),
      uncertainty: 'NONE',
      retryable: false,
      ...(body.attachmentIds ? { attachmentIds: body.attachmentIds } : {}),
    };
  }

  @Get(':interactionId/stream')
  async stream(
    @Req() request: AuthenticatedRequest,
    @Param('interactionId') interactionId: string,
    @Res() response: SseResponse,
  ) {
    const active = this.authorize(request, interactionId);
    await this.assertAssessmentAllowed(request.auth!.userId);
    if (!this.runtime.begin(active))
      throw new ConflictException({
        code: 'TUTOR_STREAM_CONFLICT',
        message: 'This Tutor stream is no longer available.',
      });

    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    try {
      const events = await this.tutor.stream(this.c032Request(active));
      let terminalSent = false;
      for (const event of events) {
        const mapped = this.mapEvent(active, event);
        if (!mapped) continue;
        this.send(response, mapped);
        if (this.isTerminal(mapped)) {
          terminalSent = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (active.abort.signal.aborted) {
          this.send(response, {
            type: 'CANCELLED',
            interactionId: active.interactionId,
          });
          terminalSent = true;
          break;
        }
      }
      if (!terminalSent)
        this.send(response, {
          type: 'FAILED',
          interactionId: active.interactionId,
          retryable: false,
          message: 'The Tutor could not complete that request.',
        });
    } catch (error) {
      this.send(response, this.mapError(active, error));
    } finally {
      this.runtime.finish(active);
      response.end();
    }
  }

  private async assertAssessmentAllowed(learnerId: string) {
    if (
      this.assessmentRestriction &&
      !(await this.assessmentRestriction.isTutorAllowed(learnerId))
    )
      throw new ForbiddenException({
        code: 'TUTOR_ASSESSMENT_RESTRICTED',
        message: 'Tutor assistance is limited during this activity.',
      });
  }

  @Post(':interactionId/cancel')
  @HttpCode(202)
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('interactionId') interactionId: string,
  ) {
    const active = this.authorize(request, interactionId);
    return {
      interactionId,
      cancellationRequested: this.runtime.cancel(active),
    };
  }

  private authorize(request: AuthenticatedRequest, interactionId: string) {
    if (!opaqueId.test(interactionId)) throw new NotFoundException();
    const active = this.runtime.get(interactionId);
    if (!active) throw new NotFoundException();
    if (
      active.learnerId !== request.auth!.userId ||
      active.request.sessionId !== request.auth!.sessionId
    )
      throw new ForbiddenException({
        code: 'TUTOR_INTERACTION_FORBIDDEN',
        message: 'This Tutor interaction is not available.',
      });
    return active;
  }

  private c032Request(active: ActiveTutorInteraction): TutorRequest {
    return {
      learnerId: active.learnerId,
      authenticatedLearnerId: active.learnerId,
      tutorActorId: 'c032:tutor-orchestrator',
      sessionId: active.request.sessionId,
      interactionId: active.interactionId,
      correlationId: active.correlationId,
      academicScope: {},
      activity: 'GENERAL_LEARNING',
      learnerMessage: active.request.message,
      academicContext: {},
      occurredAt: new Date(),
      interaction: interaction(active.request.intent),
      attachmentIds: active.request.attachmentIds,
      signal: active.abort.signal,
    };
  }

  private mapEvent(
    active: ActiveTutorInteraction,
    event: StreamEvent,
  ): TutorStreamEvent | undefined {
    if (event.type === 'START')
      return { type: 'STARTED', interactionId: active.interactionId };
    if (event.type === 'DELTA')
      return {
        type: 'DELTA',
        interactionId: active.interactionId,
        text: event.delta ?? '',
      };
    if (event.type === 'COMPLETE')
      return { type: 'COMPLETED', interactionId: active.interactionId };
    if (event.type === 'CANCELLED')
      return { type: 'CANCELLED', interactionId: active.interactionId };
    if (event.type === 'ERROR') {
      if (event.error?.code === 'SAFETY_REJECTION')
        return {
          type: 'REFUSED',
          interactionId: active.interactionId,
          message: 'The Tutor cannot provide that assistance.',
        };
      if (
        event.error?.code === 'PROVIDER_UNAVAILABLE' ||
        event.error?.code === 'TIMEOUT'
      )
        return {
          type: 'UNCERTAINTY',
          interactionId: active.interactionId,
          state: 'AI_UNAVAILABLE',
          message: 'The Tutor is temporarily unavailable.',
        };
      const interrupted = event.error?.code === 'STREAM_INTERRUPTED';
      return {
        type: interrupted ? 'INTERRUPTED' : 'FAILED',
        interactionId: active.interactionId,
        retryable: event.error?.retryable ?? false,
        message: interrupted
          ? 'The Tutor response was interrupted.'
          : 'The Tutor could not complete that request.',
      };
    }
    return undefined;
  }

  private mapError(
    active: ActiveTutorInteraction,
    error: unknown,
  ): TutorStreamEvent {
    if (
      active.abort.signal.aborted ||
      (error instanceof TutorOrchestratorError &&
        error.code === 'TUTOR_CANCELLED')
    )
      return { type: 'CANCELLED', interactionId: active.interactionId };
    if (error instanceof TutorOrchestratorError) {
      if (error.code === 'TUTOR_ASSESSMENT_RESTRICTED')
        return {
          type: 'RESTRICTED',
          interactionId: active.interactionId,
          message: 'Tutor assistance is limited during this activity.',
        };
      if (error.code === 'TUTOR_POLICY_BLOCKED')
        return {
          type: 'REFUSED',
          interactionId: active.interactionId,
          message: 'The Tutor cannot provide that assistance.',
        };
      return {
        type: 'FAILED',
        interactionId: active.interactionId,
        retryable: error.retryable,
        message: 'The Tutor could not complete that request.',
      };
    }
    return {
      type: 'FAILED',
      interactionId: active.interactionId,
      retryable: false,
      message: 'The Tutor could not complete that request.',
    };
  }

  private send(response: SseResponse, event: TutorStreamEvent) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private isTerminal(event: TutorStreamEvent) {
    return [
      'COMPLETED',
      'CANCELLED',
      'INTERRUPTED',
      'REFUSED',
      'RESTRICTED',
      'FAILED',
    ].includes(event.type);
  }
}
