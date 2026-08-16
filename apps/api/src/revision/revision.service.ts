import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, RevisionState } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { RevisionError } from './revision.errors';
import {
  compareRevisionInputs,
  deriveDueState,
  foldRevisionInputs,
  RevisionInput,
  RevisionScope,
  REVISION_ALGORITHM_ID,
  REVISION_CONFIG_ID,
  REVISION_ENGINE_ID,
  REVISION_PROCESSING_VERSION,
} from './revision.projector';
const stable = (v: unknown): string =>
  v instanceof Date
    ? JSON.stringify(v.toISOString())
    : Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : v && typeof v === 'object'
        ? `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
            .join(',')}}`
        : JSON.stringify(v);
const sha = (v: unknown) =>
  createHash('sha256').update(stable(v)).digest('hex');
const scopeKey = (s: RevisionScope) =>
  sha([s.learnerId, s.conceptId, s.contextId, s.academicVersionId]);
@Injectable()
export class RevisionService {
  constructor(private readonly db: DatabaseService) {}
  async processC021Snapshot(
    learnerId: string,
    scope: RevisionScope,
    snapshotId: string,
  ) {
    const snapshot = await this.db.digitalTwinSnapshot.findUnique({
      where: { snapshotId },
    });
    if (!snapshot || snapshot.learnerId !== learnerId)
      throw new RevisionError('REVISION_FORBIDDEN');
    if (
      snapshot.targetType !== 'CONCEPT' ||
      snapshot.targetId !== scope.conceptId ||
      !this.contextMatches(snapshot.academicContext, scope)
    )
      throw new RevisionError('SCOPE_MISMATCH');
    const unsigned = {
      type: 'C021' as const,
      sourceRank: 10 as const,
      immutableSourceId: snapshot.snapshotId,
      effectiveAt: snapshot.lastEvidenceAt ?? snapshot.projectedAt,
      mastery: Number(snapshot.mastery),
      confidence: Number(snapshot.confidence),
      c021SnapshotId: snapshot.snapshotId,
      c021Revision: snapshot.revision,
    };
    return this.process(learnerId, scope, {
      ...unsigned,
      payloadHash: RevisionService.payloadHash(unsigned),
    });
  }
  async processC022Projection(
    learnerId: string,
    scope: RevisionScope,
    patternId: string,
  ) {
    const pattern = await this.db.mistakeDnaPattern.findUnique({
      where: { patternId },
    });
    if (!pattern || pattern.learnerId !== learnerId)
      throw new RevisionError('REVISION_FORBIDDEN');
    if (
      pattern.targetType !== 'CONCEPT' ||
      pattern.conceptId !== scope.conceptId ||
      !this.contextMatches(pattern.academicContext, scope)
    )
      throw new RevisionError('SCOPE_MISMATCH');
    if (
      ![
        'CANDIDATE',
        'CONFIRMED',
        'REMEDIATING',
        'RESOLVED',
        'REAPPEARED',
      ].includes(pattern.state)
    )
      throw new RevisionError('UNSUPPORTED_UPSTREAM_VERSION');
    const resolutionReason: RevisionInput['resolutionReason'] =
      pattern.resolutionReason === 'THRESHOLD_MET' ||
      pattern.resolutionReason === 'ISOLATED_EXPIRED'
        ? pattern.resolutionReason
        : null;
    const unsigned = {
      type: 'C022' as const,
      sourceRank: 20 as const,
      immutableSourceId: pattern.currentTransitionId ?? pattern.patternId,
      effectiveAt: pattern.lastSeenAt,
      lifecycle: pattern.state as RevisionInput['lifecycle'],
      resolutionReason,
      severity: Number(pattern.severity),
      recurrenceCount: pattern.recurrenceCount,
      reappearanceCount: pattern.reappearanceCount,
      c022ProjectionId: pattern.currentTransitionId ?? undefined,
      c022GenerationId: pattern.activeGenerationId ?? undefined,
      c022Revision: pattern.revision,
    };
    return this.process(learnerId, scope, {
      ...unsigned,
      payloadHash: RevisionService.payloadHash(unsigned),
    });
  }
  async process(
    learnerId: string,
    scope: RevisionScope,
    input: RevisionInput,
    failAfterState = false,
  ) {
    if (!learnerId || learnerId !== scope.learnerId)
      throw new RevisionError('REVISION_FORBIDDEN');
    if (!scope.conceptId || !scope.contextId || !scope.academicVersionId)
      throw new RevisionError('SCOPE_MISMATCH');
    if (
      (input.type === 'C021' && input.sourceRank !== 10) ||
      (input.type === 'C022' && input.sourceRank !== 20) ||
      (input.type === 'ASSESSMENT' && input.sourceRank !== 30)
    )
      throw new RevisionError('INVALID_SOURCE_RANK');
    const key = scopeKey(scope);
    const canonicalHash = sha({ ...input, payloadHash: undefined });
    if (input.payloadHash !== canonicalHash)
      throw new RevisionError('SOURCE_CONFLICT');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const duplicate = await tx.revisionSourceLedger.findUnique({
          where: {
            scopeKey_immutableSourceId: {
              scopeKey: key,
              immutableSourceId: input.immutableSourceId,
            },
          },
        });
        if (duplicate) {
          if (duplicate.payloadHash !== input.payloadHash)
            throw new RevisionError('SOURCE_CONFLICT');
          return this.readState(tx, key);
        }
        await tx.revisionSourceLedger.create({
          data: {
            scopeKey: key,
            learnerId,
            sourceType: input.type,
            sourceRank: input.sourceRank,
            immutableSourceId: input.immutableSourceId,
            payloadHash: input.payloadHash,
            effectiveAt: input.effectiveAt,
            normalizedPayload: JSON.parse(JSON.stringify(input)),
          },
        });
        const ledger = await tx.revisionSourceLedger.findMany({
          where: { scopeKey: key },
          orderBy: [
            { effectiveAt: 'asc' },
            { sourceRank: 'asc' },
            { immutableSourceId: 'asc' },
          ],
        });
        const inputs = ledger
          .map((x) => this.fromLedger(x.normalizedPayload))
          .sort(compareRevisionInputs);
        const folded = foldRevisionInputs(inputs);
        const terminal = inputs.at(-1)!;
        const fingerprint = sha(inputs);
        const generationKey = sha([key, fingerprint]);
        const generation = await tx.revisionGeneration.upsert({
          where: { logicalKey: generationKey },
          create: {
            logicalKey: generationKey,
            scopeKey: key,
            learnerId,
            fingerprint,
            sourceIds: inputs.map((x) => x.immutableSourceId),
          },
          update: {},
        });
        const s = folded.state;
        const data = {
          scopeKey: key,
          ...scope,
          state: s.state,
          intervalDays: s.intervalDays,
          anchorAt: s.anchorAt,
          dueAt: s.dueAt,
          consecutiveIndependentSuccessCount:
            s.consecutiveIndependentSuccessCount,
          lastQualifyingQuestionVersionId: s.lastQualifyingQuestionVersionId,
          successWindowStartedAt: s.successWindowStartedAt,
          lastAssessmentResultId: s.lastAssessmentResultId,
          lastAssessedAt: s.lastAssessedAt,
          mastery: s.mastery,
          learnerConfidence: s.confidence,
          c021SnapshotId: s.c021SnapshotId,
          c021Revision: s.c021Revision,
          c022ProjectionId: s.c022ProjectionId,
          c022GenerationId: s.c022GenerationId,
          c022Revision: s.c022Revision,
          c022Lifecycle: s.lifecycle,
          c022ResolutionReason: s.resolutionReason,
          c022Severity: s.severity,
          c022RecurrenceCount: s.recurrenceCount,
          c022ReappearanceCount: s.reappearanceCount,
          watermarkEffectiveAt: terminal.effectiveAt,
          watermarkSourceRank: terminal.sourceRank,
          watermarkSourceId: terminal.immutableSourceId,
          engineId: REVISION_ENGINE_ID,
          algorithmId: REVISION_ALGORITHM_ID,
          configId: REVISION_CONFIG_ID,
          processingVersion: REVISION_PROCESSING_VERSION,
          activeGenerationId: generation.generationId,
        };
        await tx.revisionState.upsert({
          where: { scopeKey: key },
          create: { ...data, revision: 1 },
          update: { ...data, revision: { increment: 1 } },
        });
        if (failAfterState) throw new RevisionError('INJECTED_FAILURE');
        for (let i = 0; i < folded.history.length; i++) {
          const h = folded.history[i];
          await tx.revisionHistory.upsert({
            where: {
              projectionId: sha([generationKey, i, h.input.immutableSourceId]),
            },
            create: {
              projectionId: sha([generationKey, i, h.input.immutableSourceId]),
              generationId: generation.generationId,
              semanticOrder: i,
              scopeKey: key,
              learnerId,
              fromState: h.fromState,
              toState: h.toState,
              beforeIntervalDays: h.beforeIntervalDays,
              afterIntervalDays: h.afterIntervalDays,
              beforeDueAt: h.beforeDueAt,
              afterDueAt: h.afterDueAt,
              transitionReason: h.reason,
              sourceType: h.input.type,
              sourceRank: h.input.sourceRank,
              immutableSourceId: h.input.immutableSourceId,
              effectiveAt: h.input.effectiveAt,
              engineId: REVISION_ENGINE_ID,
              algorithmId: REVISION_ALGORITHM_ID,
              configId: REVISION_CONFIG_ID,
              processingVersion: REVISION_PROCESSING_VERSION,
              provenance: {
                c021SnapshotId: s.c021SnapshotId,
                c022ProjectionId: s.c022ProjectionId,
              },
            },
            update: {},
          });
        }
        if (input.type === 'ASSESSMENT')
          await tx.revisionAssessmentLink.create({
            data: {
              attemptKey: sha([
                key,
                input.assessmentResultId,
                input.questionVersionId,
                input.effectiveAt,
              ]),
              scopeKey: key,
              learnerId,
              assessmentResultId: input.assessmentResultId!,
              questionVersionId: input.questionVersionId!,
              assessedAt: input.effectiveAt,
              outcome: !input.correct
                ? 'FAILURE'
                : input.hintUsed || input.retryUsed
                  ? 'ASSISTED_SUCCESS'
                  : 'INDEPENDENT_SUCCESS',
              immutableSourceId: input.immutableSourceId,
              payloadHash: input.payloadHash,
            },
          });
        return this.readState(tx, key);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  async current(learnerId: string, scope: RevisionScope, referenceTime: Date) {
    if (learnerId !== scope.learnerId)
      throw new RevisionError('REVISION_FORBIDDEN');
    const row = await this.db.revisionState.findUnique({
      where: { scopeKey: scopeKey(scope) },
    });
    return row
      ? this.safe(row, referenceTime)
      : {
          state: 'NOT_SCHEDULED',
          intervalDays: null,
          dueAt: null,
          dueStateAtReferenceTime: 'NOT_SCHEDULED',
          lastAssessedAt: null,
          engineId: REVISION_ENGINE_ID,
          configId: REVISION_CONFIG_ID,
          processingVersion: REVISION_PROCESSING_VERSION,
        };
  }
  async history(learnerId: string, scope: RevisionScope) {
    if (learnerId !== scope.learnerId)
      throw new RevisionError('REVISION_FORBIDDEN');
    const state = await this.db.revisionState.findUnique({
      where: { scopeKey: scopeKey(scope) },
    });
    if (!state?.activeGenerationId) return [];
    return this.db.revisionHistory.findMany({
      where: {
        scopeKey: state.scopeKey,
        generationId: state.activeGenerationId,
      },
      orderBy: { semanticOrder: 'asc' },
      select: {
        fromState: true,
        toState: true,
        beforeIntervalDays: true,
        afterIntervalDays: true,
        beforeDueAt: true,
        afterDueAt: true,
        transitionReason: true,
        effectiveAt: true,
      },
    });
  }
  private fromLedger(value: Prisma.JsonValue): RevisionInput {
    const x = value as Prisma.JsonObject;
    return {
      ...x,
      effectiveAt: new Date(String(x.effectiveAt)),
    } as unknown as RevisionInput;
  }
  private contextMatches(value: Prisma.JsonValue, scope: RevisionScope) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const context = value as Prisma.JsonObject;
    return (
      context.academicVersionId === scope.academicVersionId &&
      context.contextId === scope.contextId
    );
  }
  private async readState(tx: Prisma.TransactionClient, key: string) {
    const row = await tx.revisionState.findUniqueOrThrow({
      where: { scopeKey: key },
    });
    return this.safe(row, row.anchorAt ?? new Date(0));
  }
  private safe(row: RevisionState, referenceTime: Date) {
    return {
      state: row.state,
      intervalDays: row.intervalDays,
      dueAt: row.dueAt,
      dueStateAtReferenceTime: deriveDueState(
        {
          state: row.state as 'NOT_SCHEDULED' | 'SCHEDULED',
          intervalDays: row.intervalDays,
          anchorAt: row.anchorAt,
          dueAt: row.dueAt,
          consecutiveIndependentSuccessCount:
            row.consecutiveIndependentSuccessCount,
          lastQualifyingQuestionVersionId: row.lastQualifyingQuestionVersionId,
          successWindowStartedAt: row.successWindowStartedAt,
          lastAssessmentResultId: row.lastAssessmentResultId,
          lastAssessedAt: row.lastAssessedAt,
          mastery: row.mastery === null ? null : Number(row.mastery),
          confidence: Number(row.learnerConfidence),
          c021SnapshotId: row.c021SnapshotId,
          c021Revision: row.c021Revision,
          lifecycle: row.c022Lifecycle as
            | 'CANDIDATE'
            | 'CONFIRMED'
            | 'REMEDIATING'
            | 'RESOLVED'
            | 'REAPPEARED'
            | null,
          resolutionReason: row.c022ResolutionReason as
            'THRESHOLD_MET' | 'ISOLATED_EXPIRED' | null,
          severity: Number(row.c022Severity ?? 0),
          recurrenceCount: row.c022RecurrenceCount ?? 0,
          reappearanceCount: row.c022ReappearanceCount ?? 0,
          c022ProjectionId: row.c022ProjectionId,
          c022GenerationId: row.c022GenerationId,
          c022Revision: row.c022Revision,
        },
        referenceTime,
      ),
      lastAssessedAt: row.lastAssessedAt,
      engineId: row.engineId,
      configId: row.configId,
      processingVersion: row.processingVersion,
    };
  }
  static payloadHash(input: Omit<RevisionInput, 'payloadHash'>) {
    return sha({ ...input, payloadHash: undefined });
  }
}
