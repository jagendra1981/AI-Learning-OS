export const tutorIntents = [
  'ASK_DOUBT',
  'EXPLAIN',
  'HINT',
  'STRONGER_HINT',
  'WORKED_EXAMPLE',
  'DEBUG',
  'RECOMMEND_NEXT',
] as const;

export type TutorIntent = (typeof tutorIntents)[number];

export type TutorInteractionRequest = {
  sessionId: string;
  interactionId?: string;
  message: string;
  intent: TutorIntent;
  attachmentIds?: string[];
  clientRequestId: string;
};

export type TutorInteractionResponse = {
  interactionId: string;
  sessionId: string;
  status:
    | 'ACCEPTED'
    | 'STREAMING'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'INTERRUPTED'
    | 'REFUSED'
    | 'RESTRICTED'
    | 'FAILED';
  assistance:
    | 'EXPLANATION'
    | 'HINT'
    | 'STRONGER_HINT'
    | 'WORKED_EXAMPLE'
    | 'DEBUG_GUIDANCE'
    | 'RECOMMENDATION'
    | 'REFUSAL'
    | 'RESTRICTION';
  uncertainty?:
    | 'NONE'
    | 'NEEDS_CONTEXT'
    | 'AMBIGUOUS'
    | 'INSUFFICIENT_EVIDENCE'
    | 'AI_UNAVAILABLE';
  message?: string;
  retryable: boolean;
  attachmentIds?: string[];
  correlationId?: string;
};

export type TutorStreamEvent =
  | { type: 'STARTED'; interactionId: string }
  | { type: 'DELTA'; interactionId: string; text: string }
  | {
      type: 'UNCERTAINTY';
      interactionId: string;
      state: NonNullable<TutorInteractionResponse['uncertainty']>;
      message?: string;
    }
  | { type: 'REFUSED'; interactionId: string; message: string }
  | { type: 'RESTRICTED'; interactionId: string; message: string }
  | { type: 'COMPLETED'; interactionId: string }
  | { type: 'CANCELLED'; interactionId: string }
  | {
      type: 'INTERRUPTED';
      interactionId: string;
      retryable: boolean;
      message: string;
    }
  | {
      type: 'FAILED';
      interactionId: string;
      retryable: boolean;
      message: string;
    };
