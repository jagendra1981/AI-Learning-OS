/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { Shell } from '../../../components/shell';
import { ProtectedGate } from '../../../components/route-gate';

type State = Record<string, any>;
const safeText = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'object' && value
      ? JSON.stringify(value)
      : '';

export default function PracticeSession() {
  const { practiceId } = useParams<{ practiceId: string }>();
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [question, setQuestion] = useState<State | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<State | null>(null);
  const [hint, setHint] = useState<State | null>(null);
  const [solution, setSolution] = useState<State | null>(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const requestRef = useRef(false);
  const load = useCallback(async () => {
    setPending('Loading practice…');
    setError(null);
    try {
      const current = await api.practice(practiceId);
      setState(current);
      if (current.status === 'COMPLETED' || current.status === 'STOPPED') {
        setQuestion(null);
        return;
      }
      const next = await api.practiceNext(practiceId);
      setQuestion(next);
      setHint(next.hintState?.state === 'AVAILABLE' ? null : next.hintState);
      setFeedback(null);
    } catch (caught) {
      const e = caught as ApiError;
      if (e.status === 401)
        router.push(
          `/login?returnTo=${encodeURIComponent(`/practice/${practiceId}`)}`,
        );
      setError(e);
    } finally {
      setPending('');
    }
  }, [practiceId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  const submit = async () => {
    if (!question?.question || selected === null || requestRef.current) return;
    requestRef.current = true;
    setPending('Submitting response…');
    setError(null);
    try {
      const result = await api.practiceRespond(practiceId, {
        sessionId: state?.assessmentSessionId,
        placementId: question.question.placementId,
        questionVersionId: question.question.questionVersionId,
        selectedOption: selected,
        idempotencyKey: `${practiceId}:${question.question.placementId}:${question.question.questionVersionId}`,
      });
      setFeedback(result.feedback ?? result);
      setState(await api.practice(practiceId));
      setQuestion(null);
    } catch (caught) {
      const e = caught as ApiError;
      setError(e);
      if ([409, 422].includes(e.status)) await load();
    } finally {
      requestRef.current = false;
      setPending('');
    }
  };
  const action = async (name: string, fn: () => Promise<State>) => {
    if (requestRef.current) return;
    requestRef.current = true;
    setPending(name);
    setError(null);
    try {
      const result = await fn();
      if (name === 'Requesting hint…') setHint(result);
      else if (name === 'Retrying…') setQuestion(result);
      else if (name === 'Continuing…') {
        setQuestion(result);
        setFeedback(null);
        setSelected(null);
      } else setState(result);
    } catch (caught) {
      setError(caught as ApiError);
      await load();
    } finally {
      requestRef.current = false;
      setPending('');
    }
  };
  const q = question?.question;
  const terminal = state?.status === 'COMPLETED' || state?.status === 'STOPPED';
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page practice-page">
          <p className="eyebrow">PRACTICE</p>
          <h1>Focused practice</h1>
          <div role="status" aria-live="polite" className="status">
            {pending || error?.message || ''}
          </div>
          {terminal ? (
            <div className="card">
              <h2>Practice complete</h2>
              <p>Your practice session is no longer accepting responses.</p>
              <button
                className="button"
                onClick={() => router.push(`/practice/${practiceId}/result`)}
              >
                View result
              </button>
            </div>
          ) : q ? (
            <div className="card question-card">
              <div
                className="progress"
                aria-label={`Progress: ${question.progress?.answered ?? state?.questionCount ?? 0} questions answered`}
              >
                Progress:{' '}
                {question.progress?.answered ?? state?.questionCount ?? 0} /{' '}
                {question.progress?.maximum ?? 20}
              </div>
              <h2>{safeText(q.stem)}</h2>
              {q.questionType === 'MULTIPLE_CHOICE' &&
              Array.isArray(q.options) ? (
                <fieldset className="options">
                  <legend>Choose one answer</legend>
                  {q.options.map((option: any) => (
                    <label className="option" key={option.id}>
                      <input
                        type="radio"
                        name="answer"
                        value={option.id}
                        checked={selected === option.id}
                        onChange={() => setSelected(option.id)}
                      />{' '}
                      <span>
                        {safeText(
                          option.label ?? option.text ?? option.content,
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p role="alert">
                  This question type is not supported by the current practice
                  input.
                </p>
              )}
              <div className="actions">
                <button
                  className="button"
                  disabled={
                    pending !== '' ||
                    selected === null ||
                    q.questionType !== 'MULTIPLE_CHOICE'
                  }
                  onClick={() => void submit()}
                >
                  Submit answer
                </button>
                {question.hintState?.state === 'AVAILABLE' && (
                  <button
                    className="button secondary"
                    disabled={pending !== ''}
                    onClick={() =>
                      void action('Requesting hint…', () =>
                        api.practiceHint(practiceId),
                      )
                    }
                  >
                    Hint
                  </button>
                )}
                <button
                  className="link-button"
                  disabled={pending !== ''}
                  onClick={() =>
                    void action('Stopping…', () => api.practiceStop(practiceId))
                  }
                >
                  Exit
                </button>
              </div>
            </div>
          ) : feedback ? (
            <div className="card" tabIndex={-1}>
              <h2>Feedback</h2>
              <p className="result-state">
                {feedback.correctness ?? 'Response received'}
              </p>
              {feedback.score !== undefined && (
                <p>Credit awarded: {String(feedback.score)}</p>
              )}
              <div className="actions">
                {state?.retryAvailable && (
                  <button
                    className="button"
                    onClick={() =>
                      void action('Retrying…', () =>
                        api.practiceRetry(practiceId),
                      )
                    }
                  >
                    Retry
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() =>
                    void action('Continuing…', () =>
                      api.practiceNext(practiceId),
                    )
                  }
                >
                  Continue
                </button>
                <button
                  className="link-button"
                  onClick={async () =>
                    setSolution(await api.practiceSolution(practiceId))
                  }
                >
                  View solution
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <p>Loading the current question…</p>
            </div>
          )}
          {hint?.hint && (
            <aside className="card" aria-label="Hint">
              <h2>Hint</h2>
              <p>{safeText(hint.hint)}</p>
            </aside>
          )}
          {solution && (
            <aside className="card" aria-label="Solution">
              <h2>Solution</h2>
              {solution.solutionStatus === 'LOCKED' && (
                <p>Solution is not available yet.</p>
              )}
              {solution.solutionStatus === 'UNAVAILABLE' && (
                <p>Solution is unavailable for this item.</p>
              )}
              {solution.solutionStatus === 'AVAILABLE' && (
                <>
                  <p>{safeText(solution.explanation)}</p>
                  <p>{safeText(solution.correctAnswer)}</p>
                </>
              )}
            </aside>
          )}
        </div>
      </Shell>
    </ProtectedGate>
  );
}
