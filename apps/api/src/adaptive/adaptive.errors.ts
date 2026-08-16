export class AdaptiveError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
