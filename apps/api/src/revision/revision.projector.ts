export const REVISION_ENGINE_ID = 'revision-engine-v1';
export const REVISION_ALGORITHM_ID = 'revision-due-v1';
export const REVISION_CONFIG_ID = 'revision-config-v1';
export const REVISION_PROCESSING_VERSION = 'c023-v1';

export const REVISION_CONFIG = Object.freeze({
  dueSoonFraction: 0.75,
  overdueFraction: 1.5,
  minimumIntervalDays: 1,
  maximumIntervalDays: 14,
  successDoublingFactor: 2,
  assistedFactor: 0.5,
  failureIntervalDays: 1,
  distinctSuccessWindowDays: 14,
  matureSuccessWindowDays: 30,
  highSeverityThreshold: 0.75,
  recurrenceThreshold: 2,
  reappearanceThreshold: 1,
  lifecycleMultipliers: Object.freeze({
    CANDIDATE: 0.75,
    CONFIRMED: 0.5,
    REMEDIATING: 0.6,
    RESOLVED: 1,
    REAPPEARED: 0.5,
  }),
});

export type RevisionScope = {
  learnerId: string;
  conceptId: string;
  contextId: string;
  academicVersionId: string;
};
export type C022Lifecycle = keyof typeof REVISION_CONFIG.lifecycleMultipliers;
export type RevisionInput = {
  type: 'C021' | 'C022' | 'ASSESSMENT';
  immutableSourceId: string;
  effectiveAt: Date;
  sourceRank: 10 | 20 | 30;
  payloadHash: string;
  mastery?: number;
  confidence?: number;
  c021SnapshotId?: string;
  c021Revision?: number;
  lifecycle?: C022Lifecycle;
  resolutionReason?: 'THRESHOLD_MET' | 'ISOLATED_EXPIRED' | null;
  severity?: number;
  recurrenceCount?: number;
  reappearanceCount?: number;
  c022ProjectionId?: string;
  c022GenerationId?: string;
  c022Revision?: number;
  assessmentResultId?: string;
  questionVersionId?: string;
  correct?: boolean;
  hintUsed?: boolean;
  retryUsed?: boolean;
};
export type RevisionSemanticState = {
  state: 'NOT_SCHEDULED' | 'SCHEDULED';
  intervalDays: number | null;
  anchorAt: Date | null;
  dueAt: Date | null;
  consecutiveIndependentSuccessCount: number;
  lastQualifyingQuestionVersionId: string | null;
  successWindowStartedAt: Date | null;
  lastAssessmentResultId: string | null;
  lastAssessedAt: Date | null;
  mastery: number | null;
  confidence: number | null;
  c021SnapshotId: string | null;
  c021Revision: number | null;
  lifecycle: C022Lifecycle | null;
  resolutionReason: 'THRESHOLD_MET' | 'ISOLATED_EXPIRED' | null;
  severity: number;
  recurrenceCount: number;
  reappearanceCount: number;
  c022ProjectionId: string | null;
  c022GenerationId: string | null;
  c022Revision: number | null;
};
export type RevisionHistoryIntent = {
  fromState: string;
  toState: string;
  beforeIntervalDays: number | null;
  afterIntervalDays: number | null;
  beforeDueAt: Date | null;
  afterDueAt: Date | null;
  reason: string;
  input: RevisionInput;
};
export const revisionGenesis = (): RevisionSemanticState => ({
  state: 'NOT_SCHEDULED',
  intervalDays: null,
  anchorAt: null,
  dueAt: null,
  consecutiveIndependentSuccessCount: 0,
  lastQualifyingQuestionVersionId: null,
  successWindowStartedAt: null,
  lastAssessmentResultId: null,
  lastAssessedAt: null,
  mastery: null,
  confidence: null,
  c021SnapshotId: null,
  c021Revision: null,
  lifecycle: null,
  resolutionReason: null,
  severity: 0,
  recurrenceCount: 0,
  reappearanceCount: 0,
  c022ProjectionId: null,
  c022GenerationId: null,
  c022Revision: null,
});
const DAY = 86400000;
export const compareRevisionInputs = (a: RevisionInput, b: RevisionInput) =>
  a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
  a.sourceRank - b.sourceRank ||
  a.immutableSourceId.localeCompare(b.immutableSourceId);
export const baseIntervalDays = (mastery: number, confidence: number) => {
  if (mastery < 0 || mastery > 1 || confidence < 0 || confidence > 1)
    throw new Error('INVALID_UPSTREAM_STATE');
  if (mastery < 0.4 || confidence < 0.4) return 1;
  if (mastery < 0.65) return 3;
  if (mastery < 0.85) return 7;
  return confidence >= 0.7 ? 14 : 7;
};
export const computedIntervalDays = (s: RevisionSemanticState) => {
  if (s.mastery === null || s.confidence === null)
    throw new Error('INVALID_UPSTREAM_STATE');
  const lifecycle = s.lifecycle
    ? REVISION_CONFIG.lifecycleMultipliers[s.lifecycle]
    : 1;
  if (lifecycle === undefined) throw new Error('UNSUPPORTED_UPSTREAM_VERSION');
  const raw =
    baseIntervalDays(s.mastery, s.confidence) *
    lifecycle *
    (s.severity >= 0.75 ? 0.75 : 1) *
    (s.recurrenceCount >= 2 ? 0.75 : 1) *
    (s.reappearanceCount >= 1 ? 0.75 : 1);
  return Math.max(1, Math.min(14, Math.ceil(raw)));
};
const due = (at: Date, days: number) => new Date(at.getTime() + days * DAY);
export const deriveDueState = (
  s: RevisionSemanticState,
  referenceTime: Date,
) => {
  if (!s.anchorAt || !s.intervalDays || !s.dueAt)
    return 'NOT_SCHEDULED' as const;
  const soon = s.anchorAt.getTime() + s.intervalDays * DAY * 0.75;
  const overdue = s.anchorAt.getTime() + s.intervalDays * DAY * 1.5;
  const t = referenceTime.getTime();
  return t < soon
    ? 'SCHEDULED'
    : t < s.dueAt.getTime()
      ? 'DUE_SOON'
      : t <= overdue
        ? 'DUE'
        : 'OVERDUE';
};
export const revisionTransition = (
  previous: RevisionSemanticState,
  input: RevisionInput,
) => {
  const next: RevisionSemanticState = { ...previous };
  if (input.type === 'C021') {
    if (input.mastery === undefined || input.confidence === undefined)
      throw new Error('INVALID_UPSTREAM_STATE');
    baseIntervalDays(input.mastery, input.confidence);
    next.mastery = input.mastery;
    next.confidence = input.confidence;
    next.c021SnapshotId = input.c021SnapshotId ?? null;
    next.c021Revision = input.c021Revision ?? null;
  } else if (input.type === 'C022') {
    if (
      input.lifecycle &&
      !(input.lifecycle in REVISION_CONFIG.lifecycleMultipliers)
    )
      throw new Error('UNSUPPORTED_UPSTREAM_VERSION');
    next.lifecycle = input.lifecycle ?? null;
    next.resolutionReason = input.resolutionReason ?? null;
    next.severity = input.severity ?? 0;
    next.recurrenceCount = input.recurrenceCount ?? 0;
    next.reappearanceCount = input.reappearanceCount ?? 0;
    next.c022ProjectionId = input.c022ProjectionId ?? null;
    next.c022GenerationId = input.c022GenerationId ?? null;
    next.c022Revision = input.c022Revision ?? null;
  }
  let reason =
    input.type === 'C021' ? 'C021_UPSTREAM_CHANGE' : 'C022_UPSTREAM_CHANGE';
  if (input.type === 'ASSESSMENT') {
    if (
      input.correct === undefined ||
      !input.questionVersionId ||
      !input.assessmentResultId
    )
      throw new Error('INVALID_ASSESSMENT');
    const b = computedIntervalDays(next);
    const previousInterval = previous.intervalDays ?? b;
    if (!input.correct) {
      next.consecutiveIndependentSuccessCount = 0;
      next.lastQualifyingQuestionVersionId = null;
      next.successWindowStartedAt = null;
      next.intervalDays = 1;
      reason = 'FAILURE';
    } else if (input.hintUsed || input.retryUsed) {
      next.consecutiveIndependentSuccessCount = 0;
      next.lastQualifyingQuestionVersionId = null;
      next.successWindowStartedAt = null;
      next.intervalDays = Math.max(
        1,
        Math.min(b, Math.ceil(previousInterval * 0.5)),
      );
      reason = 'ASSISTED_SUCCESS';
    } else {
      const distinct =
        previous.lastQualifyingQuestionVersionId !== input.questionVersionId;
      let count = distinct
        ? previous.consecutiveIndependentSuccessCount + 1
        : previous.consecutiveIndependentSuccessCount;
      let start = previous.successWindowStartedAt;
      if (!start || input.effectiveAt.getTime() - start.getTime() > 30 * DAY) {
        count = 1;
        start = input.effectiveAt;
      }
      next.consecutiveIndependentSuccessCount = count;
      next.successWindowStartedAt = start;
      if (distinct)
        next.lastQualifyingQuestionVersionId = input.questionVersionId;
      const within14 =
        input.effectiveAt.getTime() - start.getTime() <= 14 * DAY;
      next.intervalDays =
        count >= 3
          ? 14
          : count >= 2 && within14
            ? Math.min(14, Math.max(b, previousInterval * 2))
            : b;
      reason = 'INDEPENDENT_SUCCESS';
    }
    next.anchorAt = input.effectiveAt;
    next.dueAt = due(input.effectiveAt, next.intervalDays!);
    next.lastAssessmentResultId = input.assessmentResultId;
    next.lastAssessedAt = input.effectiveAt;
    next.state = 'SCHEDULED';
  } else {
    const interval = computedIntervalDays(next);
    const candidate = due(input.effectiveAt, interval);
    if (!next.dueAt || candidate < next.dueAt) {
      next.intervalDays = interval;
      next.anchorAt = input.effectiveAt;
      next.dueAt = candidate;
    }
    next.state = 'SCHEDULED';
  }
  return {
    nextState: next,
    historyIntent: {
      fromState: previous.state,
      toState: next.state,
      beforeIntervalDays: previous.intervalDays,
      afterIntervalDays: next.intervalDays,
      beforeDueAt: previous.dueAt,
      afterDueAt: next.dueAt,
      reason,
      input,
    } as RevisionHistoryIntent,
  };
};
export const foldRevisionInputs = (inputs: RevisionInput[]) =>
  inputs
    .slice()
    .sort(compareRevisionInputs)
    .reduce(
      (x, input) => {
        const r = revisionTransition(x.state, input);
        return { state: r.nextState, history: [...x.history, r.historyIntent] };
      },
      { state: revisionGenesis(), history: [] as RevisionHistoryIntent[] },
    );
