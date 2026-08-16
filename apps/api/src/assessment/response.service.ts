import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  assessmentForbidden,
  assessmentNotFound,
  assessmentStateConflict,
} from './assessment.errors';
import { responseConflict, responseInvalid } from './response.errors';
import { LearningEventService } from '../learning-event/learning-event.service';

export type SubmitResponseInput = {
  sessionId: string;
  placementId: string;
  idempotencyKey: string;
  selectedOption?: string | null;
  questionVersionId?: string;
  score?: unknown;
  isCorrect?: unknown;
  answerKey?: unknown;
};

type PersistedResponse = {
  assessmentResponseId: string;
  assessmentSessionId: string;
  placementId: string;
  questionVersionId: string;
  submittedAt: Date;
};

@Injectable()
export class ResponseService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly learningEvents?: LearningEventService,
  ) {}
  async submit(
    userId: string,
    input: SubmitResponseInput,
    transactionClient?: Prisma.TransactionClient,
  ) {
    if (
      !userId ||
      !input.sessionId ||
      !input.placementId ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 200
    )
      responseInvalid();
    if ('score' in input || 'isCorrect' in input || 'answerKey' in input)
      responseInvalid();
    if (
      input.selectedOption !== undefined &&
      input.selectedOption !== null &&
      (typeof input.selectedOption !== 'string' ||
        input.selectedOption.length > 100)
    )
      responseInvalid();
    const canonical = JSON.stringify({
      sessionId: input.sessionId,
      placementId: input.placementId,
      selectedOption: input.selectedOption ?? null,
      questionVersionId: input.questionVersionId ?? null,
    });
    const fingerprint = createHash('sha256').update(canonical).digest('hex');
    try {
      const operation = async (tx: Prisma.TransactionClient) => {
        const existing = await tx.assessmentResponse.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) responseConflict();
          return { row: existing, replay: true };
        }
        const session = await tx.assessmentSession.findUnique({
          where: { assessmentSessionId: input.sessionId },
        });
        if (!session) assessmentNotFound();
        if (session!.ownerUserId !== userId) assessmentForbidden();
        const now = new Date();
        if (session!.state !== 'ACTIVE') assessmentStateConflict();
        if (session!.expiresAt && session!.expiresAt <= now) {
          await tx.assessmentSession.updateMany({
            where: {
              assessmentSessionId: input.sessionId,
              ownerUserId: userId,
              state: 'ACTIVE',
              lockVersion: session!.lockVersion,
            },
            data: {
              state: 'EXPIRED',
              endedAt: now,
              lockVersion: { increment: 1 },
            },
          });
          assessmentStateConflict('Assessment session has expired.');
        }
        const placement = await tx.assessmentSessionPlacement.findUnique({
          where: { assessmentSessionPlacementId: input.placementId },
          include: {
            questionVersion: {
              select: {
                questionVersionId: true,
                questionType: true,
                correctAnswerRef: true,
              },
            },
          },
        });
        if (!placement || placement.assessmentSessionId !== input.sessionId)
          responseInvalid('Placement is invalid.');
        if (
          input.questionVersionId &&
          input.questionVersionId !== placement!.questionVersionId
        )
          responseInvalid('Question version is invalid.');
        const q = placement!.questionVersion;
        if (q.questionType !== 'MULTIPLE_CHOICE' || !q.correctAnswerRef)
          responseInvalid('Question is not scorable.');
        const selected = input.selectedOption ?? null;
        const correctness =
          selected === null
            ? 'UNANSWERED'
            : selected === q.correctAnswerRef
              ? 'CORRECT'
              : 'INCORRECT';
        const score =
          correctness === 'CORRECT' ? 4 : correctness === 'INCORRECT' ? -1 : 0;
        const row = await tx.assessmentResponse.create({
          data: {
            userId,
            assessmentSessionId: input.sessionId,
            placementId: input.placementId,
            questionVersionId: placement!.questionVersionId,
            responsePayload: { selectedOption: selected },
            correctness,
            score,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            submittedAt: now,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            subjectUserId: userId,
            action: 'ASSESSMENT_RESPONSE_ACCEPTED',
            resourceType: 'ASSESSMENT_RESPONSE',
            resourceId: row.assessmentResponseId,
            metadata: {
              sessionId: input.sessionId,
              placementId: input.placementId,
              correctness,
              score,
            },
          },
        });
        if (this.learningEvents) {
          const eventBase = {
            schemaVersion: 1,
            occurredAt: now,
            learnerUserId: userId,
            actorUserId: userId,
            sourceComponent: 'C015',
            sourceAggregateType: 'AssessmentResponse',
            sourceAggregateId: row.assessmentResponseId,
            correlationId: input.sessionId,
            academicContext: {
              syllabusVersionId: session!.syllabusVersionId,
              questionVersionId: placement!.questionVersionId,
            },
          } as const;
          const submitted = await this.learningEvents.append(
            {
              ...eventBase,
              eventType: 'RESPONSE_SUBMITTED',
              idempotencyKey: `C015:RESPONSE_SUBMITTED:${row.assessmentResponseId}`,
              payload: {
                assessmentSessionId: input.sessionId,
                placementId: input.placementId,
                questionVersionId: placement!.questionVersionId,
                responseId: row.assessmentResponseId,
                attemptOrdinal: placement!.attemptNumber,
                submissionKind: selected === null ? 'UNANSWERED' : 'ANSWER',
              },
            },
            tx,
          );
          await this.learningEvents.append(
            {
              ...eventBase,
              eventType: 'RESPONSE_SCORED',
              causationId: submitted.eventId,
              idempotencyKey: `C015:RESPONSE_SCORED:${row.assessmentResponseId}`,
              payload: {
                assessmentSessionId: input.sessionId,
                placementId: input.placementId,
                questionVersionId: placement!.questionVersionId,
                responseId: row.assessmentResponseId,
                attemptOrdinal: placement!.attemptNumber,
                correctness,
                awardedScore: score,
                maximumScore: 4,
                answered: selected !== null,
              },
            },
            tx,
          );
        }
        return { row, replay: false };
      };
      const result = transactionClient
        ? await operation(transactionClient)
        : await this.db.$transaction(operation);
      return this.safe(result.row, result.replay);
    } catch (error) {
      if (
        !transactionClient &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.db.assessmentResponse.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing?.requestFingerprint === fingerprint)
          return this.safe(existing, true);
        responseConflict();
      }
      throw error;
    }
  }

  async getFeedback(userId: string, responseId: string) {
    const row = await this.db.assessmentResponse.findUnique({
      where: { assessmentResponseId: responseId },
      select: {
        assessmentResponseId: true,
        userId: true,
        assessmentSessionId: true,
        placementId: true,
        questionVersionId: true,
        correctness: true,
        responsePayload: true,
        session: { select: { state: true, ownerUserId: true } },
        questionVersion: {
          select: {
            correctAnswerRef: true,
            solutions: {
              select: { content: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!row) {
      assessmentNotFound();
      return undefined as never;
    }
    if (row.userId !== userId || row.session.ownerUserId !== userId)
      assessmentForbidden();
    if (row.session.state !== 'COMPLETED')
      return {
        responseId: row.assessmentResponseId,
        feedback: {
          correctness: 'HIDDEN',
          correctAnswer: 'HIDDEN',
          solution: 'HIDDEN',
        },
      };
    return {
      responseId: row.assessmentResponseId,
      feedback: {
        correctness: row.correctness,
        correctAnswer: row.questionVersion.correctAnswerRef,
        solution: row.questionVersion.solutions[0]?.content ?? null,
      },
    };
  }
  private safe(row: PersistedResponse, replay: boolean) {
    return {
      responseId: row.assessmentResponseId,
      sessionId: row.assessmentSessionId,
      placementId: row.placementId,
      questionVersionId: row.questionVersionId,
      status: replay ? 'REPLAYED' : 'ACCEPTED',
      submittedAt: row.submittedAt,
      feedback: { correctness: 'HIDDEN', score: 'HIDDEN' },
    };
  }
}
