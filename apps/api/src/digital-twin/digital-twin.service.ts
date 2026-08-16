/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  DTP_ALGORITHM,
  DTP_CONFIG,
  DTP_PROCESSING_VERSION,
  orderInputs,
  project,
  projectionIdentity,
  ProjectionInput,
} from './digital-twin.projector';
import { dtConflict, dtForbidden } from './digital-twin.errors';

type Db = DatabaseService | Prisma.TransactionClient;
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const contextId = (v: unknown) =>
  createHash('sha256').update(stable(v)).digest('hex');
const jsonObject = (
  v: Prisma.JsonValue | null | undefined,
): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

@Injectable()
export class DigitalTwinService {
  constructor(
    private readonly db: DatabaseService,
    @Optional()
    private readonly hooks: { afterStateMutation?: () => void } = {},
  ) {}

  async projectLearnerConcept(input: {
    learnerId: string;
    conceptId: string;
    academicContext: Prisma.InputJsonValue;
    inputIds?: string[];
  }) {
    if (!input.learnerId || !input.conceptId) dtForbidden();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction((tx) =>
          this.projectWithin(tx, input),
        );
      } catch (error) {
        lastError = error;
        const code = (error as { code?: string })?.code;
        if (!['P2002', 'P2034'].includes(code ?? '')) throw error;
      }
    }
    throw lastError;
  }

  private async projectWithin(
    db: Db,
    input: {
      learnerId: string;
      conceptId: string;
      academicContext: Prisma.InputJsonValue;
      inputIds?: string[];
    },
  ) {
    const academicContextIdentity = contextId(input.academicContext);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.learnerId}|CONCEPT|${input.conceptId}|${academicContextIdentity}|${DTP_ALGORITHM}|${DTP_CONFIG}`}))`;
    const rows = await db.evidenceRecord.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
      orderBy: [{ sourceOccurredAt: 'asc' }, { evidenceId: 'asc' }],
    });
    const signals = await db.evidenceSignal.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
    });
    const existing = await db.digitalTwinState.findUnique({
      where: {
        learnerId_targetType_targetId_academicContextIdentity_algorithmId_configId:
          {
            learnerId: input.learnerId,
            targetType: 'CONCEPT',
            targetId: input.conceptId,
            academicContextIdentity,
            algorithmId: DTP_ALGORITHM,
            configId: DTP_CONFIG,
          },
      },
    });
    const priorSnapshots = existing
      ? await db.digitalTwinSnapshot.findMany({
          where: {
            learnerId: input.learnerId,
            targetType: 'CONCEPT',
            targetId: input.conceptId,
            academicContextIdentity,
            algorithmId: DTP_ALGORITHM,
            configId: DTP_CONFIG,
          },
          select: { appliedInputIds: true },
        })
      : [];
    const applied = new Set(
      priorSnapshots.flatMap((s: any) =>
        Array.isArray(s.appliedInputIds) ? (s.appliedInputIds as string[]) : [],
      ),
    );
    const outOfOrder = Boolean(
      existing?.lastEvidenceAt &&
      rows.some(
        (r: any) =>
          (r.conceptId ?? jsonObject(r.academicContext).conceptId) ===
            input.conceptId && r.sourceOccurredAt < existing.lastEvidenceAt!,
      ),
    );
    const signalByEvidence = new Map<string, any[]>();
    for (const s of signals)
      for (const id of Array.isArray(s.sourceEvidenceIds)
        ? s.sourceEvidenceIds
        : [])
        signalByEvidence.set(String(id), [
          ...(signalByEvidence.get(String(id)) ?? []),
          s,
        ]);
    const allowed = new Set(
      input.inputIds ?? rows.map((r: any) => r.evidenceId),
    );
    const projected: ProjectionInput[] = [];
    for (const r of rows) {
      const c = r.conceptId ?? jsonObject(r.academicContext).conceptId;
      if (
        c !== input.conceptId ||
        (!outOfOrder && !allowed.has(r.evidenceId)) ||
        (!outOfOrder && applied.has(r.evidenceId))
      )
        continue;
      const ss = signalByEvidence.get(r.evidenceId) ?? [];
      const outcome = ss.find(
        (s) => s.signalType === 'SIG_RESPONSE_OUTCOME',
      )?.value;
      if (
        outcome !== 'CORRECT' &&
        outcome !== 'INCORRECT' &&
        outcome !== 'UNANSWERED'
      )
        continue;
      let weight =
        outcome === 'UNANSWERED' ? 0.5 : outcome === 'INCORRECT' ? 1 : 0.9;
      const mods = ss.filter((s) => s.signalType !== 'SIG_RESPONSE_OUTCOME');
      const assisted = mods.find(
        (s) => s.signalType === 'SIG_ASSISTED_CORRECT',
      )?.value;
      if (outcome === 'CORRECT')
        weight =
          assisted === 'HINT_AND_RETRY'
            ? 0.5
            : assisted === 'HINT'
              ? 0.65
              : assisted === 'RETRY'
                ? 0.6
                : mods.some((s) => s.signalType === 'SIG_INDEPENDENT_CORRECT')
                  ? 1
                  : 0.9;
      if (
        outcome === 'INCORRECT' &&
        mods.some(
          (s) => s.signalType === 'SIG_PERSISTENT_ERROR' && s.value === true,
        )
      )
        weight = 1.15;
      projected.push({
        inputId: r.evidenceId,
        sourceOccurredAt: r.sourceOccurredAt,
        outcome,
        weight,
      });
    }
    const ordered = orderInputs(projected);
    if (!ordered.length)
      return existing
        ? this.safeState(existing)
        : { eligible: false, reason: 'NO_ELIGIBLE_C020_INPUT' };
    const previousSnapshotId = existing?.currentSnapshotId ?? null;
    const ids = ordered.map((x) => x.inputId);
    const pid = projectionIdentity(
      input.learnerId,
      input.conceptId,
      academicContextIdentity,
      previousSnapshotId,
      ids,
    );
    const prior = await db.digitalTwinSnapshot.findUnique({
      where: { projectionId: pid },
    });
    if (prior) return this.safeSnapshot(prior);
    const previous =
      existing && !outOfOrder
        ? {
            mastery: Number(existing.mastery),
            confidence: Number(existing.confidence),
            evidenceCount: existing.evidenceCount,
            lastEvidenceAt: existing.lastEvidenceAt ?? new Date(0),
            watermark: existing.watermark ?? '',
          }
        : null;
    const next = project(previous, ordered);
    const revision = (existing?.revision ?? 0) + 1;
    const snapshot = await db.digitalTwinSnapshot.create({
      data: {
        projectionId: pid,
        learnerId: input.learnerId,
        targetType: 'CONCEPT',
        targetId: input.conceptId,
        academicContextIdentity,
        academicContext: input.academicContext,
        mastery: next.mastery,
        confidence: next.confidence,
        evidenceCount: next.evidenceCount,
        revision,
        previousSnapshotId,
        appliedInputIds: ids,
        watermark: next.watermark,
        lastEvidenceAt: next.lastEvidenceAt,
        algorithmId: DTP_ALGORITHM,
        configId: DTP_CONFIG,
        processingVersion: DTP_PROCESSING_VERSION,
        provenance: {
          evidenceIds: ids,
          signalIds: signals
            .filter((s: any) =>
              ids.some((id) =>
                (Array.isArray(s.sourceEvidenceIds)
                  ? s.sourceEvidenceIds
                  : []
                ).includes(id),
              ),
            )
            .map((s: any) => s.signalId),
          previousSnapshotId,
          academicContextIdentity,
        },
      },
    });
    if (existing) {
      const updated = await db.digitalTwinState.updateMany({
        where: { stateId: existing.stateId, revision: existing.revision },
        data: {
          mastery: next.mastery,
          confidence: next.confidence,
          evidenceCount: next.evidenceCount,
          revision,
          watermark: next.watermark,
          lastEvidenceAt: next.lastEvidenceAt,
          currentSnapshotId: snapshot.snapshotId,
        },
      });
      if (updated.count !== 1) dtConflict();
    } else
      await db.digitalTwinState.create({
        data: {
          learnerId: input.learnerId,
          targetType: 'CONCEPT',
          targetId: input.conceptId,
          academicContextIdentity,
          academicContext: input.academicContext,
          mastery: next.mastery,
          confidence: next.confidence,
          evidenceCount: next.evidenceCount,
          revision,
          watermark: next.watermark,
          lastEvidenceAt: next.lastEvidenceAt,
          algorithmId: DTP_ALGORITHM,
          configId: DTP_CONFIG,
          processingVersion: DTP_PROCESSING_VERSION,
          currentSnapshotId: snapshot.snapshotId,
        },
      });
    if (this.hooks.afterStateMutation) this.hooks.afterStateMutation();
    return this.safeSnapshot(snapshot);
  }

  async getCurrentConceptState(
    learnerId: string,
    conceptId: string,
    academicContext: Prisma.InputJsonValue,
  ) {
    if (!learnerId) dtForbidden();
    const row = await this.db.digitalTwinState.findUnique({
      where: {
        learnerId_targetType_targetId_academicContextIdentity_algorithmId_configId:
          {
            learnerId,
            targetType: 'CONCEPT',
            targetId: conceptId,
            academicContextIdentity: contextId(academicContext),
            algorithmId: DTP_ALGORITHM,
            configId: DTP_CONFIG,
          },
      },
    });
    return row ? this.safeState(row) : null;
  }

  async rebuildConceptState(input: {
    learnerId: string;
    conceptId: string;
    academicContext: Prisma.InputJsonValue;
  }) {
    if (!input.learnerId || !input.conceptId) dtForbidden();
    const academicContextIdentity = contextId(input.academicContext);
    const rows = await this.db.evidenceRecord.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
      orderBy: [{ sourceOccurredAt: 'asc' }, { evidenceId: 'asc' }],
    });
    const signals = await this.db.evidenceSignal.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
    });
    const signalIds = new Set<string>();
    const inputs: ProjectionInput[] = [];
    for (const r of rows) {
      if (
        (r.conceptId ?? jsonObject(r.academicContext).conceptId) !==
        input.conceptId
      )
        continue;
      const related = signals.filter((s: any) =>
        (Array.isArray(s.sourceEvidenceIds) ? s.sourceEvidenceIds : [])
          .map(String)
          .includes(r.evidenceId),
      );
      const outcome = related.find(
        (s: any) => s.signalType === 'SIG_RESPONSE_OUTCOME',
      )?.value;
      if (
        outcome !== 'CORRECT' &&
        outcome !== 'INCORRECT' &&
        outcome !== 'UNANSWERED'
      )
        continue;
      related.forEach((s: any) => signalIds.add(s.signalId));
      let weight =
        outcome === 'UNANSWERED' ? 0.5 : outcome === 'INCORRECT' ? 1 : 0.9;
      const assisted = related.find(
        (s: any) => s.signalType === 'SIG_ASSISTED_CORRECT',
      )?.value;
      if (outcome === 'CORRECT')
        weight =
          assisted === 'HINT_AND_RETRY'
            ? 0.5
            : assisted === 'HINT'
              ? 0.65
              : assisted === 'RETRY'
                ? 0.6
                : related.some(
                      (s: any) => s.signalType === 'SIG_INDEPENDENT_CORRECT',
                    )
                  ? 1
                  : 0.9;
      if (
        outcome === 'INCORRECT' &&
        related.some(
          (s: any) =>
            s.signalType === 'SIG_PERSISTENT_ERROR' && s.value === true,
        )
      )
        weight = 1.15;
      inputs.push({
        inputId: r.evidenceId,
        sourceOccurredAt: r.sourceOccurredAt,
        outcome,
        weight,
      });
    }
    const state = project(null, orderInputs(inputs));
    return {
      targetType: 'CONCEPT',
      targetId: input.conceptId,
      academicContextIdentity,
      ...state,
      algorithmId: DTP_ALGORITHM,
      configId: DTP_CONFIG,
      processingVersion: DTP_PROCESSING_VERSION,
      signalIds: [...signalIds],
    };
  }
  async getConceptHistory(
    learnerId: string,
    conceptId: string,
    academicContext: Prisma.InputJsonValue,
  ) {
    if (!learnerId) dtForbidden();
    const rows = await this.db.digitalTwinSnapshot.findMany({
      where: {
        learnerId,
        targetType: 'CONCEPT',
        targetId: conceptId,
        academicContextIdentity: contextId(academicContext),
        algorithmId: DTP_ALGORITHM,
        configId: DTP_CONFIG,
      },
      orderBy: { revision: 'asc' },
    });
    return rows.map((r) => this.safeSnapshot(r));
  }
  private safeState(r: any) {
    return {
      targetType: r.targetType,
      targetId: r.targetId,
      mastery: Number(r.mastery),
      confidence: Number(r.confidence),
      evidenceCount: r.evidenceCount,
      revision: r.revision,
      watermark: r.watermark,
      algorithmId: r.algorithmId,
      configId: r.configId,
      processingVersion: r.processingVersion,
      currentSnapshotId: r.currentSnapshotId,
      academicContextIdentity: r.academicContextIdentity,
    };
  }
  private safeSnapshot(r: any) {
    return {
      snapshotId: r.snapshotId,
      projectionId: r.projectionId,
      targetType: r.targetType,
      targetId: r.targetId,
      mastery: Number(r.mastery),
      confidence: Number(r.confidence),
      evidenceCount: r.evidenceCount,
      revision: r.revision,
      previousSnapshotId: r.previousSnapshotId,
      appliedInputIds: r.appliedInputIds,
      watermark: r.watermark,
      algorithmId: r.algorithmId,
      configId: r.configId,
      processingVersion: r.processingVersion,
      provenance: r.provenance,
      academicContextIdentity: r.academicContextIdentity,
    };
  }
}
