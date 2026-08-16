export class EvidenceProcessingError extends Error {
  constructor(
    public readonly code: string,
    message = 'Evidence processing request is invalid.',
  ) {
    super(message);
  }
}

export const evidenceInvalid = (message?: string): never => {
  throw new EvidenceProcessingError('EVIDENCE_INVALID', message);
};

export const evidenceConflict = (): never => {
  throw new EvidenceProcessingError(
    'EVIDENCE_IDEMPOTENCY_CONFLICT',
    'Evidence already exists with conflicting immutable content.',
  );
};

export const evidenceForbidden = (): never => {
  throw new EvidenceProcessingError('EVIDENCE_FORBIDDEN');
};
