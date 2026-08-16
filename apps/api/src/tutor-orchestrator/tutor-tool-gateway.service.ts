import { Injectable } from '@nestjs/common';
import { TutorOrchestratorError } from './tutor-orchestrator.errors';
import {
  TutorAuthoritativeSources,
  TutorToolId,
  TutorToolRequest,
  TutorToolResult,
} from './tutor-orchestrator.types';

const toolIds: readonly TutorToolId[] = [
  'knowledge_graph.read',
  'question_context.read',
  'learning_state.read',
  'evidence_summary.read',
  'tutor_observation.process',
];

const validObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class TutorToolGateway {
  private calls = 0;
  private readonly timeouts: Record<
    Exclude<TutorToolId, 'tutor_observation.process'>,
    number
  > = {
    'knowledge_graph.read': 750,
    'question_context.read': 750,
    'learning_state.read': 1000,
    'evidence_summary.read': 1000,
  };
  constructor(private readonly sources: TutorAuthoritativeSources) {}

  reset() {
    this.calls = 0;
  }

  async execute(
    request: TutorToolRequest,
    toolsAllowed: boolean,
    serverLearnerId: string,
  ): Promise<TutorToolResult> {
    if (!toolsAllowed || !toolIds.includes(request.toolId))
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'DENIED',
        errorCode: 'TUTOR_TOOL_DENIED',
      };
    if (this.calls >= 3)
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'DENIED',
        errorCode: 'TOOL_LIMIT_EXCEEDED',
      };
    this.calls += 1;
    if (request.toolId === 'tutor_observation.process')
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'DENIED',
        errorCode: 'OBSERVATION_INTERNAL_ONLY',
      };
    const input = this.normalizeInput(
      request.toolId,
      request.input,
      serverLearnerId,
    );
    if (!input || !this.validInput(request.toolId, input))
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'INVALID',
        errorCode: 'INVALID_TOOL_INPUT',
      };
    try {
      const data = await this.withTimeout(
        this.sources.readTool(request.toolId, input),
        this.timeouts[request.toolId],
      );
      const safeData = this.safeOutput(data);
      if (!this.validOutput(request.toolId, safeData))
        return {
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          status: 'INVALID',
          errorCode: 'INVALID_TOOL_OUTPUT',
        };
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'OK',
        data: safeData,
      };
    } catch (error) {
      if (
        error instanceof TutorOrchestratorError &&
        error.code === 'TUTOR_TIMEOUT'
      )
        return {
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          status: 'TIMEOUT',
          errorCode: error.code,
        };
      return {
        toolCallId: request.toolCallId,
        toolId: request.toolId,
        status: 'UNAVAILABLE',
        errorCode: 'TUTOR_TOOL_UNAVAILABLE',
      };
    }
  }

  private validInput(
    toolId: Exclude<TutorToolId, 'tutor_observation.process'>,
    input: unknown,
  ) {
    if (!validObject(input)) return false;
    if (toolId === 'knowledge_graph.read')
      return (
        typeof input.conceptId === 'string' &&
        typeof input.graphVersionId === 'string' &&
        (input.maxDepth === 0 || input.maxDepth === 1)
      );
    if (toolId === 'question_context.read')
      return typeof input.questionVersionId === 'string';
    if (toolId === 'learning_state.read')
      return (
        Array.isArray(input.conceptIds) &&
        input.conceptIds.length >= 1 &&
        input.conceptIds.length <= 20 &&
        input.conceptIds.every((v) => typeof v === 'string')
      );
    return (
      Array.isArray(input.conceptIds) &&
      input.conceptIds.length >= 1 &&
      input.conceptIds.length <= 20 &&
      input.conceptIds.every((v) => typeof v === 'string') &&
      Number.isInteger(input.limit) &&
      Number(input.limit) >= 1 &&
      Number(input.limit) <= 20
    );
  }

  private normalizeInput(
    toolId: Exclude<TutorToolId, 'tutor_observation.process'>,
    input: unknown,
    serverLearnerId: string,
  ): Record<string, unknown> | undefined {
    if (!validObject(input)) return undefined;
    if (
      (toolId === 'learning_state.read' ||
        toolId === 'evidence_summary.read') &&
      input.learnerId !== undefined &&
      input.learnerId !== serverLearnerId
    )
      return undefined;
    if (toolId === 'learning_state.read' || toolId === 'evidence_summary.read')
      return { ...input, learnerId: serverLearnerId };
    return input;
  }

  private validOutput(
    toolId: Exclude<TutorToolId, 'tutor_observation.process'>,
    value: unknown,
  ): boolean {
    if (!validObject(value)) return false;
    if (toolId === 'knowledge_graph.read')
      return (
        typeof value.conceptId === 'string' &&
        typeof value.graphVersionId === 'string' &&
        Array.isArray(value.prerequisites) &&
        value.prerequisites.every(
          (item) =>
            validObject(item) &&
            typeof item.conceptId === 'string' &&
            typeof item.label === 'string',
        )
      );
    if (toolId === 'question_context.read')
      return (
        typeof value.questionId === 'string' &&
        typeof value.questionVersionId === 'string' &&
        typeof value.type === 'string' &&
        typeof value.stem === 'string' &&
        (value.options === undefined ||
          (Array.isArray(value.options) &&
            value.options.every(
              (item) =>
                validObject(item) &&
                typeof item.id === 'string' &&
                typeof item.text === 'string',
            )))
      );
    if (toolId === 'learning_state.read')
      return (
        Array.isArray(value.states) &&
        value.states.every(
          (item) =>
            validObject(item) &&
            typeof item.conceptId === 'string' &&
            typeof item.state === 'string',
        )
      );
    return (
      Array.isArray(value.items) &&
      value.items.every(
        (item) =>
          validObject(item) &&
          typeof item.conceptId === 'string' &&
          typeof item.category === 'string' &&
          typeof item.occurredAt === 'string',
      )
    );
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new TutorOrchestratorError(
              'TUTOR_TIMEOUT',
              'Tool timed out.',
              true,
            ),
          ),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private safeOutput(value: unknown): unknown {
    const forbidden =
      /answerkey|answer_key|correctanswer|correct_answer|hiddensolution|hidden_solution|rubric|password|token|secret|apikey|api_key|cookie|authorization|chain.?of.?thought/i;
    if (Array.isArray(value)) return value.map((item) => this.safeOutput(item));
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      return value;
    if (!validObject(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !forbidden.test(key))
        .map(([key, item]) => [key, this.safeOutput(item)]),
    );
  }
}
