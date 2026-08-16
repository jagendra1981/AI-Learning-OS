/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  MISTAKE_DNA_CONFIG,
  MISTAKE_DNA_ENGINE,
  MISTAKE_DNA_PROCESSING_VERSION,
  MistakeInput,
  orderMistakeInputs,
  taxonomyFor,
  mistakeSignature,
  compareMistakeInputs,
  foldMistakeDnaInputs,
  mistakeDnaGenesis,
  mistakeDnaTransition,
  restoreRemediationQuestionVersions,
  toMistakeDnaSemanticState,
} from './mistake-dna.projector';
import { mdConflict, mdForbidden } from './mistake-dna.errors';
type Db = DatabaseService | Prisma.TransactionClient;
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const contextId = (v: unknown) =>
  createHash('sha256').update(stable(v)).digest('hex');
const obj = (v: any) =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const contextMatches = (actual: unknown, requested: unknown) =>
  Object.entries(obj(requested)).every(
    ([key, value]) => stable(obj(actual)[key]) === stable(value),
  );

@Injectable()
export class MistakeDnaService {
  constructor(
    private readonly db: DatabaseService,
    @Optional()
    private readonly hooks: { afterPatternMutation?: () => void } = {},
  ) {}
  async processConceptMistakes(input: {
    learnerId: string;
    conceptId: string;
    academicContext: Prisma.InputJsonValue;
    asOf?: Date;
  }) {
    if (!input.learnerId || !input.conceptId) mdForbidden();
    return this.db.$transaction((tx) => this.processWithin(tx, input));
  }
  async rebuildConceptMistakes(input: {
    learnerId: string;
    conceptId: string;
    academicContext: Prisma.InputJsonValue;
    asOf?: Date;
  }) {
    if (!input.learnerId || !input.conceptId) mdForbidden();
    return this.db.$transaction((tx) =>
      this.processWithin(tx, { ...input, forceRebuild: true }),
    );
  }
  private async processWithin(
    db: Db,
    input: {
      learnerId: string;
      conceptId: string;
      academicContext: Prisma.InputJsonValue;
      asOf?: Date;
      forceRebuild?: boolean;
    },
  ) {
    const context = contextId(input.academicContext);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.learnerId}|CONCEPT|${input.conceptId}|${context}|${MISTAKE_DNA_ENGINE}|${MISTAKE_DNA_CONFIG}`}))`;
    const rows = await db.evidenceRecord.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
      orderBy: [{ sourceOccurredAt: 'asc' }, { evidenceId: 'asc' }],
    });
    const signals = await db.evidenceSignal.findMany({
      where: { learnerId: input.learnerId, processingVersion: 'c020-v1' },
    });
    const inputs: MistakeInput[] = [];
    for (const r of rows) {
      if ((r.conceptId ?? obj(r.academicContext).conceptId) !== input.conceptId)
        continue;
      if (!contextMatches(r.academicContext, input.academicContext)) continue;
      const related = signals.filter((s: any) =>
        (Array.isArray(s.sourceEvidenceIds) ? s.sourceEvidenceIds : [])
          .map(String)
          .includes(r.evidenceId),
      );
      const outcome = related.find(
        (s: any) => s.signalType === 'SIG_RESPONSE_OUTCOME',
      )?.value;
      const taxonomy = taxonomyFor(
        outcome,
        related.map((s: any) => ({ type: s.signalType, value: s.value })),
      );
      if (!taxonomy) continue;
      inputs.push({
        inputId: r.evidenceId,
        signalIds: related.map((s: any) => String(s.signalId)).sort(),
        sourceOccurredAt: r.sourceOccurredAt,
        conceptId: input.conceptId,
        questionVersionId: r.questionVersionId,
        taxonomy,
        persistent: related.some(
          (s: any) =>
            s.signalType === 'SIG_PERSISTENT_ERROR' && s.value === true,
        ),
        assisted: related.some((s: any) =>
          [
            'SIG_ASSISTED_CORRECT',
            'SIG_ASSISTANCE_USED',
            'SIG_RETRY_USED',
          ].includes(s.signalType),
        ),
        hintUsed: related.some(
          (s: any) => s.signalType === 'SIG_ASSISTANCE_USED',
        ),
        retryUsed: related.some((s: any) => s.signalType === 'SIG_RETRY_USED'),
        outcome:
          outcome === 'CORRECT' ||
          outcome === 'INCORRECT' ||
          outcome === 'UNANSWERED'
            ? outcome
            : undefined,
        context,
      });
    }
    const priorTransitions = await db.mistakeDnaTransition.findMany({
      where: { learnerId: input.learnerId },
      select: { occurrenceInputIds: true, patternSignature: true },
    });
    for (const candidate of inputs) {
      const signature = mistakeSignature(
        input.learnerId,
        input.conceptId,
        candidate.taxonomy,
        context,
      );
      const conflicting = priorTransitions.some((transition: any) => {
        const ids = Array.isArray(transition.occurrenceInputIds)
          ? transition.occurrenceInputIds.map(String)
          : [];
        return (
          ids.includes(candidate.inputId) &&
          transition.patternSignature !== signature
        );
      });
      if (conflicting) mdConflict();
    }
    const ordered = orderMistakeInputs(inputs);
    const grouped = new Map<string, MistakeInput[]>();
    for (const x of ordered) {
      const sig = mistakeSignature(
        input.learnerId,
        input.conceptId,
        x.taxonomy,
        context,
      );
      grouped.set(sig, [...(grouped.get(sig) ?? []), x]);
    }
    const results = [];
    for (const [signature, occurrences] of grouped) {
      const taxonomy = occurrences[0].taxonomy;
      const existing = await db.mistakeDnaPattern.findUnique({
        where: {
          learnerId_targetType_conceptId_taxonomyCode_academicContextIdentity_engineId_configId:
            {
              learnerId: input.learnerId,
              targetType: 'CONCEPT',
              conceptId: input.conceptId,
              taxonomyCode: taxonomy,
              academicContextIdentity: context,
              engineId: MISTAKE_DNA_ENGINE,
              configId: MISTAKE_DNA_CONFIG,
            },
        },
      });
      const applied = existing
        ? await db.mistakeDnaTransition.findMany({
            where: {
              patternId: existing.patternId,
              ...(existing.activeGenerationId
                ? { generationId: existing.activeGenerationId }
                : {}),
            },
            select: { occurrenceInputIds: true, remediationInputIds: true },
          })
        : [];
      const remediationInputs: MistakeInput[] = existing
        ? rows.flatMap((r: any) => {
            if (
              (r.conceptId ?? obj(r.academicContext).conceptId) !==
              input.conceptId
            )
              return [];
            if (!contextMatches(r.academicContext, input.academicContext))
              return [];
            const related = signals.filter((s: any) =>
              (Array.isArray(s.sourceEvidenceIds) ? s.sourceEvidenceIds : [])
                .map(String)
                .includes(r.evidenceId),
            );
            const outcome = related.find(
              (s: any) => s.signalType === 'SIG_RESPONSE_OUTCOME',
            )?.value;
            if (outcome !== 'CORRECT') return [];
            return [
              {
                inputId: r.evidenceId,
                signalIds: related.map((s: any) => String(s.signalId)).sort(),
                sourceOccurredAt: r.sourceOccurredAt,
                conceptId: input.conceptId,
                questionVersionId: r.questionVersionId,
                taxonomy,
                persistent: false,
                assisted: related.some(
                  (s: any) => s.signalType === 'SIG_ASSISTED_CORRECT',
                ),
                hintUsed: related.some(
                  (s: any) => s.signalType === 'SIG_ASSISTANCE_USED',
                ),
                retryUsed: related.some(
                  (s: any) => s.signalType === 'SIG_RETRY_USED',
                ),
                outcome: 'CORRECT' as const,
                context,
              },
            ];
          })
        : [];
      const authoritativeInputs = orderMistakeInputs([
        ...occurrences,
        ...remediationInputs,
      ]);
      const seen = new Set(
        applied.flatMap((x: any) => [
          ...(Array.isArray(x.occurrenceInputIds) ? x.occurrenceInputIds : []),
          ...(Array.isArray(x.remediationInputIds)
            ? x.remediationInputIds
            : []),
        ]),
      );
      let rebuildPattern = input.forceRebuild === true && existing !== null;
      if (!rebuildPattern && existing?.watermark) {
        const watermarkInput = authoritativeInputs.find(
          (x) => x.inputId === existing.watermark,
        );
        rebuildPattern = authoritativeInputs.some(
          (x) =>
            !seen.has(x.inputId) &&
            watermarkInput !== undefined &&
            compareMistakeInputs(x, watermarkInput) < 0,
        );
      }
      if (
        !rebuildPattern &&
        existing !== null &&
        authoritativeInputs.some((item) => !seen.has(item.inputId))
      )
        rebuildPattern = true;
      let fresh = orderMistakeInputs([
        ...(rebuildPattern
          ? authoritativeInputs
          : authoritativeInputs.filter((x) => !seen.has(x.inputId))),
        ...(input.asOf && (rebuildPattern || !authoritativeInputs.length)
          ? [
              {
                inputId: `expiry:${input.asOf.toISOString()}`,
                signalIds: [],
                sourceOccurredAt: input.asOf,
                conceptId: input.conceptId,
                taxonomy,
                persistent: false,
                assisted: false,
                outcome: undefined,
                expiryCheck: true,
                context,
              } as MistakeInput,
            ]
          : []),
      ]);
      if (!fresh.length && existing && input.asOf)
        fresh = [
          {
            inputId: `expiry:${input.asOf.toISOString()}`,
            signalIds: [],
            sourceOccurredAt: input.asOf,
            conceptId: input.conceptId,
            taxonomy,
            persistent: false,
            assisted: false,
            outcome: undefined,
            expiryCheck: true,
            context,
          },
        ];
      if (!fresh.length) {
        if (existing) results.push(this.safe(existing));
        continue;
      }
      let semantic: import('./mistake-dna.projector').MistakeDnaSemanticState =
        rebuildPattern
          ? mistakeDnaGenesis()
          : existing
            ? toMistakeDnaSemanticState(existing)
            : mistakeDnaGenesis();
      if (existing && !rebuildPattern) {
        const remediationIds = new Set(
          applied.flatMap((x: any) =>
            Array.isArray(x.remediationInputIds) ? x.remediationInputIds : [],
          ),
        );
        semantic.remediationQuestionVersions =
          restoreRemediationQuestionVersions(
            semantic,
            rows.map((r: any) => ({
              inputId: r.evidenceId,
              sourceOccurredAt: r.sourceOccurredAt,
              questionVersionId: r.questionVersionId,
            })),
            remediationIds,
          );
      }
      const folded = foldMistakeDnaInputs(
        semantic,
        fresh,
        mistakeDnaTransition,
      );
      semantic = folded.state;
      const historyIntents = folded.historyIntents;
      if (fresh.every((item) => item.expiryCheck) && !historyIntents.length) {
        results.push(this.safe(existing));
        continue;
      }
      const occurrenceCount = semantic.lifetimeOccurrenceCount;
      const recurrenceCount = semantic.recurrenceCount;
      const severity = semantic.severity;
      const confidence = semantic.confidence;
      const revision = (existing?.revision ?? 0) + 1;
      const ids = fresh.map((x) => x.inputId);
      const semanticWatermark =
        [...fresh].reverse().find((item) => !item.expiryCheck)?.inputId ??
        existing?.watermark ??
        null;
      const previous = existing?.currentTransitionId ?? null;
      const projectionId = createHash('sha256')
        .update(
          [
            MISTAKE_DNA_PROCESSING_VERSION,
            signature,
            previous ?? 'GENESIS',
            ...ids,
            MISTAKE_DNA_ENGINE,
            MISTAKE_DNA_CONFIG,
          ].join('|'),
        )
        .digest('hex');
      const prior = rebuildPattern
        ? null
        : await db.mistakeDnaTransition.findUnique({
            where: { projectionId },
          });
      if (prior) {
        results.push(this.safe(existing));
        continue;
      }
      const data: any = {
        learnerId: input.learnerId,
        targetType: 'CONCEPT',
        conceptId: input.conceptId,
        taxonomyCode: taxonomy,
        patternSignature: signature,
        academicContextIdentity: context,
        academicContext: input.academicContext,
        state: semantic.state,
        lifetimeOccurrenceCount: occurrenceCount,
        recurrenceCount,
        remediationSuccessStreak: semantic.remediationSuccessStreak,
        reappearanceCount: semantic.reappearanceCount,
        severity,
        confidence,
        firstSeenAt: semantic.firstSeenAt,
        lastSeenAt: semantic.lastSeenAt,
        confirmedAt: semantic.confirmedAt,
        remediatingAt: semantic.remediationFirstAt,
        resolvedAt: semantic.resolvedAt,
        resolutionReason: semantic.resolutionReason,
        reappearedAt: semantic.reappearedAt,
        revision,
        watermark: semanticWatermark,
        engineId: MISTAKE_DNA_ENGINE,
        configId: MISTAKE_DNA_CONFIG,
        processingVersion: MISTAKE_DNA_PROCESSING_VERSION,
        currentTransitionId: null,
      };
      const patternRow: any =
        existing ??
        (await db.mistakeDnaPattern.create({
          data: { ...data, currentTransitionId: null },
        }));
      const generationInputs = rebuildPattern ? fresh : authoritativeInputs;
      const generationInputIds = generationInputs.map((item) => item.inputId);
      const generationFingerprint = createHash('sha256')
        .update(
          [
            signature,
            MISTAKE_DNA_ENGINE,
            MISTAKE_DNA_CONFIG,
            MISTAKE_DNA_PROCESSING_VERSION,
            ...generationInputIds,
            ...generationInputs.flatMap((item) => item.signalIds ?? []),
          ].join('|'),
        )
        .digest('hex');
      const generation =
        !rebuildPattern && existing?.activeGenerationId
          ? await db.mistakeDnaProjectionGeneration.findUniqueOrThrow({
              where: { generationId: existing.activeGenerationId },
            })
          : await db.mistakeDnaProjectionGeneration.upsert({
              where: { logicalGenerationKey: generationFingerprint },
              update: {},
              create: {
                logicalGenerationKey: generationFingerprint,
                learnerId: input.learnerId,
                conceptId: input.conceptId,
                patternSignature: signature,
                academicContextIdentity: context,
                engineId: MISTAKE_DNA_ENGINE,
                configId: MISTAKE_DNA_CONFIG,
                processingVersion: MISTAKE_DNA_PROCESSING_VERSION,
                watermark: semanticWatermark,
                inputIds: generationInputIds,
                fingerprint: generationFingerprint,
              },
            });
      if (rebuildPattern) {
        let rebuiltTransitions = await db.mistakeDnaTransition.findMany({
          where: {
            patternId: patternRow.patternId,
            generationId: generation.generationId,
          },
          orderBy: { semanticOrder: 'asc' },
        });
        if (!rebuiltTransitions.length) {
          let previousTransitionId: string | null = null;
          for (const [semanticOrder, intent] of historyIntents.entries()) {
            const rebuiltProjectionId = createHash('sha256')
              .update(
                [
                  MISTAKE_DNA_PROCESSING_VERSION,
                  generationFingerprint,
                  semanticOrder,
                  intent.inputId,
                  intent.reason,
                ].join('|'),
              )
              .digest('hex');
            const rebuiltTransition: { transitionId: string } =
              await db.mistakeDnaTransition.create({
                data: {
                  projectionId: rebuiltProjectionId,
                  patternId: patternRow.patternId,
                  learnerId: input.learnerId,
                  targetType: 'CONCEPT',
                  conceptId: input.conceptId,
                  patternSignature: signature,
                  academicContextIdentity: context,
                  fromState: intent.fromState,
                  toState: intent.toState,
                  occurrenceInputIds: intent.occurrenceInputIds,
                  remediationInputIds: intent.remediationInputIds,
                  severity: intent.severity,
                  confidence: intent.confidence,
                  lifetimeOccurrenceCount: intent.lifetimeOccurrenceCount,
                  recurrenceCount: intent.recurrenceCount,
                  remediationSuccessStreak: intent.remediationSuccessStreak,
                  reappearanceCount: intent.reappearanceCount,
                  previousTransitionId,
                  watermark: intent.inputId,
                  reasonCode: intent.reason,
                  provenance: {
                    evidenceIds: [intent.inputId],
                    signalIds: intent.signalIds,
                    context,
                    ...(intent.reappearance
                      ? {
                          reappearanceWithinWindow:
                            intent.reappearance.withinWindow,
                          reappearanceWindowDays:
                            intent.reappearance.windowDays,
                          resolutionReferenceAt:
                            intent.reappearance.resolutionReferenceAt,
                        }
                      : {}),
                  },
                  engineId: MISTAKE_DNA_ENGINE,
                  configId: MISTAKE_DNA_CONFIG,
                  processingVersion: MISTAKE_DNA_PROCESSING_VERSION,
                  generationId: generation.generationId,
                  semanticOrder,
                },
              });
            previousTransitionId = rebuiltTransition.transitionId;
          }
          rebuiltTransitions = await db.mistakeDnaTransition.findMany({
            where: {
              patternId: patternRow.patternId,
              generationId: generation.generationId,
            },
            orderBy: { semanticOrder: 'asc' },
          });
        }
        data.currentTransitionId = rebuiltTransitions.at(-1)?.transitionId;
        data.activeGenerationId = generation.generationId;
        const rebuiltPattern = await db.mistakeDnaPattern.updateMany({
          where: {
            patternId: existing!.patternId,
            revision: existing!.revision,
          },
          data,
        });
        if (rebuiltPattern.count !== 1) mdConflict();
        if (this.hooks.afterPatternMutation) this.hooks.afterPatternMutation();
        results.push(this.safe({ ...existing, ...data }));
        continue;
      }
      const semanticOrder = await db.mistakeDnaTransition.count({
        where: { generationId: generation.generationId },
      });
      let currentTransitionId = previous;
      for (const [offset, intent] of historyIntents.entries()) {
        const transition = await db.mistakeDnaTransition.create({
          data: {
            projectionId: createHash('sha256')
              .update([projectionId, offset, intent.inputId].join('|'))
              .digest('hex'),
            patternId: patternRow.patternId,
            learnerId: input.learnerId,
            targetType: 'CONCEPT',
            conceptId: input.conceptId,
            patternSignature: signature,
            academicContextIdentity: context,
            fromState: intent.fromState,
            toState: intent.toState,
            occurrenceInputIds: intent.occurrenceInputIds,
            remediationInputIds: intent.remediationInputIds,
            severity: intent.severity,
            confidence: intent.confidence,
            lifetimeOccurrenceCount: intent.lifetimeOccurrenceCount,
            recurrenceCount: intent.recurrenceCount,
            remediationSuccessStreak: intent.remediationSuccessStreak,
            reappearanceCount: intent.reappearanceCount,
            previousTransitionId: currentTransitionId,
            watermark: intent.inputId,
            reasonCode: intent.reason,
            provenance: {
              evidenceIds: [intent.inputId],
              signalIds: intent.signalIds,
              context,
              ...(intent.reappearance
                ? {
                    reappearanceWithinWindow: intent.reappearance.withinWindow,
                    reappearanceWindowDays: intent.reappearance.windowDays,
                    resolutionReferenceAt:
                      intent.reappearance.resolutionReferenceAt,
                  }
                : {}),
            },
            engineId: MISTAKE_DNA_ENGINE,
            configId: MISTAKE_DNA_CONFIG,
            processingVersion: MISTAKE_DNA_PROCESSING_VERSION,
            generationId: generation.generationId,
            semanticOrder: semanticOrder + offset,
          },
        });
        currentTransitionId = transition.transitionId;
      }
      data.currentTransitionId = currentTransitionId;
      data.activeGenerationId = generation.generationId;
      data.reappearanceCount = semantic.reappearanceCount;
      const pattern = existing
        ? await db.mistakeDnaPattern.updateMany({
            where: {
              patternId: existing.patternId,
              revision: existing.revision,
            },
            data,
          })
        : await db.mistakeDnaPattern.update({
            where: { patternId: patternRow.patternId },
            data,
          });
      if (existing && (pattern as any).count !== 1) mdConflict();
      if (this.hooks.afterPatternMutation) this.hooks.afterPatternMutation();
      results.push(existing ? this.safe(existing) : data);
    }
    return results;
  }
  async getCurrentMistakePatterns(learnerId: string, conceptId?: string) {
    if (!learnerId) mdForbidden();
    const rows = await this.db.mistakeDnaPattern.findMany({
      where: { learnerId, ...(conceptId ? { conceptId } : {}) },
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map((x) => this.safe(x));
  }
  async getMistakeHistory(learnerId: string, conceptId: string) {
    if (!learnerId) mdForbidden();
    const active = await this.db.mistakeDnaPattern.findFirst({
      where: { learnerId, conceptId },
      orderBy: { updatedAt: 'desc' },
      select: { activeGenerationId: true },
    });
    const rows = await this.db.mistakeDnaTransition.findMany({
      where: {
        learnerId,
        conceptId,
        ...(active?.activeGenerationId
          ? { generationId: active.activeGenerationId }
          : {}),
      },
      orderBy: { semanticOrder: 'asc' },
    });
    return rows.map((x) => this.safe(x));
  }
  private safe(x: any) {
    return {
      transitionId: x.transitionId,
      patternId: x.patternId,
      conceptId: x.conceptId,
      taxonomyCode: x.taxonomyCode,
      state: x.state,
      severity: Number(x.severity),
      confidence: Number(x.confidence),
      lifetimeOccurrenceCount: x.lifetimeOccurrenceCount,
      recurrenceCount: x.recurrenceCount,
      remediationSuccessStreak: x.remediationSuccessStreak,
      reappearanceCount: x.reappearanceCount,
      firstSeenAt: x.firstSeenAt,
      lastSeenAt: x.lastSeenAt,
      resolutionReason: x.resolutionReason,
      revision: x.revision,
      watermark: x.watermark,
      engineId: x.engineId,
      configId: x.configId,
      processingVersion: x.processingVersion,
    };
  }
}
