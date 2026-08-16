export type TutorErrorCode =
  | 'TUTOR_UNAVAILABLE'
  | 'TUTOR_TIMEOUT'
  | 'TUTOR_CANCELLED'
  | 'TUTOR_INVALID_OUTPUT'
  | 'TUTOR_POLICY_BLOCKED'
  | 'TUTOR_ASSESSMENT_RESTRICTED'
  | 'TUTOR_TOOL_UNAVAILABLE'
  | 'TUTOR_TOOL_DENIED'
  | 'TUTOR_STALE_CONTEXT'
  | 'TUTOR_OBSERVATION_REJECTED'
  | 'TUTOR_RATE_LIMITED'
  | 'TUTOR_AUTH_REQUIRED'
  | 'TUTOR_FORBIDDEN';

export class TutorOrchestratorError extends Error {
  constructor(
    readonly code: TutorErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export const tutorError = (
  code: TutorErrorCode,
  message: string,
  retryable = false,
): never => {
  throw new TutorOrchestratorError(code, message, retryable);
};
