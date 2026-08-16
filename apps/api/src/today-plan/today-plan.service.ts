import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AdaptiveService, AdaptiveScope } from '../adaptive/adaptive.service';
import {
  C025_ALGORITHM_ID,
  C025_CONFIG_ID,
  C025_CONTRACT_VERSION,
  C025_ENGINE_ID,
  C025_PROCESSING_VERSION,
  C024Candidate,
  generatePlan,
  PlanScope,
  transitionItem,
  PlanItem,
  validatePostponeDate,
  validatePostponeLimit,
  canonicalAdaptiveSnapshot,
  normalizeAdaptiveSnapshot,
  C025Operation,
  foldC025FromGenesis,
  isLatePlanInput,
  PlanEvent,
  TodayPlanAdaptiveInputSnapshot,
} from './today-plan.projector';

const scopeKey = (s: PlanScope) =>
  `${s.learnerId}|${s.contextId}|${s.academicVersionId}|${s.planDateLocal}|${s.learnerTimezone}`;

@Injectable()
export class TodayPlanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly adaptive: AdaptiveService,
  ) {}

  private assertOwner(actorId: string, scope: PlanScope) {
    if (actorId !== scope.learnerId) throw new Error('UNAUTHORIZED_SCOPE');
    try {
      Intl.DateTimeFormat('en-US', { timeZone: scope.learnerTimezone });
    } catch {
      throw new Error('INVALID_TIMEZONE');
    }
  }

  async generate(
    actorId: string,
    scope: PlanScope,
    eventId: string,
    authoritativeNow: Date,
    failRebuildAt?: 'AFTER_VERSION' | 'AFTER_ITEMS' | 'AFTER_HISTORY',
  ) {
    this.assertOwner(actorId, scope);
    const adaptiveScope: AdaptiveScope = {
      learnerId: scope.learnerId,
      contextId: scope.contextId,
      academicVersionId: scope.academicVersionId,
    };
    await this.adaptive.current(actorId, adaptiveScope);
    const run = await this.db.adaptiveRun.findUnique({
      where: {
        scopeKey: createHash('sha256')
          .update(
            JSON.stringify([
              scope.learnerId,
              scope.contextId,
              scope.academicVersionId,
            ]),
          )
          .digest('hex'),
      },
    });
    const selectedId = run?.selectedCandidateId;
    const candidates = run?.activeGenerationId
      ? await this.db.adaptiveCandidate.findMany({
          where: { generationId: run.activeGenerationId, eligible: true },
          orderBy: { rank: 'asc' },
        })
      : [];
    const inputs: C024Candidate[] = candidates.map((c) => ({
      immutableCandidateId: c.immutableCandidateId,
      candidateType: c.candidateType,
      conceptId: c.conceptId,
      targetRefId: c.targetRefId,
      rank: c.rank ?? 999999,
      selected: c.immutableCandidateId === selectedId,
      available: true,
      finalScore: Number(c.finalScore),
      reasonCodes: Array.isArray(c.reasonCodes)
        ? c.reasonCodes.map(String)
        : [],
    }));
    const snapshot = normalizeAdaptiveSnapshot({
      adaptiveRunId: run?.adaptiveRunId,
      generationId: run?.activeGenerationId,
      selectedCandidateId: selectedId,
      engineId: run?.engineId,
      algorithmId: run?.algorithmId,
      configId: run?.configId,
      processingVersion: run?.processingVersion,
      contractVersion: run?.contractVersion,
      candidates: inputs,
    });
    const plan = generatePlan(
      snapshot.candidates,
      1,
      snapshot.generationId ?? undefined,
    );
    const snapshotHash = createHash('sha256')
      .update(canonicalAdaptiveSnapshot(snapshot))
      .digest('hex');
    const key = scopeKey(scope);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const lineage = await tx.todayPlanLineage.upsert({
        where: {
          learnerId_contextId_academicVersionId_planDateLocal_learnerTimezone:
            scope,
        },
        create: { ...scope, currentVersion: 1, revision: 1 },
        update: {},
      });
      const existing = await tx.todayPlanEventLedger.findUnique({
        where: {
          lineageId_immutableEventId: {
            lineageId: lineage.lineageId,
            immutableEventId: eventId,
          },
        },
      });
      if (existing) {
        if (existing.payloadHash !== snapshotHash)
          throw new Error('IMMUTABLE_EVENT_CONFLICT');
        return tx.todayPlanVersion.findUnique({
          where: {
            lineageId_planVersion: {
              lineageId: lineage.lineageId,
              planVersion: lineage.currentVersion ?? 1,
            },
          },
          include: { items: true },
        });
      }
      const incoming: PlanEvent = {
        immutableEventId: eventId,
        payloadHash: snapshotHash,
        effectiveAt: authoritativeNow,
        operationRank: 5,
      };
      if (isLatePlanInput(incoming, this.watermarkEvent(lineage.watermark))) {
        await tx.todayPlanEventLedger.create({
          data: {
            lineageId: lineage.lineageId,
            immutableEventId: eventId,
            payloadHash: snapshotHash,
            effectiveAt: authoritativeNow,
            operationRank: 5,
            actorId,
            source: 'GENERATE',
            payload: { scope, snapshot },
          },
        });
        return this.rebuildWithin(tx, lineage.lineageId, scope, failRebuildAt);
      }
      const version = await tx.todayPlanVersion.create({
        data: {
          lineageId: lineage.lineageId,
          planVersion: plan.planVersion,
          semanticVersion: plan.planVersion,
          planDateLocal: scope.planDateLocal,
          learnerTimezone: scope.learnerTimezone,
          state: plan.state,
          reason: plan.reason,
          sourceGenerationId: plan.sourceGenerationId,
          c024Binding: { generationId: run?.activeGenerationId, selectedId },
        },
      });
      const persistedItems = [];
      for (const item of plan.items)
        persistedItems.push(
          await tx.todayPlanItem.create({
            data: {
              planVersionId: version.planVersionId,
              semanticItemKey: item.semanticItemKey,
              sequence: item.sequence,
              candidateBinding: item,
              targetRefId: item.targetRefId,
              durationMinutes: item.durationMinutes,
              mandatory: item.mandatory,
              availabilitySnapshot: { available: item.available },
              state: item.state,
            },
          }),
        );
      const result = {
        planVersionId: version.planVersionId,
        planVersion: version.planVersion,
        items: persistedItems,
        reason: plan.reason,
        snapshot,
        c024Binding: { generationId: run?.activeGenerationId, selectedId },
      };
      await tx.todayPlanEventLedger.create({
        data: {
          lineageId: lineage.lineageId,
          immutableEventId: eventId,
          payloadHash: snapshotHash,
          effectiveAt: authoritativeNow,
          operationRank: 5,
          actorId,
          source: 'GENERATE',
          payload: { scope, snapshot },
        },
      });
      await tx.todayPlanProvenance.create({
        data: {
          planVersionId: version.planVersionId,
          engineId: C025_ENGINE_ID,
          algorithmId: C025_ALGORITHM_ID,
          configId: C025_CONFIG_ID,
          processingVersion: C025_PROCESSING_VERSION,
          contractVersion: C025_CONTRACT_VERSION,
          refs: { adaptiveGenerationId: run?.activeGenerationId },
        },
      });
      await tx.todayPlanLineage.update({
        where: { lineageId: lineage.lineageId },
        data: {
          currentVersion: 1,
          watermark: {
            effectiveAt: authoritativeNow.toISOString(),
            operationRank: 5,
            immutableEventId: eventId,
          },
        },
      });
      return result;
    });
  }

  async get(actorId: string, scope: PlanScope) {
    this.assertOwner(actorId, scope);
    const lineage = await this.db.todayPlanLineage.findUnique({
      where: {
        learnerId_contextId_academicVersionId_planDateLocal_learnerTimezone:
          scope,
      },
    });
    if (!lineage?.currentVersion) return { status: 'NO_PLAN', items: [] };
    return this.db.todayPlanVersion.findUnique({
      where: {
        lineageId_planVersion: {
          lineageId: lineage.lineageId,
          planVersion: lineage.currentVersion,
        },
      },
      include: { items: true },
    });
  }

  async complete(
    actorId: string,
    itemId: string,
    evidenceRef: string,
    eventId: string,
    effectiveAt: Date,
  ) {
    const item = await this.db.todayPlanItem.findUnique({
      where: { planItemId: itemId },
      include: { plan: { include: { lineage: true } } },
    });
    if (!item || item.plan.lineage.learnerId !== actorId)
      throw new Error('UNAUTHORIZED_SCOPE');
    return this.db.$transaction(async (tx) => {
      const lockKey = scopeKey({
        learnerId: item.plan.lineage.learnerId,
        contextId: item.plan.lineage.contextId,
        academicVersionId: item.plan.lineage.academicVersionId,
        planDateLocal: item.plan.lineage.planDateLocal,
        learnerTimezone: item.plan.lineage.learnerTimezone,
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      let target = item;
      const lockedLineage = await tx.todayPlanLineage.findUniqueOrThrow({
        where: { lineageId: item.plan.lineage.lineageId },
      });
      if (
        lockedLineage.currentVersion &&
        lockedLineage.currentVersion !== item.plan.planVersion
      ) {
        const currentVersion = await tx.todayPlanVersion.findUnique({
          where: {
            lineageId_planVersion: {
              lineageId: lockedLineage.lineageId,
              planVersion: lockedLineage.currentVersion,
            },
          },
        });
        if (currentVersion?.semanticVersion === item.plan.semanticVersion) {
          const currentItem = await tx.todayPlanItem.findUnique({
            where: {
              planVersionId_semanticItemKey: {
                planVersionId: currentVersion.planVersionId,
                semanticItemKey: item.semanticItemKey,
              },
            },
            include: { plan: { include: { lineage: true } } },
          });
          if (currentItem) target = currentItem;
        }
      }
      const payload = {
        itemId,
        semanticItemKey: item.semanticItemKey,
        evidenceRef,
        effectiveAt: effectiveAt.toISOString(),
      };
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      const prior = await tx.todayPlanEventLedger.findUnique({
        where: {
          lineageId_immutableEventId: {
            lineageId: item.plan.lineage.lineageId,
            immutableEventId: eventId,
          },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw new Error('IMMUTABLE_EVENT_CONFLICT');
        return tx.todayPlanItem.findUnique({
          where: { planItemId: target.planItemId },
        });
      }
      const incoming: PlanEvent = {
        immutableEventId: eventId,
        payloadHash,
        effectiveAt,
        operationRank: 1,
      };
      if (
        isLatePlanInput(
          incoming,
          this.watermarkEvent(item.plan.lineage.watermark),
        )
      ) {
        await tx.todayPlanEventLedger.create({
          data: {
            lineageId: item.plan.lineage.lineageId,
            immutableEventId: eventId,
            payloadHash,
            effectiveAt,
            operationRank: 1,
            actorId,
            source: 'COMPLETE',
            payload,
          },
        });
        return this.rebuildWithin(tx, item.plan.lineage.lineageId, {
          learnerId: item.plan.lineage.learnerId,
          contextId: item.plan.lineage.contextId,
          academicVersionId: item.plan.lineage.academicVersionId,
          planDateLocal: item.plan.lineage.planDateLocal,
          learnerTimezone: item.plan.lineage.learnerTimezone,
        });
      }
      const next = transitionItem(
        {
          ...(target.candidateBinding as unknown as PlanItem),
          planItemId: target.planItemId,
          semanticItemKey: target.semanticItemKey,
          sequence: target.sequence,
          durationMinutes: target.durationMinutes,
          mandatory: target.mandatory,
          state: target.state as PlanItem['state'],
          itemVersion: 1,
          availabilitySnapshot: true,
        },
        'COMPLETED',
        evidenceRef,
      );
      const updated = await tx.todayPlanItem.update({
        where: { planItemId: target.planItemId },
        data: {
          state: next.state,
          completionProvenance: { eventId, evidenceRef, effectiveAt },
        },
      });
      await tx.todayPlanEventLedger.create({
        data: {
          lineageId: item.plan.lineage.lineageId,
          immutableEventId: eventId,
          payloadHash,
          effectiveAt,
          operationRank: 1,
          actorId,
          source: 'COMPLETE',
          payload,
        },
      });
      return updated;
    });
  }

  async postpone(
    actorId: string,
    itemId: string,
    eventId: string,
    reasonCode: string,
    requestedDateLocal: string,
    effectiveAt: Date,
  ) {
    const foundItem = await this.db.todayPlanItem.findUnique({
      where: { planItemId: itemId },
      include: { plan: { include: { lineage: true } } },
    });
    if (!foundItem || foundItem.plan.lineage.learnerId !== actorId)
      throw new Error('UNAUTHORIZED_SCOPE');
    let item = foundItem;
    validatePostponeDate(item.plan.planDateLocal, requestedDateLocal);
    return this.db.$transaction(async (tx) => {
      const lockKey = scopeKey({
        learnerId: item.plan.lineage.learnerId,
        contextId: item.plan.lineage.contextId,
        academicVersionId: item.plan.lineage.academicVersionId,
        planDateLocal: item.plan.lineage.planDateLocal,
        learnerTimezone: item.plan.lineage.learnerTimezone,
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const lockedLineage = await tx.todayPlanLineage.findUniqueOrThrow({
        where: { lineageId: item.plan.lineage.lineageId },
      });
      if (
        lockedLineage.currentVersion &&
        lockedLineage.currentVersion !== item.plan.planVersion
      ) {
        const currentVersion = await tx.todayPlanVersion.findUnique({
          where: {
            lineageId_planVersion: {
              lineageId: lockedLineage.lineageId,
              planVersion: lockedLineage.currentVersion,
            },
          },
        });
        if (currentVersion?.semanticVersion === item.plan.semanticVersion) {
          const currentItem = await tx.todayPlanItem.findUnique({
            where: {
              planVersionId_semanticItemKey: {
                planVersionId: currentVersion.planVersionId,
                semanticItemKey: item.semanticItemKey,
              },
            },
            include: { plan: { include: { lineage: true } } },
          });
          if (currentItem) item = currentItem;
        }
      }
      const payload = { itemId, reasonCode, requestedDateLocal };
      Object.assign(payload, { semanticItemKey: item.semanticItemKey });
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      const prior = await tx.todayPlanEventLedger.findUnique({
        where: {
          lineageId_immutableEventId: {
            lineageId: item.plan.lineage.lineageId,
            immutableEventId: eventId,
          },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw new Error('IMMUTABLE_EVENT_CONFLICT');
        return tx.todayPlanVersion.findUnique({
          where: { planVersionId: item.planVersionId },
          include: { items: true },
        });
      }
      const postponeWindowStart = new Date(
        effectiveAt.getTime() - 30 * 24 * 60 * 60 * 1000,
      );
      const priorPostpones = await tx.todayPlanEventLedger.count({
        where: {
          lineageId: item.plan.lineage.lineageId,
          source: 'POSTPONE',
          effectiveAt: { gte: postponeWindowStart, lte: effectiveAt },
          payload: { path: ['semanticItemKey'], equals: item.semanticItemKey },
        },
      });
      validatePostponeLimit(priorPostpones);
      const incoming: PlanEvent = {
        immutableEventId: eventId,
        payloadHash,
        effectiveAt,
        operationRank: 3,
      };
      if (
        isLatePlanInput(
          incoming,
          this.watermarkEvent(item.plan.lineage.watermark),
        )
      ) {
        await tx.todayPlanEventLedger.create({
          data: {
            lineageId: item.plan.lineage.lineageId,
            immutableEventId: eventId,
            payloadHash,
            effectiveAt,
            operationRank: 3,
            actorId,
            source: 'POSTPONE',
            payload,
          },
        });
        return this.rebuildWithin(tx, item.plan.lineage.lineageId, {
          learnerId: item.plan.lineage.learnerId,
          contextId: item.plan.lineage.contextId,
          academicVersionId: item.plan.lineage.academicVersionId,
          planDateLocal: item.plan.lineage.planDateLocal,
          learnerTimezone: item.plan.lineage.learnerTimezone,
        });
      }
      const next = transitionItem(
        {
          ...(item.candidateBinding as unknown as PlanItem),
          planItemId: item.planItemId,
          semanticItemKey: item.semanticItemKey,
          sequence: item.sequence,
          durationMinutes: item.durationMinutes,
          mandatory: item.mandatory,
          state: item.state as PlanItem['state'],
          itemVersion: 1,
          availabilitySnapshot: true,
        },
        'POSTPONED',
      );
      await tx.todayPlanItem.update({
        where: { planItemId: itemId },
        data: { state: next.state, postponementProvenance: payload },
      });
      const newVersion =
        (item.plan.lineage.currentVersion ?? item.plan.planVersion) + 1;
      await tx.todayPlanVersion.update({
        where: { planVersionId: item.planVersionId },
        data: { state: 'SUPERSEDED' },
      });
      const version = await tx.todayPlanVersion.create({
        data: {
          lineageId: item.plan.lineage.lineageId,
          planVersion: newVersion,
          semanticVersion: newVersion,
          planDateLocal: item.plan.planDateLocal,
          learnerTimezone: item.plan.learnerTimezone,
          state: 'ACTIVE',
          reason: 'STUDENT_POSTPONED_ITEM',
          c024Binding: item.plan.c024Binding as Prisma.InputJsonValue,
        },
      });
      const completed = await tx.todayPlanItem.findMany({
        where: { planVersionId: item.planVersionId, state: 'COMPLETED' },
        orderBy: { sequence: 'asc' },
      });
      for (const old of completed)
        await tx.todayPlanItem.create({
          data: {
            planVersionId: version.planVersionId,
            semanticItemKey: old.semanticItemKey,
            sequence: old.sequence,
            candidateBinding: old.candidateBinding as Prisma.InputJsonValue,
            targetRefId: old.targetRefId,
            durationMinutes: old.durationMinutes,
            mandatory: old.mandatory,
            availabilitySnapshot:
              old.availabilitySnapshot as Prisma.InputJsonValue,
            state: 'COMPLETED',
            itemVersion: old.itemVersion,
            completionProvenance:
              old.completionProvenance as Prisma.InputJsonValue,
          },
        });
      await tx.todayPlanEventLedger.create({
        data: {
          lineageId: item.plan.lineage.lineageId,
          immutableEventId: eventId,
          payloadHash,
          effectiveAt,
          operationRank: 3,
          actorId,
          source: 'POSTPONE',
          payload,
        },
      });
      await tx.todayPlanLineage.update({
        where: { lineageId: item.plan.lineage.lineageId },
        data: {
          currentVersion: newVersion,
          revision: { increment: 1 },
          watermark: {
            effectiveAt: effectiveAt.toISOString(),
            operationRank: 3,
            immutableEventId: eventId,
          },
        },
      });
      return version;
    });
  }

  async replan(
    actorId: string,
    scope: PlanScope,
    eventId: string,
    effectiveAt: Date,
    reason = 'EXPLICIT_REQUEST',
  ) {
    this.assertOwner(actorId, scope);
    const current = await this.get(actorId, scope);
    if (!current || !('planVersionId' in current)) return current;
    const lineage = await this.db.todayPlanLineage.findUnique({
      where: {
        learnerId_contextId_academicVersionId_planDateLocal_learnerTimezone:
          scope,
      },
    });
    if (!lineage) return current;
    const run = await this.db.adaptiveRun.findUnique({
      where: {
        scopeKey: createHash('sha256')
          .update(
            JSON.stringify([
              scope.learnerId,
              scope.contextId,
              scope.academicVersionId,
            ]),
          )
          .digest('hex'),
      },
    });
    const selectedId = run?.selectedCandidateId;
    const candidates = run?.activeGenerationId
      ? await this.db.adaptiveCandidate.findMany({
          where: { generationId: run.activeGenerationId, eligible: true },
          orderBy: { rank: 'asc' },
        })
      : [];
    const inputs: C024Candidate[] = candidates.map((c) => ({
      immutableCandidateId: c.immutableCandidateId,
      candidateType: c.candidateType,
      conceptId: c.conceptId,
      targetRefId: c.targetRefId,
      rank: c.rank ?? 999999,
      selected: c.immutableCandidateId === selectedId,
      available: true,
      finalScore: Number(c.finalScore),
      reasonCodes: Array.isArray(c.reasonCodes)
        ? c.reasonCodes.map(String)
        : [],
    }));
    const snapshot = normalizeAdaptiveSnapshot({
      adaptiveRunId: run?.adaptiveRunId,
      generationId: run?.activeGenerationId,
      selectedCandidateId: selectedId,
      engineId: run?.engineId,
      algorithmId: run?.algorithmId,
      configId: run?.configId,
      processingVersion: run?.processingVersion,
      contractVersion: run?.contractVersion,
      candidates: inputs,
    });
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey(scope)}))`;
      const lockedLineage = await tx.todayPlanLineage.findUniqueOrThrow({
        where: { lineageId: lineage.lineageId },
      });
      const payload = {
        scope,
        reason,
        snapshot,
        c024Binding: { generationId: run?.activeGenerationId, selectedId },
      };
      const payloadHash = createHash('sha256')
        .update(canonicalAdaptiveSnapshot(snapshot))
        .digest('hex');
      const prior = await tx.todayPlanEventLedger.findUnique({
        where: {
          lineageId_immutableEventId: {
            lineageId: lineage.lineageId,
            immutableEventId: eventId,
          },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw new Error('IMMUTABLE_EVENT_CONFLICT');
        return current;
      }
      const incoming: PlanEvent = {
        immutableEventId: eventId,
        payloadHash,
        effectiveAt,
        operationRank: 4,
      };
      if (isLatePlanInput(incoming, this.watermarkEvent(lineage.watermark))) {
        await tx.todayPlanEventLedger.create({
          data: {
            lineageId: lineage.lineageId,
            immutableEventId: eventId,
            payloadHash,
            effectiveAt,
            operationRank: 4,
            actorId,
            source: 'REPLAN',
            payload,
          },
        });
        return this.rebuildWithin(tx, lineage.lineageId, scope);
      }
      const old = await tx.todayPlanVersion.findUnique({
        where: {
          lineageId_planVersion: {
            lineageId: lockedLineage.lineageId,
            planVersion: lockedLineage.currentVersion ?? current.planVersion,
          },
        },
        include: { items: true },
      });
      if (!old) return current;
      const version = await tx.todayPlanVersion.create({
        data: {
          lineageId: lineage.lineageId,
          planVersion: (lockedLineage.currentVersion ?? 0) + 1,
          semanticVersion: old.semanticVersion + 1,
          planDateLocal: scope.planDateLocal,
          learnerTimezone: scope.learnerTimezone,
          state: 'ACTIVE',
          reason,
          c024Binding: {
            generationId: run?.activeGenerationId,
            selectedId,
          } as Prisma.InputJsonValue,
        },
      });
      for (const x of old.items.filter((i) => i.state === 'COMPLETED'))
        await tx.todayPlanItem.create({
          data: {
            planVersionId: version.planVersionId,
            semanticItemKey: x.semanticItemKey,
            sequence: x.sequence,
            candidateBinding: x.candidateBinding as Prisma.InputJsonValue,
            targetRefId: x.targetRefId,
            durationMinutes: x.durationMinutes,
            mandatory: x.mandatory,
            availabilitySnapshot:
              x.availabilitySnapshot as Prisma.InputJsonValue,
            state: 'COMPLETED',
            itemVersion: x.itemVersion,
            completionProvenance:
              x.completionProvenance as Prisma.InputJsonValue,
          },
        });
      const completedKeys = new Set(
        old.items
          .filter((i) => i.state === 'COMPLETED')
          .map((i) => i.semanticItemKey),
      );
      const generated = generatePlan(
        inputs,
        version.planVersion,
        run?.activeGenerationId ?? undefined,
      );
      for (const [index, item] of generated.items
        .filter((i) => !completedKeys.has(i.semanticItemKey))
        .entries())
        await tx.todayPlanItem.create({
          data: {
            planVersionId: version.planVersionId,
            semanticItemKey: item.semanticItemKey,
            sequence: completedKeys.size + index + 1,
            candidateBinding: item as unknown as Prisma.InputJsonValue,
            targetRefId: item.targetRefId,
            durationMinutes: item.durationMinutes,
            mandatory: item.mandatory,
            availabilitySnapshot: { available: item.available },
            state: item.state,
          },
        });
      await tx.todayPlanVersion.update({
        where: { planVersionId: old.planVersionId },
        data: { state: 'SUPERSEDED' },
      });
      await tx.todayPlanEventLedger.create({
        data: {
          lineageId: lineage.lineageId,
          immutableEventId: eventId,
          payloadHash,
          effectiveAt,
          operationRank: 4,
          actorId,
          source: 'REPLAN',
          payload,
        },
      });
      await tx.todayPlanLineage.update({
        where: { lineageId: lineage.lineageId },
        data: {
          currentVersion: version.planVersion,
          revision: { increment: 1 },
          watermark: {
            effectiveAt: effectiveAt.toISOString(),
            operationRank: 4,
            immutableEventId: eventId,
          },
        },
      });
      return version;
    });
  }

  async rebuildTodayPlanLineage(
    actorId: string,
    scope: PlanScope,
    failAt?: 'AFTER_VERSION' | 'AFTER_ITEMS' | 'AFTER_HISTORY',
  ) {
    this.assertOwner(actorId, scope);
    return this.db.$transaction(async (tx) => {
      const lineage = await tx.todayPlanLineage.findUnique({
        where: {
          learnerId_contextId_academicVersionId_planDateLocal_learnerTimezone:
            scope,
        },
      });
      if (!lineage) throw new Error('REPLAN_FAILED');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey(scope)}))`;
      return this.rebuildWithin(tx, lineage.lineageId, scope, failAt);
    });
  }

  private watermarkEvent(value: Prisma.JsonValue | null): PlanEvent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const row = value as Prisma.JsonObject;
    if (!row.effectiveAt || !row.operationRank || !row.immutableEventId)
      return null;
    return {
      effectiveAt: new Date(String(row.effectiveAt)),
      operationRank: Number(row.operationRank) as PlanEvent['operationRank'],
      immutableEventId: String(row.immutableEventId),
      payloadHash: '',
    };
  }

  private ledgerOperation(
    row: {
      immutableEventId: string;
      payloadHash: string;
      effectiveAt: Date;
      operationRank: number;
      source: string;
      payload: Prisma.JsonValue;
    },
    scope: PlanScope,
  ): C025Operation {
    const payload = row.payload as Prisma.JsonObject;
    const snapshot = payload.snapshot as unknown as
      TodayPlanAdaptiveInputSnapshot | undefined;
    if ((row.source === 'GENERATE' || row.source === 'REPLAN') && !snapshot)
      throw new Error('REBUILD_FAILED');
    return {
      immutableEventId: row.immutableEventId,
      payloadHash: row.payloadHash,
      effectiveAt: row.effectiveAt,
      operationRank: row.operationRank as C025Operation['operationRank'],
      type: row.source as C025Operation['type'],
      scope,
      payload: {
        snapshot,
        itemId: payload.itemId ? String(payload.itemId) : undefined,
        semanticItemKey: payload.semanticItemKey
          ? String(payload.semanticItemKey)
          : undefined,
        evidenceRef: payload.evidenceRef
          ? String(payload.evidenceRef)
          : undefined,
        requestedDateLocal: payload.requestedDateLocal
          ? String(payload.requestedDateLocal)
          : undefined,
        reasonCode: payload.reasonCode ? String(payload.reasonCode) : undefined,
      },
    };
  }

  private async rebuildWithin(
    tx: Prisma.TransactionClient,
    lineageId: string,
    scope: PlanScope,
    failAt?: 'AFTER_VERSION' | 'AFTER_ITEMS' | 'AFTER_HISTORY',
  ) {
    const rows = await tx.todayPlanEventLedger.findMany({
      where: { lineageId },
      orderBy: [
        { effectiveAt: 'asc' },
        { operationRank: 'asc' },
        { immutableEventId: 'asc' },
      ],
    });
    const operations = rows.map((row) => this.ledgerOperation(row, scope));
    const rebuilt = foldC025FromGenesis(operations);
    if (!rebuilt.current || !rebuilt.watermark)
      throw new Error('REBUILD_FAILED');
    const lineage = await tx.todayPlanLineage.findUniqueOrThrow({
      where: { lineageId },
    });
    const physicalVersion = (lineage.currentVersion ?? 0) + 1;
    const generationId = createHash('sha256')
      .update(
        rows
          .map((row) => `${row.immutableEventId}:${row.payloadHash}`)
          .join('|'),
      )
      .digest('hex');
    const existingHistory = await tx.todayPlanHistory.findUnique({
      where: { lineageId_generationId: { lineageId, generationId } },
    });
    if (existingHistory) return this.get(scope.learnerId, scope);
    if (lineage.currentVersion) {
      const old = await tx.todayPlanVersion.findUnique({
        where: {
          lineageId_planVersion: {
            lineageId,
            planVersion: lineage.currentVersion,
          },
        },
      });
      if (old?.state === 'ACTIVE')
        await tx.todayPlanVersion.update({
          where: { planVersionId: old.planVersionId },
          data: { state: 'SUPERSEDED' },
        });
    }
    const latestSnapshot = [...operations]
      .reverse()
      .find((operation) => operation.payload.snapshot)?.payload.snapshot;
    const version = await tx.todayPlanVersion.create({
      data: {
        lineageId,
        planVersion: physicalVersion,
        semanticVersion: rebuilt.current.planVersion,
        rebuildGeneration: generationId,
        planDateLocal: scope.planDateLocal,
        learnerTimezone: scope.learnerTimezone,
        state: rebuilt.current.state,
        reason: rebuilt.current.reason,
        sourceGenerationId: rebuilt.current.sourceGenerationId,
        c024Binding: (latestSnapshot ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (failAt === 'AFTER_VERSION') throw new Error('INJECTED_FAILURE');
    for (const item of rebuilt.current.items)
      await tx.todayPlanItem.create({
        data: {
          planVersionId: version.planVersionId,
          semanticItemKey: item.semanticItemKey,
          sequence: item.sequence,
          candidateBinding: item as unknown as Prisma.InputJsonValue,
          targetRefId: item.targetRefId,
          durationMinutes: item.durationMinutes,
          mandatory: item.mandatory,
          availabilitySnapshot: { available: item.available },
          state: item.state,
          completionProvenance: item.completionEvidenceRef
            ? { evidenceRef: item.completionEvidenceRef }
            : undefined,
        },
      });
    if (failAt === 'AFTER_ITEMS') throw new Error('INJECTED_FAILURE');
    const watermark = {
      effectiveAt: rebuilt.watermark.effectiveAt.toISOString(),
      operationRank: rebuilt.watermark.operationRank,
      immutableEventId: rebuilt.watermark.immutableEventId,
    };
    await tx.todayPlanHistory.create({
      data: {
        lineageId,
        generationId,
        planVersion: rebuilt.current.planVersion,
        intent: {
          type: 'REBUILD',
          eventIds: rows.map((row) => row.immutableEventId),
        },
        watermark,
      },
    });
    await tx.todayPlanProvenance.create({
      data: {
        planVersionId: version.planVersionId,
        engineId: C025_ENGINE_ID,
        algorithmId: C025_ALGORITHM_ID,
        configId: C025_CONFIG_ID,
        processingVersion: C025_PROCESSING_VERSION,
        contractVersion: C025_CONTRACT_VERSION,
        refs: { generationId, snapshot: latestSnapshot ?? null },
      },
    });
    if (failAt === 'AFTER_HISTORY') throw new Error('INJECTED_FAILURE');
    await tx.todayPlanLineage.update({
      where: { lineageId },
      data: {
        currentVersion: physicalVersion,
        revision: { increment: 1 },
        watermark,
      },
    });
    return tx.todayPlanVersion.findUnique({
      where: { planVersionId: version.planVersionId },
      include: { items: true },
    });
  }
}
