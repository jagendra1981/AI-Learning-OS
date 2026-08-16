import { createHash } from 'node:crypto';
export const ADAPTIVE_ENGINE_ID = 'adaptive-engine-v1',
  ADAPTIVE_ALGORITHM_ID = 'adaptive-score-v1',
  ADAPTIVE_CONFIG_ID = 'adaptive-config-v1',
  ADAPTIVE_PROCESSING_VERSION = 'c024-v1',
  ADAPTIVE_CONTRACT_VERSION = 'C024-ADAPTIVE-ENGINE-CONTRACT-V1';
export type CandidateType =
  'REVISION' | 'REMEDIATION' | 'PRACTICE' | 'NEW_LEARNING' | 'ASSESSMENT';
export type DueStatus = 'SCHEDULED' | 'DUE_SOON' | 'DUE' | 'OVERDUE' | null;
export type CandidateSeed = {
  candidateType: CandidateType;
  conceptId: string;
  targetRefId: string;
  ownerId: string;
  contextId: string;
  academicVersionId: string;
  active: boolean;
  available: boolean;
  validVersion: boolean;
  blockedByAssessment: boolean;
  questionDifficulty?: number | null;
  prerequisites?: { mastery: number; confidence: number }[];
};
export type AdaptiveFacts = {
  learnerId: string;
  contextId: string;
  academicVersionId: string;
  masteryByConcept: Record<string, { mastery: number; confidence: number }>;
  mistakeByConcept: Record<
    string,
    {
      lifecycle:
        'CANDIDATE' | 'CONFIRMED' | 'REMEDIATING' | 'RESOLVED' | 'REAPPEARED';
      severity: number;
      patternConfidence: number;
      occurrenceCount: number;
      recurrenceCount: number;
      remediationSuccessStreak: number;
      reappearanceCount: number;
      resolutionReason: string | null;
    }
  >;
  revisionByConcept: Record<
    string,
    { status: DueStatus; dueAt: string | null; intervalDays: number | null }
  >;
  seeds: CandidateSeed[];
};
export type AdaptiveSource = {
  immutableSourceId: string;
  payloadHash: string;
  effectiveAt: Date;
  sourceRank: 1 | 2 | 3 | 4 | 5;
  facts: Partial<AdaptiveFacts>;
};
export type ScoredCandidate = {
  immutableCandidateId: string;
  candidateType: CandidateType;
  conceptId: string;
  targetRefId: string;
  eligible: boolean;
  exclusionReason: string | null;
  revisionUrgency: number;
  mistakeUrgency: number;
  masteryGap: number;
  confidenceGap: number;
  difficultyFit: number;
  noveltyNeed: number;
  finalScore: number;
  rank: number | null;
  reasonCodes: string[];
};
export type AdaptiveDecision = {
  facts: AdaptiveFacts;
  candidates: ScoredCandidate[];
  selected: ScoredCandidate | null;
  reasonCodes: string[];
  explanation: string;
  watermark: AdaptiveSource | null;
};
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
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const round6 = (x: number) =>
  Number((Math.round((x + Number.EPSILON) * 1e6) / 1e6).toFixed(6));
const priority: Record<CandidateType, number> = {
  REVISION: 1,
  REMEDIATION: 2,
  ASSESSMENT: 3,
  PRACTICE: 4,
  NEW_LEARNING: 5,
};
export const adaptiveGenesis = (scope: {
  learnerId: string;
  contextId: string;
  academicVersionId: string;
}): AdaptiveDecision => ({
  facts: {
    ...scope,
    masteryByConcept: {},
    mistakeByConcept: {},
    revisionByConcept: {},
    seeds: [],
  },
  candidates: [],
  selected: null,
  reasonCodes: ['NO_ELIGIBLE_ACTION'],
  explanation: 'No eligible learning action is currently available.',
  watermark: null,
});
export const compareAdaptiveSources = (a: AdaptiveSource, b: AdaptiveSource) =>
  a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
  a.sourceRank - b.sourceRank ||
  a.immutableSourceId.localeCompare(b.immutableSourceId);
const mergeFacts = (
  base: AdaptiveFacts,
  part: Partial<AdaptiveFacts>,
): AdaptiveFacts => ({
  ...base,
  ...part,
  masteryByConcept: { ...base.masteryByConcept, ...part.masteryByConcept },
  mistakeByConcept: { ...base.mistakeByConcept, ...part.mistakeByConcept },
  revisionByConcept: { ...base.revisionByConcept, ...part.revisionByConcept },
  seeds: part.seeds ? [...base.seeds, ...part.seeds] : base.seeds,
});
const reasons = (c: ScoredCandidate, f: AdaptiveFacts) => {
  const out: string[] = [];
  const r = f.revisionByConcept[c.conceptId],
    m = f.mistakeByConcept[c.conceptId];
  if (c.candidateType === 'REVISION' && r?.status === 'OVERDUE')
    out.push('REVISION_OVERDUE');
  else if (c.candidateType === 'REVISION' && r?.status === 'DUE')
    out.push('REVISION_DUE');
  else if (c.candidateType === 'REVISION' && r?.status === 'DUE_SOON')
    out.push('REVISION_DUE_SOON');
  if (m && ['CONFIRMED', 'REMEDIATING', 'REAPPEARED'].includes(m.lifecycle))
    out.push('ACTIVE_MISTAKE');
  if (m?.lifecycle === 'REAPPEARED') out.push('REAPPEARED_MISTAKE');
  if (c.masteryGap > 0.2) out.push('LOW_MASTERY');
  if (c.confidenceGap > 0.3) out.push('LOW_CONFIDENCE');
  if (c.difficultyFit >= 0.75) out.push('DIFFICULTY_FIT');
  if (c.candidateType === 'NEW_LEARNING') out.push('NOVELTY_READY');
  if (c.candidateType === 'ASSESSMENT') out.push('ASSESSMENT_AVAILABLE');
  return out;
};
export const adaptiveDecision = (facts: AdaptiveFacts): AdaptiveDecision => {
  const dedup = new Map<string, CandidateSeed>();
  for (const s of facts.seeds) {
    const state = facts.masteryByConcept[s.conceptId],
      mistake = facts.mistakeByConcept[s.conceptId],
      revision = facts.revisionByConcept[s.conceptId];
    if (
      s.candidateType === 'REVISION' &&
      !['DUE_SOON', 'DUE', 'OVERDUE'].includes(revision?.status ?? '')
    )
      continue;
    if (
      s.candidateType === 'REMEDIATION' &&
      (!mistake ||
        !['CONFIRMED', 'REMEDIATING', 'REAPPEARED'].includes(mistake.lifecycle))
    )
      continue;
    if (
      s.candidateType === 'PRACTICE' &&
      state &&
      state.mastery >= 0.8 &&
      state.confidence >= 0.7
    )
      continue;
    const key = stable([
      facts.learnerId,
      facts.contextId,
      facts.academicVersionId,
      s.candidateType,
      s.conceptId,
      s.targetRefId,
    ]);
    if (!dedup.has(key)) dedup.set(key, s);
  }
  const candidates = [...dedup.entries()].map(([key, s]): ScoredCandidate => {
    const state = facts.masteryByConcept[s.conceptId],
      mistake = facts.mistakeByConcept[s.conceptId],
      revision = facts.revisionByConcept[s.conceptId];
    let exclusion: string | null = null;
    if (
      s.ownerId !== facts.learnerId ||
      s.contextId !== facts.contextId ||
      s.academicVersionId !== facts.academicVersionId
    )
      exclusion = 'INVALID_SCOPE';
    else if (!s.active || !s.available) exclusion = 'TARGET_UNAVAILABLE';
    else if (!s.validVersion) exclusion = 'INVALID_TARGET_VERSION';
    else if (
      s.candidateType === 'NEW_LEARNING' &&
      (s.prerequisites ?? []).some((p) => p.mastery < 0.7 || p.confidence < 0.6)
    )
      exclusion = 'PREREQUISITE_NOT_READY';
    else if (
      (s.candidateType === 'REMEDIATION' && !mistake) ||
      (s.candidateType === 'REMEDIATION' &&
        !['CONFIRMED', 'REMEDIATING', 'REAPPEARED'].includes(mistake.lifecycle))
    )
      exclusion = 'REMEDIATION_NOT_ACTIVE';
    else if (
      s.candidateType === 'REVISION' &&
      !['DUE_SOON', 'DUE', 'OVERDUE'].includes(revision?.status ?? '')
    )
      exclusion = 'REVISION_NOT_DUE';
    else if (s.blockedByAssessment) exclusion = 'ASSESSMENT_POLICY_BLOCKED';
    else if (!state) exclusion = 'MISSING_REQUIRED_INPUT';
    const mastery = state?.mastery ?? 0,
      confidence = state?.confidence ?? 0;
    if (
      state &&
      (mastery < 0 || mastery > 1 || confidence < 0 || confidence > 1)
    )
      exclusion = 'MISSING_REQUIRED_INPUT';
    const ru =
      s.candidateType === 'REVISION'
        ? revision?.status === 'OVERDUE'
          ? 1
          : revision?.status === 'DUE'
            ? 0.8
            : revision?.status === 'DUE_SOON'
              ? 0.6
              : 0
        : 0;
    const mu =
      mistake &&
      ['CONFIRMED', 'REMEDIATING', 'REAPPEARED'].includes(mistake.lifecycle)
        ? clamp(
            0.45 * mistake.severity +
              0.25 * mistake.patternConfidence +
              (0.15 * Math.min(mistake.recurrenceCount, 3)) / 3 +
              (0.15 * Math.min(mistake.reappearanceCount, 2)) / 2,
          )
        : 0;
    const mg = clamp(1 - mastery),
      cg = clamp(1 - confidence),
      df =
        s.questionDifficulty == null
          ? 0.5
          : 1 - Math.min(Math.abs(s.questionDifficulty - mastery), 1),
      nn =
        s.candidateType === 'NEW_LEARNING'
          ? 1
          : s.candidateType === 'PRACTICE'
            ? 0.5
            : 0;
    const c: ScoredCandidate = {
      immutableCandidateId: sha(key),
      candidateType: s.candidateType,
      conceptId: s.conceptId,
      targetRefId: s.targetRefId,
      eligible: !exclusion,
      exclusionReason: exclusion,
      revisionUrgency: round6(ru),
      mistakeUrgency: round6(mu),
      masteryGap: round6(mg),
      confidenceGap: round6(cg),
      difficultyFit: round6(df),
      noveltyNeed: round6(nn),
      finalScore: round6(
        clamp(
          0.3 * ru + 0.25 * mu + 0.2 * mg + 0.1 * cg + 0.1 * df + 0.05 * nn,
        ),
      ),
      rank: null,
      reasonCodes: [],
    };
    c.reasonCodes = reasons(c, facts);
    return c;
  });
  const eligible = candidates
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        priority[a.candidateType] - priority[b.candidateType] ||
        a.conceptId.localeCompare(b.conceptId) ||
        a.targetRefId.localeCompare(b.targetRefId) ||
        a.immutableCandidateId.localeCompare(b.immutableCandidateId),
    );
  eligible.forEach((c, i) => (c.rank = i + 1));
  const selected = eligible[0] ?? null;
  return {
    facts,
    candidates,
    selected,
    reasonCodes: selected ? selected.reasonCodes : ['NO_ELIGIBLE_ACTION'],
    explanation: selected
      ? `Recommended ${selected.candidateType.toLowerCase().replace('_', ' ')} for ${selected.conceptId}.`
      : 'No eligible learning action is currently available.',
    watermark: null,
  };
};
export const foldAdaptiveSources = (
  scope: { learnerId: string; contextId: string; academicVersionId: string },
  sources: AdaptiveSource[],
) => {
  let d = adaptiveGenesis(scope);
  for (const source of sources.slice().sort(compareAdaptiveSources)) {
    d = adaptiveDecision(mergeFacts(d.facts, source.facts));
    d.watermark = source;
  }
  return d;
};
export const adaptivePayloadHash = (v: Omit<AdaptiveSource, 'payloadHash'>) =>
  sha(v);
