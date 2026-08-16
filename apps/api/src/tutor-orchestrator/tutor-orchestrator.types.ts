import { Prisma } from '@prisma/client';
import { StubScenario } from '../ai-gateway/ai-gateway.types';

export type TutorStatus =
  'ANSWER' | 'HINT' | 'QUESTION' | 'REFUSAL' | 'DEGRADED';
export type PolicyMode =
  | 'GENERAL'
  | 'PRACTICE_GUIDED'
  | 'ASSESSMENT_RESTRICTED'
  | 'RETRY_GUIDED'
  | 'POST_RELEASE';
export type TutorActionType =
  | 'CONTINUE'
  | 'RETRY'
  | 'OPEN_PRACTICE'
  | 'OPEN_REVISION'
  | 'OPEN_PROGRESS'
  | 'STOP';
export type ActivityType =
  | 'GENERAL_LEARNING'
  | 'PRACTICE'
  | 'DIAGNOSTIC'
  | 'GRADED_ASSESSMENT'
  | 'RETRY'
  | 'COMPLETED_REVIEW';
export type TutorToolId =
  | 'knowledge_graph.read'
  | 'question_context.read'
  | 'learning_state.read'
  | 'evidence_summary.read'
  | 'tutor_observation.process';
export type ObservationCode =
  | 'SELF_CORRECTION'
  | 'EXPLANATION_COMPLETE'
  | 'EXPLANATION_PARTIAL'
  | 'REQUESTED_CLARIFICATION'
  | 'ABANDONED_ATTEMPT';
export type TargetType = 'QUESTION_VERSION' | 'CONCEPT';

export type TutorAction = {
  type: TutorActionType;
  label: string;
  href?: string;
};

export type TutorContext = {
  learnerId: string;
  academicScope: Record<string, string | null>;
  graphVersionId: string | null;
  learningState: Record<string, unknown> | null;
  evidenceSummary: Record<string, unknown> | null;
  activity: ActivityType;
  question: Record<string, unknown> | null;
  assessment: Record<string, unknown> | null;
  learnerMessage: string;
  freshness: Record<string, string | number | null>;
  attachments?: Array<{
    attachmentId: string;
    purpose: string;
    mimeType: string;
    width: number;
    height: number;
    bytes: Buffer;
  }>;
};

export type TutorResponse = {
  status: TutorStatus;
  message: string;
  policyMode: PolicyMode;
  actions: TutorAction[];
  contextRefs: string[];
  execution: {
    executionId: string;
    correlationId: string;
    stub: boolean;
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    usageSource: string;
  };
};

export type TutorToolRequest = {
  toolCallId: string;
  toolId: TutorToolId;
  input: unknown;
};

export type TutorToolResult = {
  toolCallId: string;
  toolId: TutorToolId;
  status: 'OK' | 'DENIED' | 'UNAVAILABLE' | 'INVALID' | 'TIMEOUT';
  data?: unknown;
  errorCode?: string;
};

export type TutorObservationHandoff = {
  learnerId: string;
  tutorActorId: string;
  observationCode: ObservationCode;
  targetType: TargetType;
  targetId: string;
  academicContext: Prisma.InputJsonValue;
  occurredAt: Date;
  correlationId: string;
  idempotencyKey: string;
};

export type TutorInteraction =
  | 'SELF_CORRECTION'
  | 'EXPLANATION'
  | 'REQUESTED_CLARIFICATION'
  | 'ABANDONED_ATTEMPT'
  | 'HINT_REQUESTED'
  | 'EXPLANATION_REQUESTED'
  | 'DEBUG_ATTEMPT_SUBMITTED'
  | 'RETRY_REQUESTED'
  | 'ASSESSMENT_REFUSAL'
  | 'UNSUPPORTED';

export type TutorRequest = {
  learnerId: string;
  authenticatedLearnerId: string;
  tutorActorId: string;
  sessionId: string;
  interactionId: string;
  correlationId: string;
  academicScope: Record<string, string | null>;
  activity: ActivityType;
  learnerMessage: string;
  target?: { type: TargetType; id: string };
  academicContext: Prisma.InputJsonValue;
  occurredAt: Date;
  interaction?: TutorInteraction;
  explanationClassification?: 'COMPLETE' | 'PARTIAL';
  abandonmentRecorded?: boolean;
  assessment?: Record<string, unknown> | null;
  question?: Record<string, unknown> | null;
  signal?: AbortSignal;
  stubScenario?: StubScenario;
  attachmentIds?: string[];
};

export type TutorRevalidation = {
  learnerOwned: boolean;
  scopeValid: boolean;
  targetValid: boolean;
  assessmentAllows: boolean;
  cancelled: boolean;
  fresh: boolean;
};

export type TutorAuthoritativeSources = {
  buildContext(request: TutorRequest): Promise<TutorContext>;
  revalidate(
    request: TutorRequest,
    gate: 'PRE_TOOL' | 'PRE_RELEASE' | 'PRE_OBSERVATION',
  ): Promise<TutorRevalidation>;
  readTool(
    toolId: Exclude<TutorToolId, 'tutor_observation.process'>,
    input: unknown,
  ): Promise<unknown>;
};
