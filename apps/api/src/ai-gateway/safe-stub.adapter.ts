/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import { AiGatewayError } from './ai-gateway.errors';
import {
  GatewayRequest,
  GatewayResponse,
  PromptDefinition,
  StreamEvent,
  Usage,
} from './ai-gateway.types';
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
export class SafeStubAdapter {
  readonly provider = 'SAFE_STUB';
  readonly model = 'deterministic-v1';
  readonly stub = true;
  private usage(output: string): Usage {
    const n = output.length;
    return {
      inputTokens: n,
      outputTokens: n,
      totalTokens: n * 2,
      usageSource: 'SYNTHETIC',
    };
  }
  private scenario(request: GatewayRequest) {
    if (process.env.NODE_ENV === 'production' && request.stubScenario)
      throw new AiGatewayError(
        'INVALID_REQUEST',
        'Stub scenarios are unavailable.',
      );
    return request.stubScenario ?? 'SUCCESS';
  }
  execute(
    request: GatewayRequest,
    prompt: PromptDefinition,
    executionId: string,
    correlationId: string,
  ): GatewayResponse {
    const started = Date.now();
    const scenario = this.scenario(request);
    if (request.signal?.aborted)
      throw new AiGatewayError('CANCELLED', 'Cancelled.');
    if (!prompt.inputSchema(request.input))
      throw new AiGatewayError(
        'INVALID_REQUEST',
        'Input does not match the prompt contract.',
      );
    if (scenario === 'TIMEOUT')
      throw new AiGatewayError('TIMEOUT', 'Timed out.', true);
    if (scenario === 'RATE_LIMITED')
      throw new AiGatewayError('RATE_LIMITED', 'Rate limited.', true, 250);
    if (scenario === 'PROVIDER_UNAVAILABLE')
      throw new AiGatewayError('PROVIDER_UNAVAILABLE', 'Unavailable.', true);
    if (scenario === 'SAFETY_REJECTION')
      throw new AiGatewayError('SAFETY_REJECTION', 'Rejected.');
    if (scenario === 'MALFORMED_RESPONSE')
      throw new AiGatewayError(
        'INVALID_PROVIDER_RESPONSE',
        'Malformed response.',
      );
    const output =
      request.outputMode === 'STRUCTURED'
        ? prompt.id === 'tutor.orchestrator'
          ? {
              status: 'ANSWER',
              message: `SAFE_STUB:${hash({ prompt: prompt.id, version: prompt.version, input: request.input, scenario })}`,
              policyMode: 'GENERAL',
              actions: [],
            }
          : {
              deterministic: hash({
                prompt: prompt.id,
                version: prompt.version,
                input: request.input,
                scenario,
              }),
            }
        : `SAFE_STUB:${hash({ prompt: prompt.id, version: prompt.version, input: request.input, scenario })}`;
    if (prompt.outputSchema && !prompt.outputSchema(output))
      throw new AiGatewayError('INVALID_PROVIDER_RESPONSE', 'Invalid output.');
    return {
      executionId,
      prompt: { id: prompt.id, version: prompt.version },
      provider: this.provider,
      model: this.model,
      stub: true,
      status: 'COMPLETED',
      output,
      usage: this.usage(JSON.stringify(output)),
      cost: { amount: null, currency: null, classification: 'UNAVAILABLE' },
      latencyMs: Date.now() - started,
    };
  }
  stream(
    request: GatewayRequest,
    prompt: PromptDefinition,
    executionId: string,
    correlationId: string,
  ): StreamEvent[] {
    const response = this.execute(
      { ...request, outputMode: 'TEXT' },
      prompt,
      executionId,
      correlationId,
    );
    const output = String(response.output);
    const events: StreamEvent[] = [
      {
        type: 'START',
        executionId,
        prompt: response.prompt,
        provider: this.provider,
        model: this.model,
      },
      { type: 'DELTA', executionId, delta: output },
      { type: 'USAGE', executionId, usage: response.usage },
    ];
    if (this.scenario(request) === 'STREAM_INTERRUPTED')
      return [
        ...events,
        {
          type: 'ERROR',
          executionId,
          error: {
            code: 'STREAM_INTERRUPTED',
            message: 'The AI stream was interrupted.',
            retryable: false,
            executionId,
            correlationId,
          },
        },
      ];
    return [
      ...events,
      { type: 'COMPLETE', executionId, output, usage: response.usage },
    ];
  }
}
