export class GraphValidationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_CANONICAL_ID'
      | 'CONCEPT_NOT_FOUND'
      | 'INVALID_DEPTH'
      | 'DEPTH_LIMIT_EXCEEDED'
      | 'SELF_EDGE'
      | 'CYCLE_DETECTED'
      | 'UNKNOWN_VERSION'
      | 'INVALID_VERSION'
      | 'VERSION_SCOPE_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'GraphValidationError';
  }
}
