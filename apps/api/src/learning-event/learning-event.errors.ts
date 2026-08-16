export class LearningEventError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const learningEventInvalid = (
  message = 'Learning event is invalid.',
): never => {
  throw new LearningEventError('LEARNING_EVENT_INVALID', message);
};
export const learningEventConflict = (): never => {
  throw new LearningEventError(
    'IDEMPOTENCY_CONFLICT',
    'Learning event idempotency conflict.',
  );
};
export const learningEventForbidden = (): never => {
  throw new LearningEventError(
    'FORBIDDEN',
    'Learning event access is forbidden.',
  );
};
