import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  learningEventConflict,
  learningEventForbidden,
  learningEventInvalid,
} from './learning-event.errors';

export const C019_EVENT_TYPES = [
  'RESPONSE_SUBMITTED',
  'RESPONSE_SCORED',
  'DIAGNOSTIC_STARTED',
  'DIAGNOSTIC_ANSWER_PROCESSED',
  'DIAGNOSTIC_COMPLETED',
  'PRACTICE_STARTED',
  'PRACTICE_QUESTION_PRESENTED',
  'PRACTICE_RESPONSE_PROCESSED',
  'PRACTICE_HINT_CONSUMED',
  'PRACTICE_RETRY_CONSUMED',
  'PRACTICE_COMPLETED',
  'TEST_STARTED',
  'TEST_RESPONSE_PROCESSED',
  'TEST_COMPLETED',
];
const TYPES = new Set(C019_EVENT_TYPES);
const COMPONENTS = new Set(['C015', 'C016', 'C017', 'C018']);
export const C019_REQUIRED_PAYLOAD_FIELDS: Record<string, string[]> = {
  RESPONSE_SUBMITTED: [
    'assessmentSessionId',
    'placementId',
    'questionVersionId',
    'responseId',
    'attemptOrdinal',
    'submissionKind',
  ],
  RESPONSE_SCORED: [
    'assessmentSessionId',
    'placementId',
    'questionVersionId',
    'responseId',
    'attemptOrdinal',
    'correctness',
    'awardedScore',
    'maximumScore',
    'answered',
  ],
  DIAGNOSTIC_STARTED: [
    'diagnosticRunId',
    'assessmentSessionId',
    'maximumLength',
  ],
  DIAGNOSTIC_ANSWER_PROCESSED: [
    'diagnosticRunId',
    'responseId',
    'questionVersionId',
    'correctness',
    'processedCount',
  ],
  DIAGNOSTIC_COMPLETED: [
    'diagnosticRunId',
    'assessmentSessionId',
    'stopReasonCode',
    'processedCount',
  ],
  PRACTICE_STARTED: ['practiceSessionId', 'assessmentSessionId', 'goalType'],
  PRACTICE_QUESTION_PRESENTED: [
    'practiceSessionId',
    'placementId',
    'questionVersionId',
    'ordinal',
    'difficulty',
  ],
  PRACTICE_RESPONSE_PROCESSED: [
    'practiceSessionId',
    'responseId',
    'placementId',
    'questionVersionId',
    'correctness',
    'answered',
    'difficultyBefore',
    'difficultyAfter',
  ],
  PRACTICE_HINT_CONSUMED: [
    'practiceSessionId',
    'placementId',
    'questionVersionId',
    'hintId',
  ],
  PRACTICE_RETRY_CONSUMED: [
    'practiceSessionId',
    'placementId',
    'questionVersionId',
    'retryOrdinal',
  ],
  PRACTICE_COMPLETED: [
    'practiceSessionId',
    'assessmentSessionId',
    'stopReasonCode',
    'questionCount',
  ],
  TEST_STARTED: [
    'testDefinitionId',
    'assessmentSessionId',
    'testType',
    'scopeType',
    'questionCount',
  ],
  TEST_RESPONSE_PROCESSED: [
    'testDefinitionId',
    'assessmentSessionId',
    'responseId',
    'placementId',
    'questionVersionId',
    'correctness',
    'answered',
    'awardedScore',
    'maximumScore',
  ],
  TEST_COMPLETED: [
    'testDefinitionId',
    'assessmentSessionId',
    'completionReasonCode',
    'questionCount',
    'answeredCount',
    'correctCount',
    'incorrectCount',
    'unansweredCount',
    'awardedScore',
    'maximumScore',
  ],
};
const REQUIRED = C019_REQUIRED_PAYLOAD_FIELDS;
const forbidden =
  /answerkey|answer_key|hiddensolution|hidden_solution|rubric|token|password|databaseurl|stack/i;
const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)),
        )
      : nested,
  );
@Injectable()
export class LearningEventService {
  constructor(private readonly db: DatabaseService) {}
  async append(
    input: {
      eventType: string;
      schemaVersion: number;
      occurredAt: Date;
      learnerUserId: string;
      actorUserId: string;
      sourceComponent: string;
      sourceAggregateType: string;
      sourceAggregateId: string;
      correlationId: string;
      causationId?: string | null;
      academicContext?: Prisma.InputJsonValue | null;
      payload: Record<string, unknown>;
      idempotencyKey?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.db;
    if (
      !TYPES.has(input.eventType) ||
      input.schemaVersion !== 1 ||
      !COMPONENTS.has(input.sourceComponent) ||
      !input.learnerUserId ||
      !input.actorUserId ||
      !input.sourceAggregateId ||
      !input.correlationId ||
      !(input.occurredAt instanceof Date) ||
      input.occurredAt.getTime() > Date.now() + 60000
    )
      learningEventInvalid();
    const keys = REQUIRED[input.eventType] ?? [];
    if (
      keys.some((k) => !(k in input.payload)) ||
      this.hasForbiddenField(input.payload) ||
      !this.hasValidPayloadTypes(input.payload)
    )
      learningEventInvalid('Payload does not match the V1 contract.');
    const source = await this.validateSourceAggregate(input, db);
    if (!source) learningEventInvalid('Source aggregate is invalid.');
    if (input.causationId) {
      const predecessor = await db.learningEvent.findUnique({
        where: { eventId: input.causationId },
      });
      if (
        !predecessor ||
        predecessor.learnerUserId !== input.learnerUserId ||
        (predecessor.correlationId !== input.correlationId &&
          !(
            predecessor.sourceComponent === 'C015' &&
            input.sourceComponent === 'C016'
          )) ||
        (input.academicContext &&
          !(
            predecessor.sourceComponent === 'C015' &&
            input.sourceComponent === 'C016'
          ) &&
          canonicalJson(predecessor.academicContext) !==
            canonicalJson(input.academicContext))
      )
        learningEventInvalid('Causation is not compatible with this event.');
    }
    const key =
      input.idempotencyKey ??
      createHash('sha256')
        .update(
          JSON.stringify({
            ...input,
            occurredAt: input.occurredAt.toISOString(),
          }),
        )
        .digest('hex');
    const data = {
      ...input,
      idempotencyKey: key,
      recordedAt: new Date(),
      academicContext: input.academicContext ?? undefined,
      payload: input.payload as Prisma.InputJsonValue,
    };
    const prior = await db.learningEvent.findUnique({
      where: { idempotencyKey: key },
    });
    if (prior) {
      const same =
        prior.eventType === input.eventType &&
        prior.schemaVersion === input.schemaVersion &&
        prior.learnerUserId === input.learnerUserId &&
        prior.actorUserId === input.actorUserId &&
        prior.sourceComponent === input.sourceComponent &&
        prior.sourceAggregateType === input.sourceAggregateType &&
        prior.sourceAggregateId === input.sourceAggregateId &&
        prior.correlationId === input.correlationId &&
        prior.causationId === (input.causationId ?? null) &&
        prior.occurredAt.getTime() === input.occurredAt.getTime() &&
        canonicalJson(prior.academicContext) ===
          canonicalJson(input.academicContext ?? null) &&
        canonicalJson(prior.payload) === canonicalJson(input.payload);
      if (same) return prior;
      learningEventConflict();
    }
    try {
      return await db.learningEvent.create({
        data,
        select: {
          eventId: true,
          eventType: true,
          schemaVersion: true,
          occurredAt: true,
          recordedAt: true,
          learnerUserId: true,
          actorUserId: true,
          sourceComponent: true,
          sourceAggregateType: true,
          sourceAggregateId: true,
          correlationId: true,
          causationId: true,
          idempotencyKey: true,
          academicContext: true,
          payload: true,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const prior = await db.learningEvent.findUnique({
          where: { idempotencyKey: key },
        });
        const same =
          prior &&
          prior.eventType === input.eventType &&
          prior.schemaVersion === input.schemaVersion &&
          prior.learnerUserId === input.learnerUserId &&
          prior.actorUserId === input.actorUserId &&
          prior.sourceComponent === input.sourceComponent &&
          prior.sourceAggregateType === input.sourceAggregateType &&
          prior.sourceAggregateId === input.sourceAggregateId &&
          prior.correlationId === input.correlationId &&
          prior.causationId === (input.causationId ?? null) &&
          prior.occurredAt.getTime() === input.occurredAt.getTime() &&
          canonicalJson(prior.academicContext) ===
            canonicalJson(input.academicContext ?? null) &&
          canonicalJson(prior.payload) === canonicalJson(input.payload);
        if (same) return prior;
        learningEventConflict();
      }
      throw e;
    }
  }

  private async validateSourceAggregate(
    input: {
      sourceComponent: string;
      sourceAggregateType: string;
      sourceAggregateId: string;
      learnerUserId: string;
    },
    db: DatabaseService | Prisma.TransactionClient,
  ) {
    const expected: Record<string, string> = {
      C015: 'AssessmentResponse',
      C016: 'DiagnosticRun',
      C017: 'PracticeSession',
      C018: 'TestDefinition',
    };
    if (expected[input.sourceComponent] !== input.sourceAggregateType)
      return false;
    if (input.sourceComponent === 'C015' && db.assessmentResponse?.findUnique) {
      const row = await db.assessmentResponse.findUnique({
        where: { assessmentResponseId: input.sourceAggregateId },
        select: { userId: true },
      });
      return row?.userId === input.learnerUserId;
    }
    if (input.sourceComponent === 'C016' && db.diagnosticRun?.findUnique) {
      const row = await db.diagnosticRun.findUnique({
        where: { diagnosticRunId: input.sourceAggregateId },
        select: { userId: true },
      });
      return row?.userId === input.learnerUserId;
    }
    if (input.sourceComponent === 'C017' && db.practiceSession?.findUnique) {
      const row = await db.practiceSession.findUnique({
        where: { practiceSessionId: input.sourceAggregateId },
        select: { ownerUserId: true },
      });
      return row?.ownerUserId === input.learnerUserId;
    }
    if (input.sourceComponent === 'C018' && db.testDefinition?.findUnique) {
      const row = await db.testDefinition.findUnique({
        where: { testId: input.sourceAggregateId },
        select: { ownerUserId: true },
      });
      return row?.ownerUserId === input.learnerUserId;
    }
    return true;
  }

  private hasForbiddenField(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value))
      return value.some((item) => this.hasForbiddenField(item));
    return Object.entries(value).some(
      ([key, nested]) => forbidden.test(key) || this.hasForbiddenField(nested),
    );
  }

  private hasValidPayloadTypes(payload: Record<string, unknown>): boolean {
    return Object.entries(payload).every(([key, value]) => {
      if (key === 'scopeId') return true;
      if (key.endsWith('Id') || key.endsWith('Type') || key.endsWith('Code'))
        return typeof value === 'string';
      if (
        [
          'ordinal',
          'attemptOrdinal',
          'questionCount',
          'answeredCount',
          'correctCount',
          'incorrectCount',
          'unansweredCount',
          'awardedScore',
          'maximumScore',
          'processedCount',
          'retryOrdinal',
        ].includes(key)
      )
        return typeof value === 'number' && Number.isFinite(value);
      if (['answered'].includes(key)) return typeof value === 'boolean';
      return true;
    });
  }
  async listMine(userId: string) {
    if (!userId) learningEventForbidden();
    return this.db.learningEvent.findMany({
      where: { learnerUserId: userId },
      orderBy: { recordedAt: 'asc' },
      select: {
        eventId: true,
        eventType: true,
        schemaVersion: true,
        occurredAt: true,
        recordedAt: true,
        sourceComponent: true,
        sourceAggregateType: true,
        sourceAggregateId: true,
        correlationId: true,
        causationId: true,
        academicContext: true,
        payload: true,
      },
    });
  }
}
