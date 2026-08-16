import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  evidenceConflict,
  evidenceForbidden,
  evidenceInvalid,
} from './evidence.errors';

export const C020_PROCESSING_VERSION = 'c020-v1';
export const C020_EVIDENCE_TYPES = [
  'EV_RESPONSE_CORRECT',
  'EV_RESPONSE_INCORRECT',
  'EV_RESPONSE_UNANSWERED',
  'EV_HINT_USED',
  'EV_RETRY_USED',
  'EV_PRACTICE_COMPLETED',
  'EV_DIAGNOSTIC_PROCESSED',
  'EV_TEST_RESPONSE',
  'EV_TEST_COMPLETED',
  'EV_TUTOR_OBSERVATION',
] as const;
export const C020_SIGNAL_TYPES = [
  'SIG_RESPONSE_OUTCOME',
  'SIG_ASSISTANCE_USED',
  'SIG_RETRY_USED',
  'SIG_INDEPENDENT_CORRECT',
  'SIG_ASSISTED_CORRECT',
  'SIG_PERSISTENT_ERROR',
  'SIG_SELF_CORRECTION',
  'SIG_EXPLANATION_QUALITY',
  'SIG_SESSION_COMPLETED',
] as const;
const mapped: Record<string, string> = {
  RESPONSE_SCORED: 'RESPONSE',
  PRACTICE_HINT_CONSUMED: 'EV_HINT_USED',
  PRACTICE_RETRY_CONSUMED: 'EV_RETRY_USED',
  PRACTICE_COMPLETED: 'EV_PRACTICE_COMPLETED',
  DIAGNOSTIC_ANSWER_PROCESSED: 'EV_DIAGNOSTIC_PROCESSED',
  TEST_RESPONSE_PROCESSED: 'EV_TEST_RESPONSE',
  TEST_COMPLETED: 'EV_TEST_COMPLETED',
};
const tutorCodes = new Set([
  'SELF_CORRECTION',
  'EXPLANATION_COMPLETE',
  'EXPLANATION_PARTIAL',
  'REQUESTED_CLARIFICATION',
  'ABANDONED_ATTEMPT',
]);
const forbidden =
  /answerkey|answer_key|correctanswer|correct_answer|hiddensolution|hidden_solution|rubric|password|token|secret|apikey|api_key|cookie|authorization|chain.?of.?thought/i;
const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join('|')).digest('hex');

type Tx = Prisma.TransactionClient | DatabaseService;
type EvidenceRow = {
  evidenceId: string;
  learnerId: string;
  evidenceType: string;
  value: Prisma.JsonValue;
  questionVersionId: string | null;
  correlationId: string | null;
  academicContext: Prisma.JsonValue;
};
type SignalRow = { sourceEvidenceIds: Prisma.JsonValue };
type Event = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: Date;
  learnerUserId: string;
  sourceAggregateType: string;
  sourceAggregateId: string;
  correlationId: string;
  causationId: string | null;
  academicContext: Prisma.JsonValue | null;
  payload: Prisma.JsonValue;
};

@Injectable()
export class EvidenceService {
  constructor(private readonly db: DatabaseService) {}

  async processLearningEvent(
    eventId: string,
    learnerId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (tx) return this.processEventWithin(tx, eventId, learnerId);
    return this.db.$transaction((root) =>
      this.processEventWithin(root, eventId, learnerId),
    );
  }

  async processTutorObservation(
    input: {
      learnerId: string;
      tutorActorId: string;
      observationCode: string;
      targetType: string;
      targetId: string;
      correlationId: string;
      academicContext: Prisma.InputJsonValue;
      occurredAt: Date;
      freeText?: string;
      idempotencyKey?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    if (tx) return this.processTutorWithin(tx, input);
    return this.db.$transaction((root) => this.processTutorWithin(root, input));
  }

  private async processEventWithin(
    db: Tx,
    eventId: string,
    learnerId?: string,
  ) {
    const event = (await db.learningEvent.findUnique({
      where: { eventId },
    })) as Event | null;
    if (!event) evidenceInvalid('Source LearningEvent does not exist.');
    if (learnerId && learnerId !== event!.learnerUserId) evidenceForbidden();
    if (event!.schemaVersion !== 1 || !mapped[event!.eventType])
      return { eligible: false, evidence: null, signals: [] };
    const type = this.evidenceType(event!);
    const payload = event!.payload as Record<string, unknown>;
    if (this.hasForbidden(payload))
      evidenceInvalid('Source payload contains prohibited fields.');
    const questionVersionId =
      typeof payload.questionVersionId === 'string'
        ? payload.questionVersionId
        : undefined;
    const value = this.valueFor(type, payload);
    const identity = hash(
      C020_PROCESSING_VERSION,
      event!.learnerUserId,
      type,
      event!.eventId,
      event!.sourceAggregateType,
      event!.sourceAggregateId,
      questionVersionId ?? '',
    );
    const existing = await db.evidenceRecord.findUnique({
      where: { idempotencyKey: identity },
    });
    if (existing) {
      if (stable(existing.value) !== stable(value)) evidenceConflict();
      const priorSignals = await db.evidenceSignal.findMany({
        where: {
          learnerId: existing.learnerId,
          processingVersion: C020_PROCESSING_VERSION,
        },
        orderBy: { createdAt: 'asc' },
      });
      const signals = priorSignals.filter(
        (signal: SignalRow) =>
          Array.isArray(signal.sourceEvidenceIds) &&
          signal.sourceEvidenceIds.includes(existing.evidenceId),
      );
      return { eligible: true, evidence: existing, signals };
    }
    const evidence = await db.evidenceRecord.create({
      data: {
        learnerId: event!.learnerUserId,
        evidenceType: type,
        sourceLearningEventId: event!.eventId,
        sourceAggregateType: event!.sourceAggregateType,
        sourceAggregateId: event!.sourceAggregateId,
        questionVersionId,
        attemptOrdinal:
          typeof payload.attemptOrdinal === 'number'
            ? payload.attemptOrdinal
            : undefined,
        value: value as Prisma.InputJsonValue,
        processingVersion: C020_PROCESSING_VERSION,
        correlationId: event!.correlationId,
        causationId: event!.causationId,
        academicContext: (event!.academicContext ??
          {}) as Prisma.InputJsonValue,
        sourceOccurredAt: event!.occurredAt,
        idempotencyKey: identity,
      },
    });
    const signals = await this.deriveAndPersist(db, evidence, event!, type);
    return { eligible: true, evidence, signals };
  }

  private async processTutorWithin(
    db: Tx,
    input: Parameters<EvidenceService['processTutorObservation']>[0],
  ) {
    if (
      !input.learnerId ||
      !input.tutorActorId ||
      !tutorCodes.has(input.observationCode) ||
      !input.targetId ||
      !input.targetType ||
      this.hasForbidden(input)
    )
      evidenceInvalid('Tutor observation is not authorized.');
    if (!['QUESTION_VERSION', 'CONCEPT'].includes(input.targetType))
      evidenceInvalid('Tutor target type is invalid.');
    const observationKey =
      input.idempotencyKey ??
      hash(
        C020_PROCESSING_VERSION,
        input.learnerId,
        input.observationCode,
        input.targetType,
        input.targetId,
        input.correlationId,
      );
    const observation = await db.tutorObservation.upsert({
      where: { idempotencyKey: observationKey },
      update: {},
      create: {
        learnerId: input.learnerId,
        tutorActorId: input.tutorActorId,
        observationCode: input.observationCode,
        targetType: input.targetType,
        targetId: input.targetId,
        correlationId: input.correlationId,
        academicContext: input.academicContext,
        freeText: input.freeText,
        occurredAt: input.occurredAt,
        idempotencyKey: observationKey,
      },
    });
    const evidenceKey = hash(
      C020_PROCESSING_VERSION,
      input.learnerId,
      'EV_TUTOR_OBSERVATION',
      observation.observationId,
      input.targetType,
      input.targetId,
    );
    const evidence = await db.evidenceRecord.upsert({
      where: { idempotencyKey: evidenceKey },
      update: {},
      create: {
        learnerId: input.learnerId,
        evidenceType: 'EV_TUTOR_OBSERVATION',
        tutorObservationId: observation.observationId,
        sourceAggregateType: input.targetType,
        sourceAggregateId: input.targetId,
        questionVersionId:
          input.targetType === 'QUESTION_VERSION' ? input.targetId : undefined,
        value: {
          observationCode: input.observationCode,
          targetType: input.targetType,
          targetId: input.targetId,
        },
        processingVersion: C020_PROCESSING_VERSION,
        correlationId: input.correlationId,
        academicContext: input.academicContext,
        sourceOccurredAt: input.occurredAt,
        idempotencyKey: evidenceKey,
      },
    });
    const signalType =
      input.observationCode === 'SELF_CORRECTION'
        ? 'SIG_SELF_CORRECTION'
        : 'SIG_EXPLANATION_QUALITY';
    const signalKey = hash(
      C020_PROCESSING_VERSION,
      input.learnerId,
      signalType,
      evidence.evidenceId,
      input.correlationId,
      input.targetId,
    );
    const signal = await db.evidenceSignal.upsert({
      where: { idempotencyKey: signalKey },
      update: {},
      create: {
        learnerId: input.learnerId,
        signalType,
        value:
          input.observationCode === 'SELF_CORRECTION'
            ? true
            : input.observationCode === 'EXPLANATION_COMPLETE'
              ? 'COMPLETE'
              : 'PARTIAL',
        sourceEvidenceIds: [evidence.evidenceId],
        processingVersion: C020_PROCESSING_VERSION,
        ruleId: 'C020-V1-TUTOR-CODE',
        targetVersionId: input.targetId,
        correlationId: input.correlationId,
        academicContext: input.academicContext,
        idempotencyKey: signalKey,
      },
    });
    return { eligible: true, evidence, signals: [signal] };
  }

  private evidenceType(event: Event) {
    if (event.eventType === 'RESPONSE_SCORED') {
      const c = (event.payload as Record<string, unknown>).correctness;
      return c === 'CORRECT'
        ? 'EV_RESPONSE_CORRECT'
        : c === 'INCORRECT'
          ? 'EV_RESPONSE_INCORRECT'
          : 'EV_RESPONSE_UNANSWERED';
    }
    return mapped[event.eventType];
  }
  private valueFor(type: string, payload: Record<string, unknown>) {
    if (type.startsWith('EV_RESPONSE_'))
      return {
        correctness: payload.correctness,
        answered: payload.answered,
        awardedScore: payload.awardedScore,
        maximumScore: payload.maximumScore,
      };
    if (type === 'EV_TUTOR_OBSERVATION') return payload;
    return { source: type };
  }
  private async deriveAndPersist(
    db: Tx,
    evidence: EvidenceRow,
    event: Event,
    type: string,
  ) {
    const specs: Array<[string, unknown, string]> = [];
    if (type.startsWith('EV_RESPONSE_')) {
      const outcome = type.endsWith('CORRECT')
        ? 'CORRECT'
        : type.endsWith('INCORRECT')
          ? 'INCORRECT'
          : 'UNANSWERED';
      specs.push(['SIG_RESPONSE_OUTCOME', outcome, 'C020-V1-RESPONSE-OUTCOME']);
      if (outcome === 'CORRECT') {
        const prior = await db.evidenceRecord.findMany({
          where: {
            learnerId: evidence.learnerId,
            questionVersionId: evidence.questionVersionId,
            processingVersion: C020_PROCESSING_VERSION,
          },
          orderBy: { sourceOccurredAt: 'asc' },
        });
        const assisted = prior.some(
          (row: EvidenceRow) =>
            row.correlationId === event.correlationId &&
            (row.evidenceType === 'EV_HINT_USED' ||
              row.evidenceType === 'EV_RETRY_USED'),
        );
        specs.push([
          assisted ? 'SIG_ASSISTED_CORRECT' : 'SIG_INDEPENDENT_CORRECT',
          assisted
            ? prior.some(
                (row: EvidenceRow) =>
                  row.evidenceType === 'EV_RETRY_USED' &&
                  row.correlationId === event.correlationId,
              )
              ? 'RETRY'
              : 'HINT'
            : true,
          'C020-V1-CORRECT-LINEAGE',
        ]);
      }
      if (outcome === 'INCORRECT') {
        const priorIncorrect = await db.evidenceRecord.count({
          where: {
            learnerId: evidence.learnerId,
            questionVersionId: evidence.questionVersionId,
            evidenceType: 'EV_RESPONSE_INCORRECT',
            processingVersion: C020_PROCESSING_VERSION,
          },
        });
        if (priorIncorrect >= 1)
          specs.push([
            'SIG_PERSISTENT_ERROR',
            true,
            'C020-V1-PERSISTENT-ERROR',
          ]);
      }
    }
    if (type === 'EV_HINT_USED')
      specs.push(['SIG_ASSISTANCE_USED', 'HINT', 'C020-V1-ASSISTANCE']);
    if (type === 'EV_RETRY_USED')
      specs.push(['SIG_RETRY_USED', 'RETRY', 'C020-V1-RETRY']);
    if (type === 'EV_PRACTICE_COMPLETED' || type === 'EV_TEST_COMPLETED')
      specs.push([
        'SIG_SESSION_COMPLETED',
        type === 'EV_PRACTICE_COMPLETED' ? 'PRACTICE' : 'TEST',
        'C020-V1-SESSION',
      ]);
    const out = [];
    for (const [signalType, value, ruleId] of specs) {
      const key = hash(
        C020_PROCESSING_VERSION,
        evidence.learnerId,
        signalType,
        evidence.evidenceId,
        event.correlationId,
        evidence.questionVersionId ?? '',
      );
      out.push(
        await db.evidenceSignal.upsert({
          where: { idempotencyKey: key },
          update: {},
          create: {
            learnerId: evidence.learnerId,
            signalType,
            value: value as Prisma.InputJsonValue,
            sourceEvidenceIds: [evidence.evidenceId],
            processingVersion: C020_PROCESSING_VERSION,
            ruleId,
            targetVersionId: evidence.questionVersionId,
            correlationId: event.correlationId,
            academicContext: evidence.academicContext as Prisma.InputJsonValue,
            idempotencyKey: key,
          },
        }),
      );
    }
    return out;
  }
  private hasForbidden(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((v) => this.hasForbidden(v));
    return Object.entries(value).some(
      ([k, v]) => forbidden.test(k) || this.hasForbidden(v),
    );
  }
  async getEvidenceForLearner(userId: string) {
    if (!userId) evidenceForbidden();
    return this.db.evidenceRecord.findMany({
      where: { learnerId: userId },
      orderBy: { createdAt: 'asc' },
      select: {
        evidenceId: true,
        learnerId: true,
        evidenceType: true,
        sourceLearningEventId: true,
        sourceAggregateType: true,
        sourceAggregateId: true,
        questionVersionId: true,
        value: true,
        processingVersion: true,
        correlationId: true,
        causationId: true,
        academicContext: true,
        sourceOccurredAt: true,
        createdAt: true,
      },
    });
  }
  async getSignalsForLearner(userId: string) {
    if (!userId) evidenceForbidden();
    return this.db.evidenceSignal.findMany({
      where: { learnerId: userId },
      orderBy: { createdAt: 'asc' },
      select: {
        signalId: true,
        learnerId: true,
        signalType: true,
        value: true,
        sourceEvidenceIds: true,
        processingVersion: true,
        ruleId: true,
        targetVersionId: true,
        correlationId: true,
        academicContext: true,
        createdAt: true,
      },
    });
  }
}
