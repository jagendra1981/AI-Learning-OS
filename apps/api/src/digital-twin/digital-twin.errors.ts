export class DigitalTwinError extends Error {
  constructor(
    public readonly code: string,
    message = 'Digital Twin request is invalid.',
  ) {
    super(message);
  }
}
export const dtInvalid = (message?: string): never => {
  throw new DigitalTwinError('DIGITAL_TWIN_INVALID', message);
};
export const dtForbidden = (): never => {
  throw new DigitalTwinError('DIGITAL_TWIN_FORBIDDEN');
};
export const dtConflict = (): never => {
  throw new DigitalTwinError(
    'STATE_IDEMPOTENCY_CONFLICT',
    'Projection identity has conflicting immutable content.',
  );
};
