import { AiGatewayError } from './ai-gateway.errors';
import { PromptDefinition } from './ai-gateway.types';
const text = (v: unknown) => typeof v === 'string';
const textOrStructured = (v: unknown) =>
  typeof v === 'string' || (!!v && typeof v === 'object');
const definitions: readonly PromptDefinition[] = Object.freeze([
  {
    id: 'tutor.orchestrator',
    version: '1.0.0',
    purpose: 'C032 Tutor Orchestrator structured response',
    status: 'ACTIVE',
    inputSchema: textOrStructured,
    outputSchema: textOrStructured,
    template: '{{input}}',
    systemInstructions:
      'Return only learner-safe structured TutorResponse data.',
    providerPolicy: 'default',
  },
  {
    id: 'c031.test',
    version: '1',
    purpose: 'C031 deterministic contract prompt',
    status: 'ACTIVE',
    inputSchema: text,
    outputSchema: textOrStructured,
    template: '{{input}}',
    systemInstructions: 'Return only the registered response.',
    providerPolicy: 'default',
  },
]);
export class PromptRegistry {
  constructor(
    private readonly entries: readonly PromptDefinition[] = definitions,
  ) {}
  resolve(id: string, version?: string) {
    const found = this.entries.filter(
      (p) => p.id === id && (!version || p.version === version),
    );
    if (!found.length)
      throw new AiGatewayError(
        'INVALID_REQUEST',
        'Unknown prompt or prompt version.',
      );
    const prompt = version
      ? found[0]
      : found.find((p) => p.status === 'ACTIVE');
    if (!prompt)
      throw new AiGatewayError(
        'INVALID_REQUEST',
        'The requested prompt version is not executable.',
      );
    return prompt;
  }
  all() {
    return this.entries;
  }
}
