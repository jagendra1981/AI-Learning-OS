import { GatewayErrorCode } from './ai-gateway.types';
export class AiGatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}
export const safeMessage = (code: GatewayErrorCode) =>
  ({
    PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable.',
    TIMEOUT: 'The AI request timed out.',
    RATE_LIMITED: 'The AI provider is rate limiting requests.',
    INVALID_REQUEST: 'The AI request is invalid.',
    PROVIDER_AUTH_FAILURE: 'The AI provider is not configured correctly.',
    SAFETY_REJECTION: 'The request was declined by the safety policy.',
    STREAM_INTERRUPTED: 'The AI stream was interrupted.',
    INVALID_PROVIDER_RESPONSE: 'The AI provider returned an invalid response.',
    CANCELLED: 'The AI request was cancelled.',
    INTERNAL_ERROR: 'The AI request could not be completed.',
  })[code];
