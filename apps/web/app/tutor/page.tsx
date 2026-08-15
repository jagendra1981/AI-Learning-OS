'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ProtectedGate } from '../../components/route-gate';
import { Shell } from '../../components/shell';
import {
  ApiError,
  api,
  LearnerAttachment,
  TutorIntent,
  TutorStreamEvent,
} from '../../lib/api';
import { openTutorStream, TutorStreamConnection } from '../../lib/tutor-stream';
import { useSession } from '../../lib/session';

type Lifecycle =
  | 'READY'
  | 'SUBMITTING'
  | 'STREAMING'
  | 'CANCELLING'
  | 'COMPLETE'
  | 'UNCERTAIN'
  | 'REFUSED'
  | 'RESTRICTED'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'CANCELLED';

type Turn = {
  id: string;
  role: 'learner' | 'tutor';
  text: string;
  assistance?: string;
  status?: Lifecycle;
  incomplete?: boolean;
};

type RetryRequest = { message: string; intent: TutorIntent };
type AttachmentState =
  'PREPARING' | 'UPLOADING' | 'READY' | 'REJECTED' | 'FAILED' | 'EXPIRED';
type SelectedAttachment = {
  file: File;
  state: AttachmentState;
  attachment?: LearnerAttachment;
  attachmentId?: string;
  message?: string;
};

const intents: Array<{ value: TutorIntent; label: string }> = [
  { value: 'ASK_DOUBT', label: 'Ask a doubt' },
  { value: 'EXPLAIN', label: 'Explain' },
  { value: 'HINT', label: 'Give me a hint' },
  { value: 'STRONGER_HINT', label: 'Stronger hint' },
  { value: 'WORKED_EXAMPLE', label: 'Worked example' },
  { value: 'DEBUG', label: 'Help me debug' },
  { value: 'RECOMMEND_NEXT', label: 'What should I do next?' },
];

const terminalEvents = new Set([
  'COMPLETED',
  'CANCELLED',
  'INTERRUPTED',
  'REFUSED',
  'RESTRICTED',
  'FAILED',
]);

export default function TutorPage() {
  const { user } = useSession();
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<TutorIntent>('ASK_DOUBT');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [lifecycle, setLifecycle] = useState<Lifecycle>('READY');
  const [activeInteractionId, setActiveInteractionId] = useState<string>();
  const [retryable, setRetryable] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest>();
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<SelectedAttachment>();
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<TutorStreamConnection>();
  const terminal = useRef(false);

  const busy = ['SUBMITTING', 'STREAMING', 'CANCELLING'].includes(lifecycle);

  useEffect(() => () => stream.current?.close(), []);

  async function start(request: RetryRequest, showLearnerTurn = true) {
    if (busy || !user?.sessionId) return;
    if (attachment?.state === 'READY' && attachment.attachmentId) {
      try {
        const current = await api.readAttachment(attachment.attachmentId);
        if (current.status !== 'AVAILABLE') {
          setAttachment({
            ...attachment,
            state: 'EXPIRED',
            message:
              'This attachment is no longer available. Remove it or choose another file.',
          });
          setError(
            'This attachment is no longer available. Remove it or choose another file.',
          );
          return;
        }
      } catch {
        setAttachment({
          ...attachment,
          state: 'EXPIRED',
          message:
            'This attachment is no longer available. Remove it or choose another file.',
        });
        setError(
          'This attachment is no longer available. Remove it or choose another file.',
        );
        return;
      }
    }
    const tutorTurnId = window.crypto.randomUUID();
    setLifecycle('SUBMITTING');
    terminal.current = false;
    setRetryable(false);
    setRetryRequest(request);
    setError(null);
    setTurns((current) => [
      ...current,
      ...(showLearnerTurn
        ? [
            {
              id: window.crypto.randomUUID(),
              role: 'learner' as const,
              text: request.message,
            },
          ]
        : []),
      { id: tutorTurnId, role: 'tutor', text: '', status: 'SUBMITTING' },
    ]);
    try {
      const accepted = await api.tutorInteraction({
        sessionId: user.sessionId,
        message: request.message,
        intent: request.intent,
        ...(attachment?.state === 'READY' && attachment.attachmentId
          ? { attachmentIds: [attachment.attachmentId] }
          : {}),
        clientRequestId: window.crypto.randomUUID(),
      });
      if (accepted.status !== 'ACCEPTED')
        throw { status: 502, message: 'The Tutor response was unavailable.' };
      setActiveInteractionId(accepted.interactionId);
      setTurns((current) =>
        current.map((turn) =>
          turn.id === tutorTurnId
            ? { ...turn, assistance: accepted.assistance }
            : turn,
        ),
      );
      stream.current = openTutorStream(
        accepted.interactionId,
        (event) => handleEvent(tutorTurnId, event),
        () => handleTransportError(tutorTurnId),
      );
    } catch (caught) {
      const apiError = caught as ApiError;
      setLifecycle('FAILED');
      setError(apiError.message);
      setTurns((current) => current.filter((turn) => turn.id !== tutorTurnId));
    }
  }

  function handleEvent(tutorTurnId: string, event: TutorStreamEvent) {
    if (terminalEvents.has(event.type)) {
      terminal.current = true;
      stream.current?.close();
    }
    if (event.type === 'STARTED') {
      setLifecycle('STREAMING');
      updateTutorTurn(tutorTurnId, { status: 'STREAMING' });
      return;
    }
    if (event.type === 'DELTA') {
      setLifecycle('STREAMING');
      setTurns((current) =>
        current.map((turn) =>
          turn.id === tutorTurnId
            ? {
                ...turn,
                text: `${turn.text}${event.text}`,
                status: 'STREAMING',
              }
            : turn,
        ),
      );
      return;
    }
    if (event.type === 'COMPLETED') {
      setLifecycle('COMPLETE');
      setRetryable(false);
      updateTutorTurn(tutorTurnId, { status: 'COMPLETE', incomplete: false });
      return;
    }
    if (event.type === 'UNCERTAINTY') {
      setLifecycle('UNCERTAIN');
      updateTutorTurn(tutorTurnId, {
        status: 'UNCERTAIN',
        text: event.message ?? uncertaintyMessage(event.state),
      });
      return;
    }
    if (event.type === 'REFUSED' || event.type === 'RESTRICTED') {
      const status = event.type === 'REFUSED' ? 'REFUSED' : 'RESTRICTED';
      setLifecycle(status);
      updateTutorTurn(tutorTurnId, { status, text: event.message });
      return;
    }
    if (event.type === 'CANCELLED') {
      setLifecycle('CANCELLED');
      setRetryable(false);
      setTurns((current) =>
        current.map((turn) =>
          turn.id === tutorTurnId
            ? {
                ...turn,
                status: 'CANCELLED',
                incomplete: true,
                text: turn.text || 'Response cancelled.',
              }
            : turn,
        ),
      );
      return;
    }
    const status = event.type === 'INTERRUPTED' ? 'INTERRUPTED' : 'FAILED';
    setLifecycle(status);
    setRetryable(event.retryable);
    setTurns((current) =>
      current.map((turn) =>
        turn.id === tutorTurnId
          ? {
              ...turn,
              status,
              incomplete: true,
              text: turn.text || event.message,
            }
          : turn,
      ),
    );
    setError(event.message);
  }

  function handleTransportError(tutorTurnId: string) {
    if (terminal.current) return;
    terminal.current = true;
    setLifecycle('INTERRUPTED');
    setRetryable(false);
    setError('The connection was interrupted. The response may be incomplete.');
    updateTutorTurn(tutorTurnId, {
      status: 'INTERRUPTED',
      incomplete: true,
    });
  }

  function updateTutorTurn(tutorTurnId: string, patch: Partial<Turn>) {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === tutorTurnId ? { ...turn, ...patch } : turn,
      ),
    );
  }

  async function cancel() {
    if (!activeInteractionId || lifecycle !== 'STREAMING') return;
    setLifecycle('CANCELLING');
    setError(null);
    try {
      await api.cancelTutorInteraction(activeInteractionId);
    } catch (caught) {
      setLifecycle('STREAMING');
      setError((caught as ApiError).message);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || busy || (attachment && attachment.state !== 'READY'))
      return;
    setMessage('');
    void start({ message: trimmed, intent });
  }

  async function selectAttachment(file?: File) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setAttachment({
        file,
        state: 'REJECTED',
        message: 'Choose a JPEG, PNG, or WebP image up to 10 MB.',
      });
      return;
    }
    setAttachment({ file, state: 'PREPARING' });
    try {
      const prepared = await api.prepareAttachment({
        purpose: 'TUTOR_IMAGE',
        originalFilename: file.name,
        declaredMimeType: file.type,
        sizeBytes: file.size,
        idempotencyKey: window.crypto.randomUUID(),
      });
      setAttachment((current) =>
        current
          ? {
              ...current,
              state: 'UPLOADING',
              attachmentId: prepared.attachmentId,
            }
          : current,
      );
      await api.uploadAttachment(
        prepared.uploadUrl,
        prepared.method,
        prepared.requiredHeaders,
        file,
      );
      const completed = await api.completeAttachment(prepared.attachmentId);
      if (completed.status !== 'AVAILABLE')
        throw { message: 'This attachment is not ready to use.' };
      setAttachment({
        file,
        state: 'READY',
        attachmentId: completed.attachmentId,
        attachment: completed,
      });
    } catch (caught) {
      const apiError = caught as ApiError;
      setAttachment((current) =>
        current
          ? {
              ...current,
              state: 'FAILED',
              message:
                apiError.message ?? 'The attachment could not be uploaded.',
            }
          : current,
      );
    }
  }

  async function removeAttachment() {
    const id = attachment?.attachmentId;
    setAttachment(undefined);
    if (id) {
      try {
        await api.deleteAttachment(id);
      } catch {
        /* removal remains learner-safe locally */
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  function retry() {
    if (!retryable || !retryRequest || busy) return;
    void start(retryRequest, false);
  }

  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page tutor-page">
          <p className="eyebrow">LEARN WITH GUIDANCE</p>
          <h1>Tutor</h1>
          <p className="tutor-intro">
            Ask a question, share where you are stuck, or choose a kind of help.
          </p>

          <section
            className="tutor-card"
            aria-labelledby="tutor-conversation-heading"
          >
            <h2 id="tutor-conversation-heading">Your learning conversation</h2>
            {turns.length === 0 ? (
              <div className="tutor-empty" role="status">
                <p className="tutor-empty-title">
                  What would you like to work through?
                </p>
                <p className="muted">
                  The Tutor can help you make progress while keeping you in
                  control of the next step.
                </p>
              </div>
            ) : (
              <div className="conversation" aria-label="Tutor conversation">
                {turns.map((turn) => (
                  <article className={`turn turn-${turn.role}`} key={turn.id}>
                    <p className="turn-role">
                      {turn.role === 'learner' ? 'You' : 'Tutor'}
                    </p>
                    {turn.text ? (
                      <p className="turn-text">{turn.text}</p>
                    ) : null}
                    {turn.status === 'SUBMITTING' ? (
                      <p className="muted">Preparing response…</p>
                    ) : null}
                    {turn.incomplete ? (
                      <p className="stream-incomplete">Incomplete response</p>
                    ) : null}
                    {turn.role === 'tutor' && turn.assistance ? (
                      <p className="muted small">
                        {turn.assistance.replaceAll('_', ' ').toLowerCase()} ·{' '}
                        {turn.status?.toLowerCase()}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}

            <div className="intent-group" aria-label="Tutor help options">
              <p className="intent-label">Choose a kind of help</p>
              <div className="intent-controls">
                {intents.map((option) => (
                  <button
                    className={
                      intent === option.value ? 'intent selected' : 'intent'
                    }
                    type="button"
                    aria-pressed={intent === option.value}
                    key={option.value}
                    onClick={() => setIntent(option.value)}
                    disabled={busy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tutor-status" aria-live="polite" aria-atomic="true">
              {statusMessage(lifecycle)}
            </div>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

            {(lifecycle === 'STREAMING' || lifecycle === 'CANCELLING') && (
              <button
                className="button secondary"
                type="button"
                onClick={() => void cancel()}
                disabled={lifecycle === 'CANCELLING'}
              >
                {lifecycle === 'CANCELLING' ? 'Cancelling…' : 'Cancel response'}
              </button>
            )}
            {retryable ? (
              <button
                className="button secondary"
                type="button"
                onClick={retry}
                disabled={busy}
              >
                Retry
              </button>
            ) : null}

            <div className="tutor-attachment">
              <input
                ref={fileInput}
                id="tutor-attachment"
                type="file"
                aria-label="Attach an image"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  void selectAttachment(event.target.files?.[0])
                }
                disabled={
                  busy ||
                  (!!attachment &&
                    ['PREPARING', 'UPLOADING'].includes(attachment.state))
                }
              />
              {attachment ? (
                <div role="status" aria-live="polite">
                  <span>{attachment.file.name}</span>
                  {attachment.state === 'READY' ? (
                    <span> · Ready to attach</span>
                  ) : null}
                  {attachment.state === 'PREPARING' ? (
                    <span> · Preparing…</span>
                  ) : null}
                  {attachment.state === 'UPLOADING' ? (
                    <span> · Uploading…</span>
                  ) : null}
                  {attachment.state === 'REJECTED' ||
                  attachment.state === 'FAILED' ||
                  attachment.state === 'EXPIRED' ? (
                    <span className="error"> · {attachment.message}</span>
                  ) : null}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void removeAttachment()}
                    disabled={busy}
                  >
                    Remove attachment
                  </button>
                </div>
              ) : null}
            </div>

            <form className="tutor-composer" onSubmit={submit}>
              <label htmlFor="tutor-message">Your question</label>
              <textarea
                id="tutor-message"
                name="message"
                value={message}
                maxLength={2000}
                rows={4}
                placeholder="For example: Explain Python loops"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={busy}
              />
              <div className="composer-footer">
                <span className="muted small">{message.length}/2000</span>
                <button
                  className="button"
                  type="submit"
                  disabled={!message.trim() || busy || !user?.sessionId}
                >
                  {lifecycle === 'SUBMITTING' ? 'Sending…' : 'Send to Tutor'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </Shell>
    </ProtectedGate>
  );
}

function statusMessage(lifecycle: Lifecycle) {
  const messages: Record<Lifecycle, string> = {
    READY: '',
    SUBMITTING: 'Sending your question to the Tutor.',
    STREAMING: 'Tutor response in progress.',
    CANCELLING: 'Cancellation requested. Waiting for confirmation.',
    COMPLETE: 'Tutor response complete.',
    UNCERTAIN: 'The Tutor needs more context.',
    REFUSED: 'The Tutor could not provide that assistance.',
    RESTRICTED: 'Tutor assistance is limited for this activity.',
    INTERRUPTED: 'Tutor response interrupted.',
    FAILED: 'Tutor response failed.',
    CANCELLED: 'Tutor response cancelled.',
  };
  return messages[lifecycle];
}

function uncertaintyMessage(state: string) {
  const messages: Record<string, string> = {
    NEEDS_CONTEXT: 'Please share a little more context so the Tutor can help.',
    AMBIGUOUS: 'Please clarify which part of the question you mean.',
    INSUFFICIENT_EVIDENCE:
      'The Tutor does not have enough learning context yet.',
    AI_UNAVAILABLE: 'The Tutor is temporarily unavailable.',
    NONE: '',
  };
  return messages[state] ?? 'The Tutor needs more context.';
}

