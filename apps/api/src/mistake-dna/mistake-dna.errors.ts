export class MistakeDnaError extends Error {
  constructor(
    public readonly code: string,
    message = 'Mistake DNA request is invalid.',
  ) {
    super(message);
  }
}
export const mdForbidden = (): never => {
  throw new MistakeDnaError('MISTAKE_DNA_CONTEXT_MISMATCH');
};
export const mdConflict = (): never => {
  throw new MistakeDnaError('MISTAKE_DNA_IDEMPOTENCY_CONFLICT');
};
