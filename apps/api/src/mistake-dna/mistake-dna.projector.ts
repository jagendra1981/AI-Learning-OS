import { createHash } from 'node:crypto';

export const MISTAKE_DNA_ENGINE = 'mistake-dna-v1';
export const MISTAKE_DNA_CONFIG = 'mistake-dna-config-v1';
export const MISTAKE_DNA_PROCESSING_VERSION = 'c022-v1';
export const MISTAKE_DNA_CONFIG_VALUES = Object.freeze({
  confirmationOccurrenceCount: 2,
  recurrenceWindowDays: 30,
  candidateExpiryDays: 30,
  resolutionIndependentSuccessCount: 2,
  resolutionMinimumDistinctQuestions: 2,
  resolutionWindowDays: 14,
  reappearanceWindowDays: 90,
  severityCandidate: 0.25,
  severityConfirmedBase: 0.5,
  severityRecurrenceIncrement: 0.1,
  severityPersistentBonus: 0.15,
  severityUnansweredWeight: 0.75,
  severityAssistanceDependencyWeight: 0.8,
  severityMaximum: 1,
  confidenceEvidenceScale: 4,
  canonicalDecimalPlaces: 6,
});
export type MistakeTaxonomy =
  | 'MD_CONCEPT_GAP'
  | 'MD_UNANSWERED'
  | 'MD_ASSISTANCE_DEPENDENCY'
  | 'MD_PERSISTENT_ERROR'
  | 'MD_RECALL_GAP'
  | 'MD_PROCEDURAL_ERROR'
  | 'MD_APPLICATION_ERROR'
  | 'MD_REASONING_ERROR'
  | 'MD_REPRESENTATION_ERROR'
  | 'MD_CARELESS_ERROR';
export type MistakeInput = {
  inputId: string;
  signalIds?: string[];
  sourceOccurredAt: Date;
  conceptId: string;
  questionVersionId?: string | null;
  taxonomy: MistakeTaxonomy;
  persistent: boolean;
  assisted: boolean;
  hintUsed?: boolean;
  retryUsed?: boolean;
  independentCorrect?: boolean;
  outcome?: 'CORRECT' | 'INCORRECT' | 'UNANSWERED';
  expiryCheck?: boolean;
  context: string;
};
export const isIndependentCorrect = (input: MistakeInput) =>
  input.outcome === undefined
    ? input.independentCorrect === true
    : input.outcome === 'CORRECT' &&
      !input.assisted &&
      !input.hintUsed &&
      !input.retryUsed;
export const isRemediationEligible = (
  previous: MistakeDnaSemanticState,
  input: MistakeInput,
) =>
  isIndependentCorrect(input) &&
  previous.state !== 'RESOLVED' &&
  previous.lastMistakeAt !== null &&
  input.sourceOccurredAt > previous.lastMistakeAt;
export type MistakeDnaSemanticState = {
  state: 'CANDIDATE' | 'CONFIRMED' | 'REMEDIATING' | 'RESOLVED' | 'REAPPEARED';
  lifetimeOccurrenceCount: number;
  recurrenceCount: number;
  remediationSuccessStreak: number;
  reappearanceCount: number;
  severity: number;
  confidence: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  confirmedAt: Date | null;
  resolvedAt: Date | null;
  resolutionReason: 'THRESHOLD_MET' | 'ISOLATED_EXPIRED' | null;
  reappearedAt: Date | null;
  reappearanceWithinWindow: boolean | null;
  lastMistakeAt: Date | null;
  remediationQuestionVersions: string[];
  remediationFirstAt: Date | null;
};
export type MistakeDnaHistoryIntent = {
  fromState: MistakeDnaSemanticState['state'] | null;
  toState: MistakeDnaSemanticState['state'];
  reason: string;
  inputId: string;
  sourceOccurredAt: Date;
  lifetimeOccurrenceCount: number;
  recurrenceCount: number;
  remediationSuccessStreak: number;
  reappearanceCount: number;
  severity: number;
  confidence: number;
  occurrenceInputIds: string[];
  remediationInputIds: string[];
  signalIds: string[];
  reappearance: {
    withinWindow: boolean;
    windowDays: number;
    resolutionReferenceAt: Date;
  } | null;
};
export const mistakeDnaGenesis = (): MistakeDnaSemanticState => ({
  state: 'CANDIDATE',
  lifetimeOccurrenceCount: 0,
  recurrenceCount: 0,
  remediationSuccessStreak: 0,
  reappearanceCount: 0,
  severity: 0,
  confidence: 0,
  firstSeenAt: null,
  lastSeenAt: null,
  confirmedAt: null,
  resolvedAt: null,
  resolutionReason: null,
  reappearedAt: null,
  reappearanceWithinWindow: null,
  lastMistakeAt: null,
  remediationQuestionVersions: [],
  remediationFirstAt: null,
});

/** Mechanical persistence boundary; lifecycle decisions remain in the projector. */
export const toMistakeDnaSemanticState = (value: {
  state: string;
  lifetimeOccurrenceCount: number;
  recurrenceCount: number;
  remediationSuccessStreak: number;
  reappearanceCount: number;
  severity: number | { toString(): string };
  confidence: number | { toString(): string };
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  confirmedAt?: Date | null;
  resolvedAt: Date | null;
  resolutionReason?: string | null;
  reappearedAt?: Date | null;
  remediatingAt?: Date | null;
}): MistakeDnaSemanticState => ({
  state: value.state as MistakeDnaSemanticState['state'],
  lifetimeOccurrenceCount: value.lifetimeOccurrenceCount,
  recurrenceCount: value.recurrenceCount,
  remediationSuccessStreak: value.remediationSuccessStreak,
  reappearanceCount: value.reappearanceCount,
  severity: Number(value.severity),
  confidence: Number(value.confidence),
  firstSeenAt: value.firstSeenAt,
  lastSeenAt: value.lastSeenAt,
  confirmedAt: value.confirmedAt ?? null,
  resolvedAt: value.resolvedAt,
  resolutionReason:
    value.resolutionReason === 'THRESHOLD_MET' ||
    value.resolutionReason === 'ISOLATED_EXPIRED'
      ? value.resolutionReason
      : null,
  reappearedAt: value.reappearedAt ?? null,
  reappearanceWithinWindow: null,
  lastMistakeAt: value.lastSeenAt,
  remediationQuestionVersions: [],
  remediationFirstAt: value.remediatingAt ?? null,
});
export const restoreRemediationQuestionVersions = (
  previous: MistakeDnaSemanticState,
  observations: {
    inputId: string;
    sourceOccurredAt: Date;
    questionVersionId: string | null;
  }[],
  appliedRemediationInputIds: ReadonlySet<string>,
) =>
  observations
    .filter(
      (observation) =>
        appliedRemediationInputIds.has(observation.inputId) &&
        (!previous.lastMistakeAt ||
          observation.sourceOccurredAt > previous.lastMistakeAt),
    )
    .map((observation) => observation.questionVersionId)
    .filter((id): id is string => typeof id === 'string');
export const mistakeDnaTransition = (
  previous: MistakeDnaSemanticState,
  input: MistakeInput,
): {
  nextSemanticState: MistakeDnaSemanticState;
  historyIntent: MistakeDnaHistoryIntent | null;
} => {
  const next = {
    ...previous,
    remediationQuestionVersions: [...previous.remediationQuestionVersions],
  };
  const fromState = previous.lifetimeOccurrenceCount ? previous.state : null;
  if (input.expiryCheck) {
    if (
      previous.state === 'CANDIDATE' &&
      previous.lifetimeOccurrenceCount === 1 &&
      previous.firstSeenAt &&
      input.sourceOccurredAt.getTime() - previous.firstSeenAt.getTime() >=
        MISTAKE_DNA_CONFIG_VALUES.candidateExpiryDays * 86400000
    ) {
      next.state = 'RESOLVED';
      next.resolvedAt = input.sourceOccurredAt;
      next.resolutionReason = 'ISOLATED_EXPIRED';
      next.severity = 0;
      next.remediationSuccessStreak = 0;
    }
  } else if (!isIndependentCorrect(input)) {
    const candidateWindowElapsed =
      previous.state === 'CANDIDATE' &&
      previous.firstSeenAt !== null &&
      input.sourceOccurredAt.getTime() - previous.firstSeenAt.getTime() >
        MISTAKE_DNA_CONFIG_VALUES.recurrenceWindowDays * 86400000;
    next.lifetimeOccurrenceCount += 1;
    next.recurrenceCount = candidateWindowElapsed
      ? 0
      : Math.max(0, next.lifetimeOccurrenceCount - 1);
    if (candidateWindowElapsed) next.firstSeenAt = input.sourceOccurredAt;
    else next.firstSeenAt ??= input.sourceOccurredAt;
    next.lastSeenAt = input.sourceOccurredAt;
    next.lastMistakeAt = input.sourceOccurredAt;
    next.remediationSuccessStreak = 0;
    next.remediationQuestionVersions = [];
    next.remediationFirstAt = null;
    if (previous.state === 'RESOLVED') {
      next.state = 'REAPPEARED';
      next.resolutionReason = null;
      const resolutionReferenceAt = previous.resolvedAt;
      const elapsedSinceResolution =
        resolutionReferenceAt === null
          ? null
          : input.sourceOccurredAt.getTime() - resolutionReferenceAt.getTime();
      const reappearanceWithinWindow =
        elapsedSinceResolution !== null &&
        elapsedSinceResolution >= 0 &&
        elapsedSinceResolution <=
          MISTAKE_DNA_CONFIG_VALUES.reappearanceWindowDays * 86400000;
      next.reappearedAt = input.sourceOccurredAt;
      next.reappearanceWithinWindow = reappearanceWithinWindow;
      if (reappearanceWithinWindow) next.reappearanceCount += 1;
    } else if (previous.state === 'REMEDIATING') {
      next.state = 'CONFIRMED';
    } else if (input.persistent) {
      next.state = 'CONFIRMED';
      next.confirmedAt ??= input.sourceOccurredAt;
    } else if (candidateWindowElapsed) {
      next.state = 'CANDIDATE';
      next.confirmedAt = null;
    } else if (
      next.lifetimeOccurrenceCount >=
      MISTAKE_DNA_CONFIG_VALUES.confirmationOccurrenceCount
    ) {
      next.state = 'CONFIRMED';
      next.confirmedAt ??= input.sourceOccurredAt;
    }
    next.severity = severityFor(
      next.state,
      input.taxonomy,
      next.lifetimeOccurrenceCount,
      input.persistent,
    );
    next.confidence = patternConfidence(next.lifetimeOccurrenceCount);
  } else if (
    previous.state !== 'RESOLVED' &&
    previous.lastMistakeAt &&
    input.sourceOccurredAt > previous.lastMistakeAt
  ) {
    if (next.remediationFirstAt === null)
      next.remediationFirstAt = input.sourceOccurredAt;
    if (
      input.questionVersionId &&
      !next.remediationQuestionVersions.includes(input.questionVersionId)
    )
      next.remediationQuestionVersions.push(input.questionVersionId);
    next.remediationSuccessStreak = next.remediationQuestionVersions.length;
    if (next.remediationSuccessStreak >= 1) next.state = 'REMEDIATING';
    if (
      next.remediationSuccessStreak >= 2 &&
      next.remediationFirstAt &&
      input.sourceOccurredAt.getTime() - next.remediationFirstAt.getTime() <=
        MISTAKE_DNA_CONFIG_VALUES.resolutionWindowDays * 86400000
    ) {
      next.state = 'RESOLVED';
      next.resolvedAt = input.sourceOccurredAt;
      next.resolutionReason = 'THRESHOLD_MET';
      next.severity = 0;
    }
  }
  const changed =
    fromState !== next.state ||
    next.lifetimeOccurrenceCount !== previous.lifetimeOccurrenceCount ||
    next.remediationSuccessStreak !== previous.remediationSuccessStreak;
  return {
    nextSemanticState: next,
    historyIntent: changed
      ? {
          fromState,
          toState: next.state,
          reason:
            input.expiryCheck && next.state === 'RESOLVED'
              ? 'ISOLATED_EXPIRED'
              : next.state === 'RESOLVED'
                ? 'THRESHOLD_MET'
                : next.state,
          inputId: input.inputId,
          sourceOccurredAt: input.sourceOccurredAt,
          lifetimeOccurrenceCount: next.lifetimeOccurrenceCount,
          recurrenceCount: next.recurrenceCount,
          remediationSuccessStreak: next.remediationSuccessStreak,
          reappearanceCount: next.reappearanceCount,
          severity: next.severity,
          confidence: next.confidence,
          occurrenceInputIds:
            input.expiryCheck || isIndependentCorrect(input)
              ? []
              : [input.inputId],
          remediationInputIds:
            !input.expiryCheck && isIndependentCorrect(input)
              ? [input.inputId]
              : [],
          signalIds: [...(input.signalIds ?? [])].sort(),
          reappearance:
            previous.state === 'RESOLVED' &&
            next.state === 'REAPPEARED' &&
            previous.resolvedAt
              ? {
                  withinWindow: next.reappearanceWithinWindow === true,
                  windowDays: MISTAKE_DNA_CONFIG_VALUES.reappearanceWindowDays,
                  resolutionReferenceAt: previous.resolvedAt,
                }
              : null,
        }
      : null,
  };
};
export const foldMistakeDnaInputs = (
  initialState: MistakeDnaSemanticState,
  inputs: MistakeInput[],
  transitionAuthority = mistakeDnaTransition,
) => {
  let state = initialState;
  const historyIntents: MistakeDnaHistoryIntent[] = [];
  for (const input of orderMistakeInputs(inputs)) {
    const result = transitionAuthority(state, input);
    state = result.nextSemanticState;
    if (result.historyIntent) historyIntents.push(result.historyIntent);
  }
  return { state, historyIntents };
};
export const compareMistakeInputs = (a: MistakeInput, b: MistakeInput) =>
  a.sourceOccurredAt.getTime() - b.sourceOccurredAt.getTime() ||
  a.inputId.localeCompare(b.inputId);
export const orderMistakeInputs = (xs: MistakeInput[]) =>
  [...xs].sort(compareMistakeInputs);
export const round6 = (n: number) =>
  Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;
export const mistakeSignature = (
  learnerId: string,
  conceptId: string,
  taxonomy: MistakeTaxonomy,
  context: string,
) =>
  createHash('sha256')
    .update(
      [
        MISTAKE_DNA_PROCESSING_VERSION,
        learnerId,
        'CONCEPT',
        conceptId,
        taxonomy,
        context,
        MISTAKE_DNA_ENGINE,
        MISTAKE_DNA_CONFIG,
      ].join('|'),
    )
    .digest('hex');
export const taxonomyFor = (
  outcome: unknown,
  signals: { type: string; value: unknown }[],
): MistakeTaxonomy | null => {
  if (outcome === 'UNANSWERED') return 'MD_UNANSWERED';
  if (
    outcome !== 'INCORRECT' &&
    !signals.some((s) => s.type === 'SIG_ASSISTED_CORRECT')
  )
    return null;
  const has = (name: string) =>
    signals.some((s) => s.type === name && s.value === true);
  if (has('SIG_PERSISTENT_ERROR')) return 'MD_PERSISTENT_ERROR';
  for (const [signal, code] of [
    ['SIG_RECALL_FAILURE', 'MD_RECALL_GAP'],
    ['SIG_PROCEDURAL_ERROR', 'MD_PROCEDURAL_ERROR'],
    ['SIG_APPLICATION_ERROR', 'MD_APPLICATION_ERROR'],
    ['SIG_REASONING_ERROR', 'MD_REASONING_ERROR'],
    ['SIG_REPRESENTATION_ERROR', 'MD_REPRESENTATION_ERROR'],
    ['SIG_CARELESS_ERROR', 'MD_CARELESS_ERROR'],
  ] as const)
    if (has(signal)) return code;
  if (signals.some((s) => s.type === 'SIG_ASSISTED_CORRECT'))
    return 'MD_ASSISTANCE_DEPENDENCY';
  return 'MD_CONCEPT_GAP';
};
export const patternConfidence = (occ: number) =>
  round6(occ / (occ + MISTAKE_DNA_CONFIG_VALUES.confidenceEvidenceScale));
export const severityFor = (
  state: string,
  taxonomy: MistakeTaxonomy,
  occ: number,
  persistent: boolean,
) => {
  if (state === 'RESOLVED') return 0;
  let n =
    state === 'CANDIDATE'
      ? 0.25
      : 0.5 + 0.1 * Math.max(0, occ - 2) + (persistent ? 0.15 : 0);
  if (taxonomy === 'MD_UNANSWERED') n *= 0.75;
  if (taxonomy === 'MD_ASSISTANCE_DEPENDENCY') n *= 0.8;
  return round6(Math.min(1, Math.max(0, n)));
};
