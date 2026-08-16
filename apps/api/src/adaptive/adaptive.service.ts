import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AdaptiveCandidate, AdaptiveExplanation, Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AdaptiveError } from './adaptive.errors';
import {
  ADAPTIVE_ALGORITHM_ID,
  ADAPTIVE_CONFIG_ID,
  ADAPTIVE_CONTRACT_VERSION,
  ADAPTIVE_ENGINE_ID,
  ADAPTIVE_PROCESSING_VERSION,
  AdaptiveSource,
  adaptivePayloadHash,
  compareAdaptiveSources,
  foldAdaptiveSources,
} from './adaptive.projector';
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
export type AdaptiveScope = {
  learnerId: string;
  contextId: string;
  academicVersionId: string;
};
@Injectable()
export class AdaptiveService {
  constructor(private readonly db: DatabaseService) {}
  async process(
    actorId: string,
    scope: AdaptiveScope,
    source: AdaptiveSource,
    failAfterCandidates = false,
  ) {
    if (actorId !== scope.learnerId)
      throw new AdaptiveError('UNAUTHORIZED_SCOPE');
    if (!scope.contextId || !scope.academicVersionId)
      throw new AdaptiveError('INVALID_SCOPE');
    const { payloadHash, ...unsignedSource } = source;
    if (payloadHash !== adaptivePayloadHash(unsignedSource))
      throw new AdaptiveError('IMMUTABLE_SOURCE_CONFLICT');
    return this.db.$transaction(
      async (tx) => {
        const key = sha([
          scope.learnerId,
          scope.contextId,
          scope.academicVersionId,
        ]);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const duplicate = await tx.adaptiveSourceLedger.findUnique({
          where: {
            scopeKey_immutableSourceId: {
              scopeKey: key,
              immutableSourceId: source.immutableSourceId,
            },
          },
        });
        if (duplicate) {
          if (duplicate.payloadHash !== source.payloadHash)
            throw new AdaptiveError('IMMUTABLE_SOURCE_CONFLICT');
          return this.readWithin(tx, key);
        }
        await tx.adaptiveSourceLedger.create({
          data: {
            scopeKey: key,
            learnerId: scope.learnerId,
            immutableSourceId: source.immutableSourceId,
            payloadHash: source.payloadHash,
            effectiveAt: source.effectiveAt,
            sourceRank: source.sourceRank,
            normalizedPayload: JSON.parse(JSON.stringify(source)),
          },
        });
        return this.rebuildWithin(tx, key, scope, failAfterCandidates);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  async rebuild(actorId: string, scope: AdaptiveScope) {
    if (actorId !== scope.learnerId)
      throw new AdaptiveError('UNAUTHORIZED_SCOPE');
    const key = sha([
      scope.learnerId,
      scope.contextId,
      scope.academicVersionId,
    ]);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return this.rebuildWithin(tx, key, scope, false);
    });
  }
  async current(actorId: string, scope: AdaptiveScope) {
    if (actorId !== scope.learnerId)
      throw new AdaptiveError('UNAUTHORIZED_SCOPE');
    const key = sha([
      scope.learnerId,
      scope.contextId,
      scope.academicVersionId,
    ]);
    const run = await this.db.adaptiveRun.findUnique({
      where: { scopeKey: key },
    });
    if (!run?.activeGenerationId)
      return {
        status: 'NO_ELIGIBLE_ACTION',
        selected: null,
        reasonCodes: ['NO_ELIGIBLE_ACTION'],
        explanation: 'No eligible learning action is currently available.',
        engineId: ADAPTIVE_ENGINE_ID,
        configId: ADAPTIVE_CONFIG_ID,
        processingVersion: ADAPTIVE_PROCESSING_VERSION,
      };
    return this.readCurrent(key, run.activeGenerationId);
  }
  async history(actorId: string, scope: AdaptiveScope) {
    if (actorId !== scope.learnerId)
      throw new AdaptiveError('UNAUTHORIZED_SCOPE');
    const key = sha([
      scope.learnerId,
      scope.contextId,
      scope.academicVersionId,
    ]);
    return this.db.adaptiveHistory.findMany({
      where: { scopeKey: key },
      orderBy: { createdAt: 'asc' },
      select: {
        selectedCandidateId: true,
        reasonCodes: true,
        explanation: true,
        watermarkEffectiveAt: true,
        engineId: true,
        configId: true,
        processingVersion: true,
      },
    });
  }
  private async rebuildWithin(
    tx: Prisma.TransactionClient,
    key: string,
    scope: AdaptiveScope,
    fail: boolean,
  ) {
    const rows = await tx.adaptiveSourceLedger.findMany({
      where: { scopeKey: key },
      orderBy: [
        { effectiveAt: 'asc' },
        { sourceRank: 'asc' },
        { immutableSourceId: 'asc' },
      ],
    });
    if (!rows.length) throw new AdaptiveError('REBUILD_FAILED');
    const sources = rows
      .map((x) => {
        const p = x.normalizedPayload as Prisma.JsonObject;
        return {
          ...p,
          effectiveAt: new Date(String(p.effectiveAt)),
        } as unknown as AdaptiveSource;
      })
      .sort(compareAdaptiveSources);
    const decision = foldAdaptiveSources(scope, sources),
      fingerprint = sha(sources),
      logicalKey = sha([key, fingerprint]);
    const generation = await tx.adaptiveGeneration.upsert({
      where: { logicalKey },
      create: {
        logicalKey,
        scopeKey: key,
        learnerId: scope.learnerId,
        fingerprint,
        sourceIds: sources.map((x) => x.immutableSourceId),
      },
      update: {},
    });
    for (const c of decision.candidates)
      await tx.adaptiveCandidate.upsert({
        where: {
          generationId_immutableCandidateId: {
            generationId: generation.generationId,
            immutableCandidateId: c.immutableCandidateId,
          },
        },
        create: {
          generationId: generation.generationId,
          scopeKey: key,
          learnerId: scope.learnerId,
          ...c,
          reasonCodes: c.reasonCodes,
        },
        update: {},
      });
    if (fail) throw new AdaptiveError('INJECTED_FAILURE');
    const watermark = sources.at(-1)!;
    await tx.adaptiveExplanation.upsert({
      where: { generationId: generation.generationId },
      create: {
        generationId: generation.generationId,
        scopeKey: key,
        learnerId: scope.learnerId,
        selectedCandidateId: decision.selected?.immutableCandidateId,
        reasonCodes: decision.reasonCodes,
        explanation: decision.explanation,
        engineId: ADAPTIVE_ENGINE_ID,
        configId: ADAPTIVE_CONFIG_ID,
        processingVersion: ADAPTIVE_PROCESSING_VERSION,
      },
      update: {},
    });
    await tx.adaptiveHistory.upsert({
      where: { projectionId: logicalKey },
      create: {
        projectionId: logicalKey,
        generationId: generation.generationId,
        scopeKey: key,
        learnerId: scope.learnerId,
        selectedCandidateId: decision.selected?.immutableCandidateId,
        reasonCodes: decision.reasonCodes,
        explanation: decision.explanation,
        watermarkEffectiveAt: watermark.effectiveAt,
        watermarkSourceRank: watermark.sourceRank,
        watermarkSourceId: watermark.immutableSourceId,
        engineId: ADAPTIVE_ENGINE_ID,
        algorithmId: ADAPTIVE_ALGORITHM_ID,
        configId: ADAPTIVE_CONFIG_ID,
        processingVersion: ADAPTIVE_PROCESSING_VERSION,
        contractVersion: ADAPTIVE_CONTRACT_VERSION,
        provenance: { sourceIds: sources.map((x) => x.immutableSourceId) },
      },
      update: {},
    });
    await tx.adaptiveRun.upsert({
      where: { scopeKey: key },
      create: {
        scopeKey: key,
        ...scope,
        status: decision.selected ? 'SELECTED' : 'NO_ELIGIBLE_ACTION',
        selectedCandidateId: decision.selected?.immutableCandidateId,
        watermarkEffectiveAt: watermark.effectiveAt,
        watermarkSourceRank: watermark.sourceRank,
        watermarkSourceId: watermark.immutableSourceId,
        activeGenerationId: generation.generationId,
        engineId: ADAPTIVE_ENGINE_ID,
        algorithmId: ADAPTIVE_ALGORITHM_ID,
        configId: ADAPTIVE_CONFIG_ID,
        processingVersion: ADAPTIVE_PROCESSING_VERSION,
        contractVersion: ADAPTIVE_CONTRACT_VERSION,
        revision: 1,
      },
      update: {
        status: decision.selected ? 'SELECTED' : 'NO_ELIGIBLE_ACTION',
        selectedCandidateId: decision.selected?.immutableCandidateId,
        watermarkEffectiveAt: watermark.effectiveAt,
        watermarkSourceRank: watermark.sourceRank,
        watermarkSourceId: watermark.immutableSourceId,
        activeGenerationId: generation.generationId,
        revision: { increment: 1 },
      },
    });
    return this.readWithin(tx, key);
  }
  private async readWithin(tx: Prisma.TransactionClient, key: string) {
    const run = await tx.adaptiveRun.findUniqueOrThrow({
      where: { scopeKey: key },
    });
    const c = run.activeGenerationId
      ? await tx.adaptiveCandidate.findFirst({
          where: { generationId: run.activeGenerationId, rank: 1 },
        })
      : null;
    const e = run.activeGenerationId
      ? await tx.adaptiveExplanation.findUnique({
          where: { generationId: run.activeGenerationId },
        })
      : null;
    return this.safe(run.status, c, e);
  }
  private async readCurrent(key: string, generationId: string) {
    const run = await this.db.adaptiveRun.findUniqueOrThrow({
        where: { scopeKey: key },
      }),
      c = await this.db.adaptiveCandidate.findFirst({
        where: { generationId, rank: 1 },
      }),
      e = await this.db.adaptiveExplanation.findUnique({
        where: { generationId },
      });
    return this.safe(run.status, c, e);
  }
  private safe(
    status: string,
    c: AdaptiveCandidate | null,
    e: AdaptiveExplanation | null,
  ) {
    return {
      status,
      selected: c
        ? {
            candidateType: c.candidateType,
            conceptId: c.conceptId,
            targetRefId: c.targetRefId,
            finalScore: Number(c.finalScore),
            rank: c.rank,
          }
        : null,
      reasonCodes: e?.reasonCodes ?? ['NO_ELIGIBLE_ACTION'],
      explanation:
        e?.explanation ?? 'No eligible learning action is currently available.',
      engineId: ADAPTIVE_ENGINE_ID,
      configId: ADAPTIVE_CONFIG_ID,
      processingVersion: ADAPTIVE_PROCESSING_VERSION,
    };
  }
  static payloadHash(v: Omit<AdaptiveSource, 'payloadHash'>) {
    return adaptivePayloadHash(v);
  }
}
