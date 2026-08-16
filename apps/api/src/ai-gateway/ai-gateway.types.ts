export type OutputMode = 'TEXT' | 'STRUCTURED' | 'STREAM';
export type StubScenario =
  | 'SUCCESS'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'SAFETY_REJECTION'
  | 'MALFORMED_RESPONSE'
  | 'STREAM_INTERRUPTED';
export type UsageSource =
  'PROVIDER_REPORTED' | 'SERVER_DERIVED' | 'SYNTHETIC' | 'UNAVAILABLE';
export type CostClassification =
  'PROVIDER_REPORTED' | 'ESTIMATED' | 'UNAVAILABLE';
export type GatewayErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'PROVIDER_AUTH_FAILURE'
  | 'SAFETY_REJECTION'
  | 'STREAM_INTERRUPTED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';
export type PromptStatus = 'ACTIVE' | 'DEPRECATED';
export type GatewayRequest = {
  promptId: string;
  promptVersion?: string;
  input: unknown;
  outputMode: OutputMode;
  correlationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  stubScenario?: StubScenario;
};
export type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageSource: UsageSource;
};
export type Cost = {
  amount: number | null;
  currency: string | null;
  classification: CostClassification;
};
export type GatewayError = {
  code: GatewayErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  executionId: string;
  correlationId: string;
};
export type GatewayResponse = {
  executionId: string;
  prompt: { id: string; version: string };
  provider: string;
  model: string;
  stub: boolean;
  status: 'COMPLETED' | 'CANCELLED' | 'FAILED';
  output?: unknown;
  usage: Usage;
  cost: Cost;
  latencyMs: number;
  error?: GatewayError;
};
export type StreamEvent = {
  type: 'START' | 'DELTA' | 'USAGE' | 'COMPLETE' | 'ERROR' | 'CANCELLED';
  executionId: string;
  prompt?: { id: string; version: string };
  provider?: string;
  model?: string;
  delta?: string;
  usage?: Usage;
  output?: unknown;
  error?: GatewayError;
};
export type PromptDefinition = {
  id: string;
  version: string;
  purpose: string;
  status: PromptStatus;
  inputSchema: (value: unknown) => boolean;
  outputSchema?: (value: unknown) => boolean;
  template: string;
  systemInstructions: string;
  providerPolicy: string;
};
