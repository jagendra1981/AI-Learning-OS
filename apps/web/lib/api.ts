/* eslint-disable @typescript-eslint/no-explicit-any */
export type ApiError = {
  status: number;
  code?: string;
  message: string;
  fields?: Record<string, string>;
};
export type TutorIntent =
  | 'ASK_DOUBT'
  | 'EXPLAIN'
  | 'HINT'
  | 'STRONGER_HINT'
  | 'WORKED_EXAMPLE'
  | 'DEBUG'
  | 'RECOMMEND_NEXT';
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
export type LearnerAttachment = {
  attachmentId: string;
  purpose: string;
  safeDisplayName: string;
  detectedMimeType?: string;
  sizeBytes?: number;
  status:
    | 'PENDING_UPLOAD'
    | 'VALIDATING'
    | 'AVAILABLE'
    | 'REJECTED'
    | 'DELETED'
    | 'EXPIRED';
  createdAt: string;
  validatedAt?: string;
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
      type: 'INTERRUPTED' | 'FAILED';
      interactionId: string;
      retryable: boolean;
      message: string;
    };
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';
function csrf() {
  return document.cookie.match(/(?:^|; )aio_csrf=([^;]+)/)?.[1];
}
export function safePath(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    /[a-z][a-z0-9+.-]*:/i.test(value)
  )
    return '/dashboard';
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : '/dashboard';
  } catch {
    return '/dashboard';
  }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') {
    const token = csrf();
    if (token) headers.set('x-csrf-token', decodeURIComponent(token));
  }
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw {
      status: 0,
      message:
        'We could not connect to the service. Check your connection and try again.',
    } satisfies ApiError;
  }
  if (response.ok)
    return response.status === 204 ? (undefined as T) : response.json();
  let body: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  } = {};
  try {
    body = await response.json();
  } catch {
    /* safe generic mapping */
  }
  const messages: Record<number, string> = {
    400: 'Check the highlighted fields.',
    401: 'Your session has ended. Please sign in again.',
    403: 'You do not have access to this area.',
    404: 'We could not find that page or resource.',
    409: 'This changed elsewhere. Refresh and try again.',
    422: 'Check the highlighted fields.',
    429: 'Too many attempts. Please wait and try again.',
  };
  const safeMessage =
    messages[response.status] ??
    (response.status >= 500
      ? 'The service is temporarily unavailable. Please try again.'
      : 'We could not complete that request. Please try again.');
  throw {
    status: response.status,
    code: body.code,
    fields: body.fields,
    message: safeMessage,
  } satisfies ApiError;
}
export const api = {
  me: () =>
    request<{
      userId: string;
      sessionId: string;
      roles?: string[];
    }>('/api/v1/auth/me'),
  onboarding: () => request<{ state: string }>('/api/v1/profile/onboarding'),
  reviewQueue: () =>
    request<{
      items: Array<{
        itemType: 'QUESTION' | 'CONFIGURATION' | 'ACADEMIC_ISSUE';
        itemId: string;
        title: string;
        status: string;
        createdAt: string;
        context: { examId: string; subjectId: string };
        actionNeeded: boolean;
      }>;
    }>('/api/v1/review/queue'),
  questionReview: (versionId: string) =>
    request<{
      questionVersionId: string;
      questionType: string;
      stem: unknown;
      options: unknown;
      status: string;
      createdAt: string;
      context: { examId: string; subjectId: string; syllabusNodeId: string };
      source: { authorOrSource: string; originType: string; verificationStatus: string } | null;
      rightsStatus: string | null;
      hasAnswer: boolean;
      hasSolution: boolean;
    }>(`/api/v1/questions/versions/${encodeURIComponent(versionId)}`),
  reviewQuestion: (versionId: string, action: 'approve' | 'reject', reason: string) =>
    request(`/api/v1/questions/versions/${encodeURIComponent(versionId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason, correlationId: crypto.randomUUID() }),
    }),
  configurationReview: (versionId: string) =>
    request<{
      configurationVersionId: string;
      versionNumber: number;
      status: string;
      createdAt: string;
      context: { examId: string; subjectId: string };
      changeCount: number;
    }>(`/api/v1/configuration/versions/${encodeURIComponent(versionId)}/review`),
  reviewConfiguration: (versionId: string, decision: 'APPROVED' | 'REJECTED', reason: string) =>
    request(`/api/v1/configuration/versions/${encodeURIComponent(versionId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason, correlationId: crypto.randomUUID() }),
    }),
  academicIssueReview: (issueId: string) =>
    request<{
      issueId: string;
      itemType: 'ACADEMIC_ISSUE';
      sourceType: string;
      summary: string;
      status: 'OPEN' | 'RESOLVED';
      createdAt: string;
      updatedAt: string;
      context: { examId: string; subjectId: string };
    }>(`/api/v1/review/academic-issues/${encodeURIComponent(issueId)}`),
  resolveAcademicIssue: (issueId: string) =>
    request<{ issueId: string; status: 'RESOLVED'; updatedAt: string }>(
      `/api/v1/review/academic-issues/${encodeURIComponent(issueId)}/resolve`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  login: (body: { email: string; password: string }) =>
    request<{ user: { userId: string; sessionId: string; email: string } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  register: (body: { email: string; password: string }) =>
    request<{ user: { userId: string; sessionId: string; email: string } }>(
      '/api/v1/auth/register',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
  resetRequest: (email: string) =>
    request('/api/v1/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetComplete: (token: string, password: string) =>
    request('/api/v1/auth/reset-complete', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  profile: () => request<Record<string, unknown> | null>('/api/v1/profile'),
  updateProfile: (body: Record<string, unknown>) =>
    request('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  consent: (body: { consentType: string; policyVersion: string }) =>
    request('/api/v1/profile/consents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  goal: (body: { examId: string; targetYear: number }) =>
    request('/api/v1/profile/exam-goals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  consents: () =>
    request<
      Array<{
        consentId: string;
        consentType: string;
        policyVersion: string;
        state: string;
        recordedAt: string;
        revokedAt: string | null;
      }>
    >('/api/v1/profile/consents'),
  withdrawConsent: (consentId: string) =>
    request(
      `/api/v1/profile/consents/${encodeURIComponent(consentId)}/withdraw`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    ),
  goals: () =>
    request<Array<{ examGoalId: string; examId: string; targetYear: number }>>(
      '/api/v1/profile/exam-goals',
    ),
  finalizeOnboarding: () =>
    request<{ state: string }>('/api/v1/profile/onboarding/finalize', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  diagnosticEntry: () =>
    request<{
      readiness: string;
      academicVersionId: string;
      examId: string;
      subjectId: string;
      targetConceptId: string;
      sessionId: string | null;
      existingDiagnosticId: string | null;
    }>('/api/v1/diagnostics/entry'),
  acquireDiagnostic: (scope: {
    academicVersionId: string;
    examId: string;
    subjectId: string;
    targetConceptId: string;
    sessionId?: string | null;
  }) =>
    request<{ diagnosticRunId: string; status: string }>(
      '/api/v1/diagnostics/entry',
      { method: 'POST', body: JSON.stringify(scope) },
    ),
  diagnostic: (id: string) =>
    request<Record<string, unknown>>(
      `/api/v1/diagnostics/${encodeURIComponent(id)}`,
    ),
  question: (id: string) =>
    request<Record<string, unknown>>(
      `/api/v1/diagnostics/${encodeURIComponent(id)}/question`,
    ),
  answer: (
    id: string,
    body: {
      sessionId: string;
      placementId: string;
      idempotencyKey: string;
      selectedOption?: string | null;
      questionVersionId?: string;
    },
  ) =>
    request<Record<string, unknown>>(
      `/api/v1/diagnostics/${encodeURIComponent(id)}/answer`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  nextQuestion: (id: string) =>
    request<Record<string, unknown>>(
      `/api/v1/diagnostics/${encodeURIComponent(id)}/next`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  result: (id: string) =>
    request<Record<string, unknown>>(
      `/api/v1/diagnostics/${encodeURIComponent(id)}/result`,
    ),
  practice: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}`,
    ),
  practiceAcquire: (body: Record<string, unknown> = {}) =>
    request<Record<string, any>>('/api/v1/practice-sessions/acquire', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  practiceNext: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/next`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  practiceRespond: (id: string, body: Record<string, unknown>) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/responses`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  practiceHint: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/hint`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  practiceRetry: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/retry`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  practiceComplete: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/complete`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  practiceStop: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  practiceSolution: (id: string) =>
    request<Record<string, any>>(
      `/api/v1/practice-sessions/${encodeURIComponent(id)}/solution`,
    ),
  today: (scope: {
    contextId: string;
    academicVersion: string;
    planDateLocal: string;
  }) =>
    request<Record<string, any>>(
      `/api/v1/read-model/today?contextId=${encodeURIComponent(scope.contextId)}&academicVersion=${encodeURIComponent(scope.academicVersion)}&planDateLocal=${scope.planDateLocal}`,
    ),
  progress: (scope: { contextId: string; academicVersion: string }) =>
    request<Record<string, any>>(
      `/api/v1/read-model/progress?contextId=${encodeURIComponent(scope.contextId)}&academicVersion=${encodeURIComponent(scope.academicVersion)}`,
    ),
  mistakes: (scope: { contextId: string; academicVersion: string }) =>
    request<Record<string, any>>(
      `/api/v1/read-model/mistakes?contextId=${encodeURIComponent(scope.contextId)}&academicVersion=${encodeURIComponent(scope.academicVersion)}`,
    ),
  revisions: (scope: { contextId: string; academicVersion: string }) =>
    request<Record<string, any>>(
      `/api/v1/read-model/revision?contextId=${encodeURIComponent(scope.contextId)}&academicVersion=${encodeURIComponent(scope.academicVersion)}`,
    ),
  recommendation: (scope: { contextId: string; academicVersion: string }) =>
    request<Record<string, any>>(
      `/api/v1/read-model/next-best-action?contextId=${encodeURIComponent(scope.contextId)}&academicVersion=${encodeURIComponent(scope.academicVersion)}`,
    ),
  tutorInteraction: (body: {
    sessionId: string;
    interactionId?: string;
    message: string;
    intent: TutorIntent;
    attachmentIds?: string[];
    clientRequestId: string;
  }) =>
    request<TutorInteractionResponse>('/api/tutor/interactions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelTutorInteraction: (interactionId: string) =>
    request<{ interactionId: string; cancellationRequested: boolean }>(
      `/api/tutor/interactions/${encodeURIComponent(interactionId)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  prepareAttachment: (body: {
    purpose: 'TUTOR_IMAGE';
    originalFilename: string;
    declaredMimeType: string;
    sizeBytes: number;
    idempotencyKey: string;
  }) =>
    request<{
      attachmentId: string;
      uploadUrl: string;
      method: 'PUT';
      expiresAt: string;
      requiredHeaders: Record<string, string>;
    }>('/api/v1/attachments/prepare-upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadAttachment: async (
    uploadUrl: string,
    method: 'PUT',
    headers: Record<string, string>,
    file: File,
  ) => {
    const response = await fetch(uploadUrl, {
      method,
      headers,
      body: file,
      credentials: 'include',
    });
    if (!response.ok)
      throw {
        status: response.status,
        message: 'The attachment upload failed.',
      } satisfies ApiError;
  },
  completeAttachment: (attachmentId: string) =>
    request<LearnerAttachment>('/api/v1/attachments/complete-upload', {
      method: 'POST',
      body: JSON.stringify({ attachmentId }),
    }),
  readAttachment: (attachmentId: string) =>
    request<LearnerAttachment>(
      `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
    ),
  deleteAttachment: (attachmentId: string) =>
    request<{ status: string }>(
      `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({}),
      },
    ),
};
