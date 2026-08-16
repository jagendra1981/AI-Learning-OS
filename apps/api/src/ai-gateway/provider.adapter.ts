import { AiGatewayError } from './ai-gateway.errors';
import {
  Cost,
  GatewayRequest,
  PromptDefinition,
  Usage,
} from './ai-gateway.types';

export type ProviderTransportRequest = {
  prompt: PromptDefinition;
  input: unknown;
  outputMode: GatewayRequest['outputMode'];
  signal?: AbortSignal;
};
export type ProviderTransportResponse = {
  text?: string;
  structured?: unknown;
  usage?: Partial<Usage>;
  cost?: Partial<Cost>;
  retryAfterMs?: number;
};
export interface ProviderTransport {
  execute(
    request: ProviderTransportRequest,
  ): Promise<ProviderTransportResponse>;
}

export type ProviderAdapterConfig = {
  provider: string;
  model: string;
  transport: ProviderTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
};

export class ProviderAdapter {
  constructor(private readonly config: ProviderAdapterConfig) {}
  async execute(
    request: GatewayRequest,
    prompt: PromptDefinition,
    deadlineMs = 60_000,
  ): Promise<ProviderTransportResponse> {
    const started = (this.config.now ?? Date.now)();
    let attempts = 0;
    let last: AiGatewayError | undefined;
    while (attempts < 3) {
      attempts += 1;
      try {
        const remaining =
          deadlineMs - ((this.config.now ?? Date.now)() - started);
        if (remaining <= 0)
          throw new AiGatewayError('TIMEOUT', 'Deadline exceeded.', true);
        return await this.withTimeout(
          this.config.transport.execute({
            prompt,
            input: request.input,
            outputMode: request.outputMode,
            signal: request.signal,
          }),
          remaining,
        );
      } catch (error) {
        const normalized = this.normalize(error);
        if (
          !normalized.retryable ||
          attempts >= 3 ||
          request.outputMode === 'STREAM'
        )
          throw normalized;
        last = normalized;
        const baseline = attempts === 1 ? 250 : 500;
        const jitter =
          1 + Math.min(0.2, Math.max(0, this.config.jitter?.() ?? 0));
        const retryAfter =
          normalized.retryAfterMs ?? Math.round(baseline * jitter);
        const elapsed = (this.config.now ?? Date.now)() - started;
        if (elapsed + retryAfter >= deadlineMs)
          throw new AiGatewayError(
            normalized.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'TIMEOUT',
            'Retry deadline exceeded.',
            false,
          );
        await (
          this.config.sleep ??
          ((ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms)))
        )(retryAfter);
      }
    }
    throw (
      last ?? new AiGatewayError('INTERNAL_ERROR', 'Provider execution failed.')
    );
  }
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AiGatewayError('TIMEOUT', 'Provider timed out.', true),
              ),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private normalize(error: unknown): AiGatewayError {
    if (error instanceof AiGatewayError) return error;
    const e = error as {
      status?: number;
      code?: string;
      retryAfterMs?: number;
    };
    if (e.status === 429)
      return new AiGatewayError(
        'RATE_LIMITED',
        'Provider rate limit.',
        true,
        e.retryAfterMs,
      );
    if (e.status && e.status >= 500)
      return new AiGatewayError(
        'PROVIDER_UNAVAILABLE',
        'Provider unavailable.',
        true,
      );
    if (e.code === 'AUTH')
      return new AiGatewayError(
        'PROVIDER_AUTH_FAILURE',
        'Provider authentication failed.',
      );
    return new AiGatewayError(
      'PROVIDER_UNAVAILABLE',
      'Provider unavailable.',
      true,
    );
  }
}
