import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AiGatewayError, safeMessage } from './ai-gateway.errors';
import { PromptRegistry } from './prompt-registry';
import { SafeStubAdapter } from './safe-stub.adapter';
import { DOMAIN_METRICS, metrics } from '../observability/metrics';
import {
  GatewayRequest,
  GatewayResponse,
  StreamEvent,
} from './ai-gateway.types';
@Injectable()
export class AiGatewayService {
  readonly timeouts = Object.freeze({
    connectMs: 10_000,
    executionMs: 60_000,
    streamInitialMs: 30_000,
    streamInactivityMs: 30_000,
    streamHardMs: 120_000,
  });
  constructor(
    @Inject(PromptRegistry)
    readonly registry = new PromptRegistry(),
    @Inject(SafeStubAdapter)
    readonly stub = new SafeStubAdapter(),
  ) {}
  execute(request: GatewayRequest): GatewayResponse {
    const startedAt = Date.now();
    const executionId = randomUUID();
    const correlationId = request.correlationId ?? randomUUID();
    try {
      const prompt = this.registry.resolve(
        request.promptId,
        request.promptVersion,
      );
      const result = this.stub.execute(request, prompt, executionId, correlationId);
      metrics.increment(DOMAIN_METRICS.aiRequests, { operation: 'execute', outcome: result.status === 'FAILED' ? 'failure' : 'success' });
      metrics.observe(DOMAIN_METRICS.aiLatency, { operation: 'execute' }, (Date.now() - startedAt) / 1000);
      return result;
    } catch (e) {
      const err =
        e instanceof AiGatewayError
          ? e
          : new AiGatewayError('INTERNAL_ERROR', 'Internal error.');
      metrics.increment(DOMAIN_METRICS.aiRequests, { operation: 'execute', outcome: 'failure' });
      metrics.observe(DOMAIN_METRICS.aiLatency, { operation: 'execute' }, (Date.now() - startedAt) / 1000);
      return {
        executionId,
        prompt: {
          id: request.promptId,
          version: request.promptVersion ?? 'unknown',
        },
        provider: this.stub.provider,
        model: this.stub.model,
        stub: true,
        status: err.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          usageSource: 'UNAVAILABLE',
        },
        cost: { amount: null, currency: null, classification: 'UNAVAILABLE' },
        latencyMs: 0,
        error: {
          code: err.code,
          message: safeMessage(err.code),
          retryable: err.retryable,
          retryAfterMs: err.retryAfterMs,
          executionId,
          correlationId,
        },
      };
    }
  }
  stream(request: GatewayRequest): StreamEvent[] {
    const startedAt = Date.now();
    const executionId = randomUUID();
    const correlationId = request.correlationId ?? randomUUID();
    try {
      const prompt = this.registry.resolve(
        request.promptId,
        request.promptVersion,
      );
      const result = this.stub.stream(request, prompt, executionId, correlationId);
      metrics.increment(DOMAIN_METRICS.aiRequests, { operation: 'stream', outcome: result.some((event) => event.type === 'ERROR') ? 'failure' : 'success' });
      metrics.observe(DOMAIN_METRICS.aiLatency, { operation: 'stream' }, (Date.now() - startedAt) / 1000);
      return result;
    } catch (e) {
      const err =
        e instanceof AiGatewayError
          ? e
          : new AiGatewayError('INTERNAL_ERROR', 'Internal error.');
      metrics.increment(DOMAIN_METRICS.aiRequests, { operation: 'stream', outcome: 'failure' });
      metrics.observe(DOMAIN_METRICS.aiLatency, { operation: 'stream' }, (Date.now() - startedAt) / 1000);
      return [
        {
          type: err.code === 'CANCELLED' ? 'CANCELLED' : 'ERROR',
          executionId,
          error: {
            code: err.code,
            message: safeMessage(err.code),
            retryable: err.retryable,
            retryAfterMs: err.retryAfterMs,
            executionId,
            correlationId,
          },
        },
      ];
    }
  }
}
