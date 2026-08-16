import { createHash } from 'node:crypto';

export const DTP_ALGORITHM = 'dtp-v1';
export const DTP_CONFIG = 'dtp-config-v1';
export const DTP_PROCESSING_VERSION = 'c021-v1';
export const DTP_CONFIG_VALUES = Object.freeze({
  initialMastery: 0.5,
  initialConfidence: 0,
  baseLearningRate: 0.2,
  independentCorrectWeight: 1,
  ordinaryCorrectWeight: 0.9,
  hintCorrectWeight: 0.65,
  retryCorrectWeight: 0.6,
  hintAndRetryCorrectWeight: 0.5,
  incorrectWeight: 1,
  persistentErrorWeight: 1.15,
  unansweredWeight: 0.5,
  confidenceEvidenceScale: 5,
  minimumMastery: 0,
  maximumMastery: 1,
  minimumConfidence: 0,
  maximumConfidence: 1,
});
export const DTP_ALGORITHM_REGISTRY = Object.freeze({
  [DTP_ALGORITHM]: {
    configId: DTP_CONFIG,
    processingVersion: DTP_PROCESSING_VERSION,
    status: 'ACTIVE',
  },
});
export type ProjectionInput = {
  inputId: string;
  sourceOccurredAt: Date;
  outcome: 'CORRECT' | 'INCORRECT' | 'UNANSWERED';
  weight: number;
};
export type TwinValue = {
  mastery: number;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date;
  watermark: string;
};
const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const orderInputs = (inputs: ProjectionInput[]) =>
  [...inputs].sort(
    (a, b) =>
      a.sourceOccurredAt.getTime() - b.sourceOccurredAt.getTime() ||
      a.inputId.localeCompare(b.inputId),
  );
export const projectionIdentity = (
  learnerId: string,
  targetId: string,
  context: string,
  previousSnapshotId: string | null,
  inputIds: string[],
) =>
  sha(
    [
      DTP_PROCESSING_VERSION,
      learnerId,
      'CONCEPT',
      targetId,
      context,
      DTP_ALGORITHM,
      DTP_CONFIG,
      previousSnapshotId ?? 'GENESIS',
      ...inputIds,
    ].join('|'),
  );
export function project(
  initial: TwinValue | null,
  inputs: ProjectionInput[],
): TwinValue {
  let s = initial ?? {
    mastery: 0.5,
    confidence: 0,
    evidenceCount: 0,
    lastEvidenceAt: new Date(0),
    watermark: '',
  };
  for (const i of orderInputs(inputs)) {
    const x =
      i.outcome === 'CORRECT' ? 1 : i.outcome === 'INCORRECT' ? 0 : 0.25;
    const alpha = Math.min(1, DTP_CONFIG_VALUES.baseLearningRate * i.weight);
    const mastery = Math.min(
      1,
      Math.max(0, s.mastery + alpha * (x - s.mastery)),
    );
    const evidenceCount = s.evidenceCount + 1;
    const confidence =
      evidenceCount /
      (evidenceCount + DTP_CONFIG_VALUES.confidenceEvidenceScale);
    s = {
      mastery: round(mastery),
      confidence: round(Math.min(1, Math.max(0, confidence))),
      evidenceCount,
      lastEvidenceAt: i.sourceOccurredAt,
      watermark: i.inputId,
    };
  }
  return s;
}
