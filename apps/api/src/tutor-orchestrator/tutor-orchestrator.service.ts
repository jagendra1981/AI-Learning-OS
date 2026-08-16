import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { GatewayResponse, StreamEvent } from '../ai-gateway/ai-gateway.types';
import { EvidenceService } from '../evidence/evidence.service';
import {
  TutorOrchestratorError,
  tutorError,
} from './tutor-orchestrator.errors';
import { TutorPolicyService } from './tutor-policy.service';
import { TutorToolGateway } from './tutor-tool-gateway.service';
import { AttachmentService } from '../attachment/attachment.service';
import {
  ObservationCode,
  TutorAction,
  TutorAuthoritativeSources,
  TutorInteraction,
  TutorRequest,
  TutorResponse,
  TutorRevalidation,
  TutorToolRequest,
  TutorStatus,
} from './tutor-orchestrator.types';

export const C032_PROMPT_ID = 'tutor.orchestrator';
export const C032_PROMPT_VERSION = '1.0.0';
const maxMessage = 4000;
const forbidden =
  /answerkey|answer_key|correctanswer|correct_answer|hiddensolution|hidden_solution|rubric|password|token|secret|apikey|api_key|cookie|authorization|chain.?of.?thought/i;

const defaultSources: TutorAuthoritativeSources = {
  async buildContext(request) {
    return {
      learnerId: request.learnerId,
      academicScope: request.academicScope,
      graphVersionId: null,
      learningState: null,
      evidenceSummary: null,
      activity: request.activity,
      question: request.question ?? null,
      assessment: request.assessment ?? null,
      learnerMessage: request.learnerMessage,
      freshness: { request: Date.now() },
    };
  },
  async revalidate(request) {
    return {
      learnerOwned: request.authenticatedLearnerId === request.learnerId,
      scopeValid: true,
      targetValid: !!request.target,
      assessmentAllows: true,
      cancelled: request.signal?.aborted ?? false,
      fresh: true,
    };
  },
  async readTool() {
    throw new TutorOrchestratorError(
      'TUTOR_TOOL_UNAVAILABLE',
      'Tool unavailable.',
      true,
    );
  },
};

@Injectable()
export class TutorOrchestratorService {
  private readonly sources: TutorAuthoritativeSources;
  constructor(
    private readonly ai: AiGatewayService,
    private readonly evidence: EvidenceService,
    private readonly policy: TutorPolicyService,
    @Optional() sources?: TutorAuthoritativeSources,
    @Optional() private readonly attachments?: AttachmentService,
  ) {
    this.sources = sources ?? defaultSources;
  }

  async execute(request: TutorRequest): Promise<TutorResponse> {
    this.authenticate(request);
    if (
      request.learnerMessage.length < 1 ||
      request.learnerMessage.length > maxMessage
    )
      tutorError('TUTOR_INVALID_OUTPUT', 'The learner request is invalid.');
    if (request.signal?.aborted)
      tutorError('TUTOR_CANCELLED', 'Tutor request cancelled.');
    const context = await this.sources.buildContext(request);
    if (request.attachmentIds?.length) {
      if (!this.attachments || request.activity === 'GRADED_ASSESSMENT')
        tutorError(
          'TUTOR_ASSESSMENT_RESTRICTED',
          'Attachments are restricted.',
        );
      const attachmentService = this.attachments!;
      context.attachments = [];
      for (const id of request.attachmentIds) {
        await attachmentService.bindForTutor(
          request.authenticatedLearnerId,
          id,
          request.sessionId,
          request.interactionId,
        );
        context.attachments.push(
          await attachmentService.consumeForTutor(
            request.authenticatedLearnerId,
            id,
            'TUTOR_IMAGE',
            request.activity !== 'GRADED_ASSESSMENT',
            request.sessionId,
            request.interactionId,
          ),
        );
      }
    }
    const decision = this.policy.resolve(context);
    const toolGateway = new TutorToolGateway(this.sources);
    let gateway: GatewayResponse | undefined;
    let raw: unknown;
    for (let turn = 0; turn < 2; turn += 1) {
      this.requireGate(
        request,
        'PRE_TOOL',
        await this.sources.revalidate(request, 'PRE_TOOL'),
      );
      gateway = this.ai.execute({
        promptId: C032_PROMPT_ID,
        promptVersion: C032_PROMPT_VERSION,
        input: context,
        outputMode: 'STRUCTURED',
        correlationId: request.correlationId,
        signal: request.signal,
        stubScenario: request.stubScenario,
      });
      if (gateway.status === 'CANCELLED')
        tutorError('TUTOR_CANCELLED', 'Tutor request cancelled.');
      if (gateway.status === 'FAILED') throw this.gatewayError(gateway);
      raw = gateway.output;
      const parsed = this.validateModelOutput(raw, decision);
      if (parsed.toolRequests?.length) {
        if (turn === 1 || parsed.toolRequests.length > 3)
          tutorError('TUTOR_TOOL_DENIED', 'Tool loop limit exceeded.');
        const toolState = await this.sources.revalidate(request, 'PRE_TOOL');
        this.requireGate(request, 'PRE_TOOL', toolState);
        if (!toolState.assessmentAllows)
          tutorError('TUTOR_ASSESSMENT_RESTRICTED', 'Tool use is restricted.');
        const results = [];
        for (const tool of parsed.toolRequests)
          results.push(
            await toolGateway.execute(
              tool,
              decision.allowTools,
              request.learnerId,
            ),
          );
        context.evidenceSummary = {
          ...(context.evidenceSummary ?? {}),
          toolResults: results,
        };
        continue;
      }
      const revalidated = await this.sources.revalidate(request, 'PRE_RELEASE');
      this.requireGate(
        request,
        'PRE_RELEASE',
        revalidated,
        decision.mode === 'ASSESSMENT_RESTRICTED',
      );
      const response = this.release(parsed, gateway, decision.mode);
      await this.handoffObservation(request);
      return response;
    }
    return tutorError(
      'TUTOR_INVALID_OUTPUT',
      'Tutor output was not releasable.',
    );
  }

  async stream(request: TutorRequest): Promise<StreamEvent[]> {
    this.authenticate(request);
    if (
      request.learnerMessage.length < 1 ||
      request.learnerMessage.length > maxMessage
    )
      tutorError('TUTOR_INVALID_OUTPUT', 'The learner request is invalid.');
    const context = await this.sources.buildContext(request);
    const decision = this.policy.resolve(context);
    this.requireGate(
      request,
      'PRE_RELEASE',
      await this.sources.revalidate(request, 'PRE_RELEASE'),
    );
    const events = this.ai.stream({
      promptId: C032_PROMPT_ID,
      promptVersion: C032_PROMPT_VERSION,
      input: context,
      outputMode: 'STREAM',
      correlationId: request.correlationId,
      signal: request.signal,
      stubScenario: request.stubScenario,
    });
    if (
      events.some(
        (event) => event.type === 'DELTA' && forbidden.test(event.delta ?? ''),
      )
    )
      return [
        {
          type: 'ERROR',
          executionId: events[0]?.executionId ?? 'unknown',
          error: {
            code: 'SAFETY_REJECTION',
            message: 'The tutor response was withheld for safety.',
            retryable: false,
            executionId: events[0]?.executionId ?? 'unknown',
            correlationId: request.correlationId,
          },
        },
      ];
    if (decision.mode === 'ASSESSMENT_RESTRICTED')
      return [
        { type: 'CANCELLED', executionId: events[0]?.executionId ?? 'unknown' },
      ];
    return events;
  }

  private authenticate(request: TutorRequest) {
    if (!request.authenticatedLearnerId)
      tutorError('TUTOR_AUTH_REQUIRED', 'Authentication required.');
    if (request.authenticatedLearnerId !== request.learnerId)
      tutorError('TUTOR_FORBIDDEN', 'Learner ownership mismatch.');
    if (
      !request.tutorActorId ||
      !request.sessionId ||
      !request.interactionId ||
      !request.correlationId
    )
      tutorError('TUTOR_FORBIDDEN', 'Tutor ownership context is incomplete.');
  }

  private requireGate(
    request: TutorRequest,
    gate: 'PRE_TOOL' | 'PRE_RELEASE' | 'PRE_OBSERVATION',
    value: TutorRevalidation,
    allowRestricted = false,
  ) {
    if (request.signal?.aborted || value.cancelled)
      tutorError('TUTOR_CANCELLED', 'Tutor request cancelled.');
    if (!value.learnerOwned || !value.scopeValid)
      tutorError('TUTOR_FORBIDDEN', 'Tutor scope is unauthorized.');
    if (!value.fresh)
      tutorError(
        'TUTOR_STALE_CONTEXT',
        `Tutor context is stale before ${gate}.`,
        true,
      );
    if (gate === 'PRE_RELEASE' && !value.assessmentAllows && !allowRestricted)
      tutorError('TUTOR_ASSESSMENT_RESTRICTED', 'Assistance is restricted.');
    if (
      gate === 'PRE_OBSERVATION' &&
      (!value.targetValid || !value.assessmentAllows)
    )
      tutorError('TUTOR_OBSERVATION_REJECTED', 'Observation is not eligible.');
  }

  private validateModelOutput(
    raw: unknown,
    decision: ReturnType<TutorPolicyService['resolve']>,
  ) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      tutorError('TUTOR_INVALID_OUTPUT', 'Tutor output is malformed.');
    const value = raw as Record<string, unknown>;
    const status = value.status;
    const message = value.message;
    const policyMode = value.policyMode;
    if (
      !['ANSWER', 'HINT', 'QUESTION', 'REFUSAL', 'DEGRADED'].includes(
        String(status),
      ) ||
      typeof message !== 'string' ||
      message.length < 1 ||
      message.length > 6000
    )
      tutorError('TUTOR_INVALID_OUTPUT', 'Tutor output failed validation.');
    const safeMessage = message as string;
    if (policyMode !== decision.mode || forbidden.test(safeMessage)) {
      if (
        decision.mode === 'ASSESSMENT_RESTRICTED' ||
        decision.status === 'REFUSAL'
      )
        return {
          status: 'REFUSAL' as TutorStatus,
          message: 'I cannot provide that assistance during this activity.',
          policyMode: decision.mode,
          actions: [],
          contextRefs: [],
          toolRequests: [],
        };
      tutorError(
        'TUTOR_INVALID_OUTPUT',
        'Tutor output failed policy validation.',
      );
    }
    const actions = Array.isArray(value.actions) ? value.actions : [];
    if (actions.length > 3)
      tutorError('TUTOR_INVALID_OUTPUT', 'Tutor action limit exceeded.');
    const safeActions: TutorAction[] = actions.map((action) => {
      if (!action || typeof action !== 'object')
        tutorError('TUTOR_INVALID_OUTPUT', 'Tutor action is malformed.');
      const a = action as Record<string, unknown>;
      if (
        ![
          'CONTINUE',
          'RETRY',
          'OPEN_PRACTICE',
          'OPEN_REVISION',
          'OPEN_PROGRESS',
          'STOP',
        ].includes(String(a.type)) ||
        typeof a.label !== 'string' ||
        a.label.length < 1 ||
        a.label.length > 80 ||
        (a.href !== undefined &&
          (typeof a.href !== 'string' ||
            a.href.length > 256 ||
            !a.href.startsWith('/')))
      )
        tutorError('TUTOR_INVALID_OUTPUT', 'Tutor action is invalid.');
      const type = a.type as TutorAction['type'];
      const label = a.label as string;
      const href = a.href as string | undefined;
      return { type, label, ...(href ? { href } : {}) };
    });
    const toolRequests = Array.isArray(value.toolRequests)
      ? (value.toolRequests as TutorToolRequest[])
      : [];
    if (toolRequests.length > 3)
      tutorError('TUTOR_TOOL_DENIED', 'Too many tool requests.');
    return {
      status: status as TutorStatus,
      message: message as string,
      policyMode: decision.mode,
      actions: safeActions,
      contextRefs: [],
      toolRequests,
    };
  }

  private release(
    parsed: ReturnType<TutorOrchestratorService['validateModelOutput']>,
    gateway: GatewayResponse,
    policyMode: TutorResponse['policyMode'],
  ): TutorResponse {
    return {
      status: parsed.status,
      message: parsed.message,
      policyMode,
      actions: parsed.actions,
      contextRefs: [],
      execution: {
        executionId: gateway.executionId,
        correlationId: gateway.error?.correlationId ?? gateway.executionId,
        stub: gateway.stub,
      },
      usage: gateway.usage,
    };
  }

  private gatewayError(gateway: GatewayResponse): TutorOrchestratorError {
    const code = gateway.error?.code;
    if (code === 'TIMEOUT')
      return new TutorOrchestratorError(
        'TUTOR_TIMEOUT',
        'Tutor timed out.',
        true,
      );
    if (code === 'RATE_LIMITED')
      return new TutorOrchestratorError(
        'TUTOR_RATE_LIMITED',
        'Tutor is rate limited.',
        true,
      );
    if (code === 'PROVIDER_UNAVAILABLE')
      return new TutorOrchestratorError(
        'TUTOR_UNAVAILABLE',
        'Tutor is temporarily unavailable.',
        true,
      );
    if (code === 'CANCELLED')
      return new TutorOrchestratorError(
        'TUTOR_CANCELLED',
        'Tutor request cancelled.',
      );
    return new TutorOrchestratorError(
      'TUTOR_INVALID_OUTPUT',
      'Tutor output was unavailable.',
    );
  }

  private async handoffObservation(request: TutorRequest): Promise<void> {
    const code = this.observationCode(
      request.interaction,
      request.explanationClassification,
      request.abandonmentRecorded,
    );
    if (!code || !request.target) return;
    const state = await this.sources.revalidate(request, 'PRE_OBSERVATION');
    this.requireGate(request, 'PRE_OBSERVATION', state);
    const fingerprint = [
      'c032:v1.2',
      request.learnerId,
      request.tutorActorId,
      request.sessionId,
      request.interactionId,
      code,
      request.target.type,
      request.target.id,
    ].join('|');
    const idempotencyKey = `c032obs_${createHash('sha256').update(fingerprint).digest('hex')}`;
    try {
      await this.evidence.processTutorObservation({
        learnerId: request.learnerId,
        tutorActorId: request.tutorActorId,
        observationCode: code,
        targetType: request.target.type,
        targetId: request.target.id,
        academicContext: request.academicContext,
        occurredAt: request.occurredAt,
        correlationId: request.correlationId,
        idempotencyKey,
      });
    } catch {
      throw new TutorOrchestratorError(
        'TUTOR_OBSERVATION_REJECTED',
        'Observation was not accepted.',
      );
    }
  }

  private observationCode(
    interaction: TutorInteraction | undefined,
    classification?: 'COMPLETE' | 'PARTIAL',
    abandoned?: boolean,
  ): ObservationCode | undefined {
    if (interaction === 'SELF_CORRECTION') return 'SELF_CORRECTION';
    if (interaction === 'EXPLANATION' && classification === 'COMPLETE')
      return 'EXPLANATION_COMPLETE';
    if (interaction === 'EXPLANATION' && classification === 'PARTIAL')
      return 'EXPLANATION_PARTIAL';
    if (interaction === 'REQUESTED_CLARIFICATION')
      return 'REQUESTED_CLARIFICATION';
    if (interaction === 'ABANDONED_ATTEMPT' && abandoned === true)
      return 'ABANDONED_ATTEMPT';
    return undefined;
  }
}
