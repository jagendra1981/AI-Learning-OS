/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { AcademicScopeService } from '../academic/academic-scope.service';
import { invalidCursor, validation, ReadModelError } from './read-model.errors';
import { HttpStatus } from '@nestjs/common';
import {
  ActionReference,
  MistakeQuery,
  NbaDto,
  ProgressDto,
  ProgressQuery,
  ReadEnvelope,
  ReadMeta,
  ReadQuery,
  RevisionDto,
  RevisionQuery,
  TodayQuery,
} from './read-model.dto';

const SCHEMA = 'c026-read-v1';
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const key = (learnerId: string, contextId: string, academicVersion: string) =>
  createHash('sha256')
    .update(stable({ learnerId, contextId, academicVersion }))
    .digest('hex');
const cursor = (value: unknown) =>
  Buffer.from(JSON.stringify({ s: SCHEMA, v: value })).toString('base64url');
const decodeCursor = (value?: string) => {
  if (!value) return undefined;
  try {
    const x = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (x?.s !== SCHEMA || !x.v || typeof x.v !== 'object') throw new Error();
    return x.v;
  } catch {
    throw invalidCursor();
  }
};
const bool = (v: string | undefined, fallback: boolean) => {
  if (v === undefined) return fallback;
  if (v !== 'true' && v !== 'false') throw validation();
  return v === 'true';
};
const limit = (v?: string) => {
  const n = v === undefined ? 50 : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw validation('limit must be between 1 and 100.');
  return n;
};
const meta = (
  source: string,
  row: any,
  generation?: string | null,
): ReadMeta => ({
  schemaVersion: SCHEMA,
  source,
  sourceVersion: row?.processingVersion ?? null,
  sourceGeneration: generation ?? row?.activeGenerationId ?? null,
  sourceWatermark: row?.watermark ?? row?.watermarkSourceId ?? null,
});
const envelope = <T>(
  data: T,
  source: string,
  row: any,
  generation?: string | null,
): ReadEnvelope<T> => {
  const generatedAt =
    row?.updatedAt?.toISOString?.() ?? row?.createdAt?.toISOString?.() ?? null;
  const state = data === null ? 'EMPTY' : 'AVAILABLE';
  return {
    state,
    generatedAt,
    data,
    freshness: { state, generatedAt, stale: false, retryable: false },
    meta: meta(source, row, generation),
  };
};
const action = (
  type: ActionReference['type'],
  href: ActionReference['href'],
  resourceId?: string,
): ActionReference => ({ type, href, ...(resourceId ? { resourceId } : {}) });
const contextIdentity = (contextId: string, academicVersion: string) =>
  createHash('sha256')
    .update(stable({ contextId, academicVersion }))
    .digest('hex');
const parseScope = (q: ReadQuery) => {
  if (!q.contextId || !q.academicVersion)
    throw validation('contextId and academicVersion are required.');
  return q;
};
const progressBand = (percent: number): ProgressDto['overallBand'] =>
  percent < 40
    ? 'FOUNDATION'
    : percent < 60
      ? 'DEVELOPING'
      : percent < 80
        ? 'PROGRESSING'
        : 'STRONG';
const percent = (value: number) => Math.round(value * 100);

@Injectable()
export class ReadModelService {
  private readonly scopes: AcademicScopeService;
  constructor(
    private readonly db: DatabaseService,
    scopes?: AcademicScopeService,
  ) {
    this.scopes = scopes ?? new AcademicScopeService(db);
  }
  private tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  private async visible(
    tx: Prisma.TransactionClient,
    learnerId: string,
    q: ReadQuery,
  ) {
    parseScope(q);
    const decision = await this.scopes.resolve(
      {
        learnerId,
        contextId: q.contextId!,
        academicVersionId: q.academicVersion!,
      },
      tx,
    );
    if (decision === 'FORBIDDEN')
      throw new ReadModelError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Access to this scope is forbidden.',
      );
    if (decision !== 'VISIBLE')
      throw new ReadModelError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'Requested scope was not found.',
      );
  }
  async twin(learnerId: string, q: ReadQuery) {
    parseScope(q);
    return this.tx(async (tx) => {
      const rows = await tx.digitalTwinState.findMany({
        where: {
          learnerId,
          targetType: 'CONCEPT',
          academicContextIdentity: contextIdentity(
            q.contextId!,
            q.academicVersion!,
          ),
          algorithmId: 'dtp-v1',
          configId: 'dtp-config-v1',
        },
        orderBy: { targetId: 'asc' },
      });
      const first = rows[0];
      return envelope(
        first
          ? {
              contextId: q.contextId,
              academicVersion: q.academicVersion,
              concepts: rows.map((r: any) => ({
                conceptId: r.targetId,
                mastery: Number(r.mastery),
                confidence: Number(r.confidence),
                evidenceCount: r.evidenceCount,
                lastEvidenceAt: r.lastEvidenceAt,
                updatedAt: r.updatedAt,
              })),
            }
          : null,
        'C021',
        first,
      );
    });
  }
  async mistakes(learnerId: string, q: MistakeQuery) {
    parseScope(q);
    const n = limit(q.limit);
    const includeResolved = bool(q.includeResolved, false);
    const states = q.lifecycle?.split(',').filter(Boolean);
    const allowed = [
      'CANDIDATE',
      'CONFIRMED',
      'REMEDIATING',
      'RESOLVED',
      'REAPPEARED',
    ];
    if (
      states?.some((s) => !allowed.includes(s)) ||
      (states?.includes('RESOLVED') && !includeResolved)
    )
      throw validation('Invalid lifecycle filter.');
    const c = decodeCursor(q.cursor) as any;
    return this.tx(async (tx) => {
      const where: any = {
        learnerId,
        academicContextIdentity: contextIdentity(
          q.contextId!,
          q.academicVersion!,
        ),
        ...(q.conceptId ? { conceptId: q.conceptId } : {}),
        ...(states
          ? { state: { in: states } }
          : { state: includeResolved ? undefined : { not: 'RESOLVED' } }),
        ...(c
          ? {
              OR: [
                { lastSeenAt: { lt: new Date(c.lastSeenAt) } },
                {
                  lastSeenAt: new Date(c.lastSeenAt),
                  patternSignature: { gt: c.mistakeKey },
                },
              ],
            }
          : {}),
      };
      const rows = await tx.mistakeDnaPattern.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }, { patternSignature: 'asc' }],
        take: n + 1,
      });
      const page = rows.slice(0, n);
      const row = page[0];
      return envelope(
        {
          items: page.map((r: any) => ({
            mistakeId: r.patternSignature,
            mistakeKey: r.patternSignature,
            category: r.taxonomyCode ?? r.state,
            label: r.taxonomyCode ?? 'Review this concept',
            concept: { id: r.conceptId },
            conceptId: r.conceptId,
            lifecycle: r.state,
            recurrence: r.recurrenceCount,
            occurrenceCount: r.lifetimeOccurrenceCount,
            severity:
              r.state === 'RESOLVED'
                ? 'RESOLVED'
                : Number(r.severity) >= 0.67
                  ? 'HIGH'
                  : Number(r.severity) >= 0.34
                    ? 'MEDIUM'
                    : 'LOW',
            lastObservedAt: r.lastSeenAt,
            lastSeenAt: r.lastSeenAt,
          })),
          nextCursor:
            rows.length > n
              ? cursor({
                  lastSeenAt: page[n - 1].lastSeenAt,
                  mistakeKey: page[n - 1].patternSignature,
                })
              : null,
        },
        'C022',
        row,
      );
    });
  }
  async revisions(learnerId: string, q: RevisionQuery) {
    parseScope(q);
    const n = limit(q.limit);
    const asOf = q.asOf ? new Date(q.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw validation('asOf must be RFC3339.');
    const c = decodeCursor(q.cursor) as any;
    return this.tx(async (tx) => {
      const where: any = {
        learnerId,
        academicVersionId: q.academicVersion,
        ...(q.contextId ? { contextId: q.contextId } : {}),
        ...(q.conceptId ? { conceptId: q.conceptId } : {}),
        ...(q.state ? { state: q.state } : {}),
      };
      const rows = await tx.revisionState.findMany({ where });
      const mapped = rows.map((r: any) => ({
        revisionKey: r.scopeKey,
        conceptId: r.conceptId,
        state: r.state,
        dueAt: r.dueAt,
        intervalDays: r.intervalDays,
        dueStatus:
          r.dueAt === null
            ? 'UNSCHEDULED'
            : asOf < r.dueAt
              ? 'FUTURE'
              : asOf.getTime() === r.dueAt.getTime()
                ? 'DUE'
                : 'OVERDUE',
        assessmentSessionId: null,
        questionVersionId: r.lastQualifyingQuestionVersionId,
        updatedAt: r.updatedAt,
        _due: r.dueAt,
        _key: r.scopeKey,
      }));
      const filtered = (
        q.dueStatus ? mapped.filter((x) => x.dueStatus === q.dueStatus) : mapped
      ).sort(
        (a, b) =>
          (a._due === null
            ? 1
            : b._due === null
              ? -1
              : a._due.getTime() - b._due.getTime()) ||
          a._key.localeCompare(b._key),
      );
      if (
        q.dueStatus &&
        !['FUTURE', 'DUE', 'OVERDUE', 'UNSCHEDULED'].includes(q.dueStatus)
      )
        throw validation('Invalid dueStatus.');
      const after = c
        ? filtered.filter((x) =>
            c.dueAt === null
              ? x._due === null && x._key > c.revisionKey
              : x._due !== null &&
                (x._due > new Date(c.dueAt) ||
                  (x._due.getTime() === new Date(c.dueAt).getTime() &&
                    x._key > c.revisionKey)),
          )
        : filtered;
      const page = after.slice(0, n);
      return envelope(
        {
          items: page.map(({ _due, _key, ...x }) => x),
          nextCursor:
            after.length > n
              ? cursor({
                  dueAt: page[n - 1]._due,
                  revisionKey: page[n - 1]._key,
                })
              : null,
        },
        'C023',
        rows[0],
      );
    });
  }
  async recommendation(learnerId: string, q: ReadQuery) {
    parseScope(q);
    return this.tx(async (tx) => {
      const run = await tx.adaptiveRun.findUnique({
        where: { scopeKey: key(learnerId, q.contextId!, q.academicVersion!) },
      });
      if (!run?.activeGenerationId || !run.selectedCandidateId)
        return envelope(null, 'C024', run);
      const candidate = await tx.adaptiveCandidate.findFirst({
        where: {
          generationId: run.activeGenerationId,
          immutableCandidateId: run.selectedCandidateId,
        },
      });
      if (!candidate) return envelope(null, 'C024', run);
      const candidateType = String(candidate.candidateType);
      const href =
        candidateType === 'REVISION' || candidateType === 'REVISE'
          ? '/revision'
          : '/practice';
      const dto: NbaDto & { recommendationKey?: string } = {
        recommendationKey: candidate.immutableCandidateId,
        actionType: candidateType,
        title:
          candidateType === 'REVISION' || candidateType === 'REVISE'
            ? 'Review a concept'
            : 'Practice a concept',
        targetLabel: 'Concept',
        action: action(
          candidateType === 'REVISION' || candidateType === 'REVISE'
            ? 'OPEN_REVISION'
            : 'START_PRACTICE',
          href,
          candidate.targetRefId,
        ),
        availability: 'AVAILABLE',
      };
      return envelope(dto, 'C024', run, run.activeGenerationId);
    });
  }
  async nextBestAction(learnerId: string, q: ReadQuery) {
    return this.recommendation(learnerId, q);
  }
  async progress(learnerId: string, q: ProgressQuery) {
    parseScope(q);
    return this.tx(async (tx) => {
      const scope = await tx.academicScope.findUnique({
        where: {
          learnerId_contextId_academicVersionId: {
            learnerId,
            contextId: q.contextId!,
            academicVersionId: q.academicVersion!,
          },
        },
      });
      if (!scope || scope.status !== 'ACTIVE')
        return envelope(null, 'C021', null);
      const syllabus = await tx.syllabusVersion.findUnique({
        where: { canonicalId: scope.academicVersionId },
        select: { canonicalId: true },
      });
      if (!syllabus)
        return {
          state: 'UNAVAILABLE' as const,
          generatedAt: null,
          data: null,
          freshness: {
            state: 'UNAVAILABLE' as const,
            generatedAt: null,
            retryable: false,
            reasonCode: 'REQUIRED_INPUT_UNAVAILABLE',
          },
          meta: meta('C021', null),
        };
      const concepts = await tx.syllabusVersionConcept.findMany({
        where: { versionId: scope.academicVersionId },
        select: {
          conceptId: true,
          concept: {
            select: {
              chapter: {
                select: {
                  unit: {
                    select: {
                      domain: {
                        select: {
                          subject: {
                            select: { canonicalId: true, name: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const rows = await tx.digitalTwinState.findMany({
        where: {
          learnerId,
          targetType: 'CONCEPT',
          academicContextIdentity: contextIdentity(
            scope.contextId,
            scope.academicVersionId,
          ),
          algorithmId: 'dtp-v1',
          configId: 'dtp-config-v1',
          evidenceCount: { gt: 0 },
          targetId: { in: concepts.map((c) => c.conceptId) },
        },
        orderBy: { targetId: 'asc' },
      });
      const byId = new Map(rows.map((r) => [r.targetId, r]));
      const eligible = concepts.filter((c) => byId.has(c.conceptId));
      const sourceEvidence = await tx.evidenceRecord.findMany({
        where: {
          learnerId,
          conceptId: { in: concepts.map((c) => c.conceptId) },
          processingVersion: 'c020-v1',
        },
        select: { evidenceId: true, sourceOccurredAt: true },
        orderBy: { sourceOccurredAt: 'desc' },
        take: 1,
      });
      if (!eligible.length && sourceEvidence.length) {
        return {
          state: 'PENDING' as const,
          generatedAt: null,
          data: null,
          freshness: {
            state: 'PENDING' as const,
            generatedAt: null,
            retryable: true,
            reasonCode: 'PROJECTION_PENDING',
          },
          meta: meta('C021', null),
        };
      }
      const latestEvidenceAt = sourceEvidence[0]?.sourceOccurredAt;
      const latestProjectedAt = rows.reduce<Date | null>(
        (latest, r) =>
          r.lastEvidenceAt && (!latest || r.lastEvidenceAt > latest)
            ? r.lastEvidenceAt
            : latest,
        null,
      );
      if (
        latestEvidenceAt &&
        latestProjectedAt &&
        latestEvidenceAt > latestProjectedAt
      )
        return {
          state: 'PENDING' as const,
          generatedAt: latestProjectedAt.toISOString(),
          data: null,
          freshness: {
            state: 'PENDING' as const,
            generatedAt: latestProjectedAt.toISOString(),
            retryable: true,
            reasonCode: 'NEWER_INPUT_PENDING',
          },
          meta: meta('C021', rows[0]),
        };
      const generatedAt =
        rows.reduce<Date | null>(
          (latest, r) =>
            !latest || r.updatedAt > latest ? r.updatedAt : latest,
          null,
        ) ??
        (scope as any).createdAt ??
        new Date(0);
      const base = {
        state: eligible.length ? ('AVAILABLE' as const) : ('EMPTY' as const),
        eligibleConceptCount: eligible.length,
        totalConceptCount: concepts.length,
        generatedAt: generatedAt.toISOString(),
        asOf: rows[0]?.lastEvidenceAt?.toISOString() ?? null,
        academicVersionId: scope.academicVersionId,
      };
      if (!eligible.length)
        return {
          state: 'EMPTY' as const,
          generatedAt: base.generatedAt,
          data: {
            ...base,
            coverage: {
              eligibleConceptCount: 0,
              totalConceptCount: concepts.length,
              coveragePercent: concepts.length ? 0 : 100,
            },
            subjects: [],
          },
          freshness: {
            state: 'EMPTY' as const,
            generatedAt: base.generatedAt,
            stale: false,
            retryable: false,
          },
          meta: meta('C021', null),
        };
      const subjectMap = new Map<
        string,
        {
          subjectId: string;
          subjectLabel: string;
          values: number[];
          total: number;
        }
      >();
      for (const c of concepts) {
        const s = c.concept.chapter.unit.domain.subject;
        const item = subjectMap.get(s.canonicalId) ?? {
          subjectId: s.canonicalId,
          subjectLabel: s.name,
          values: [],
          total: 0,
        };
        item.total++;
        const row = byId.get(c.conceptId);
        if (row) item.values.push(percent(Number(row.mastery)));
        subjectMap.set(s.canonicalId, item);
      }
      const values = eligible.map((c) =>
        percent(Number(byId.get(c.conceptId)!.mastery)),
      );
      const overall = Math.round(
        values.reduce((a, b) => a + b, 0) / values.length,
      );
      const data: ProgressDto = {
        ...base,
        overallProgressPercent: overall,
        overallBand: progressBand(overall),
        coverage: {
          eligibleConceptCount: eligible.length,
          totalConceptCount: concepts.length,
          coveragePercent: concepts.length
            ? Math.round((eligible.length / concepts.length) * 100)
            : 100,
        },
        subjects: [...subjectMap.values()].map((s) => {
          const p = s.values.length
            ? Math.round(s.values.reduce((a, b) => a + b, 0) / s.values.length)
            : undefined;
          return {
            subjectId: s.subjectId,
            subjectLabel: s.subjectLabel,
            progressPercent: p,
            band: p === undefined ? undefined : progressBand(p),
            eligibleConceptCount: s.values.length,
            totalConceptCount: s.total,
          };
        }),
      };
      return {
        state: 'AVAILABLE' as const,
        generatedAt: base.generatedAt,
        data,
        freshness: {
          state: 'AVAILABLE' as const,
          generatedAt: base.generatedAt,
          stale: false,
          retryable: false,
        },
        meta: meta('C021', rows[0]),
      };
    });
  }
  async today(learnerId: string, q: TodayQuery) {
    parseScope(q);
    if (!q.planDateLocal || !/^\d{4}-\d{2}-\d{2}$/.test(q.planDateLocal))
      throw validation('planDateLocal must be YYYY-MM-DD.');
    const includeCompleted = bool(q.includeCompleted, true);
    return this.tx(async (tx) => {
      const lineage = await tx.todayPlanLineage.findFirst({
        where: {
          learnerId,
          contextId: q.contextId,
          academicVersionId: q.academicVersion,
          planDateLocal: q.planDateLocal,
        },
      });
      if (!lineage?.currentVersion) return envelope(null, 'C025', lineage);
      const plan = await tx.todayPlanVersion.findUnique({
        where: {
          lineageId_planVersion: {
            lineageId: lineage.lineageId,
            planVersion: lineage.currentVersion,
          },
        },
        include: {
          items: { orderBy: [{ sequence: 'asc' }, { semanticItemKey: 'asc' }] },
        },
      });
      if (!plan) return envelope(null, 'C025', lineage);
      const items = plan.items
        .filter((i: any) => includeCompleted || i.state !== 'COMPLETED')
        .map((i: any) => ({
          itemId: i.semanticItemKey,
          itemKey: i.semanticItemKey,
          position: i.sequence,
          title:
            i.candidateBinding?.title ??
            i.candidateBinding?.itemType ??
            i.candidateBinding?.actionType ??
            'Learning activity',
          itemType:
            i.candidateBinding?.itemType ??
            i.candidateBinding?.actionType ??
            'UNKNOWN',
          targetLabel: 'Concept',
          action: action(
            i.candidateBinding?.actionType === 'REVISION'
              ? 'OPEN_REVISION'
              : 'START_PRACTICE',
            i.candidateBinding?.actionType === 'REVISION'
              ? '/revision'
              : '/practice',
            i.targetRefId,
          ),
          durationMinutes: i.durationMinutes,
          state: i.state,
          availability: i.availabilitySnapshot?.available ?? false,
          available: i.availabilitySnapshot?.available ?? false,
          completedAt: i.completionProvenance?.completedAt ?? null,
          postponedToDate: i.postponementProvenance?.requestedDateLocal ?? null,
        }));
      return envelope(
        {
          date: plan.planDateLocal,
          planDateLocal: plan.planDateLocal,
          headline: 'Your learning plan',
          version: plan.planVersion,
          todayItems: items,
          items,
          resumeAction: undefined,
        },
        'C025',
        plan,
        plan.sourceGenerationId,
      );
    });
  }
}
