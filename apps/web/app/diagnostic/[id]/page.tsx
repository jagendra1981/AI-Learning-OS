'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedGate } from '../../../components/route-gate';
import { Shell } from '../../../components/shell';
import { api, ApiError } from '../../../lib/api';

type Option =
  string | { id?: string; value?: string; label?: string; text?: string };
type Question = {
  diagnosticId?: string;
  sessionId?: string;
  placementId?: string;
  status?: string;
  question?: {
    questionId?: string;
    questionVersionId?: string;
    sequence?: number;
    progress?: { completed?: number; maximum?: number };
    stem?: string;
    options?: Option[];
  } | null;
};

export default function DiagnosticRun() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Question | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.question(id));
      setError('');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const submit = async () => {
    const q = data?.question;
    if (!q || !data.sessionId || !choice) return;
    setSubmitting(true);
    setError('');
    try {
      await api.answer(id, {
        sessionId: data.sessionId,
        placementId: String(data.placementId ?? ''),
        idempotencyKey: `${id}:${q.questionVersionId}:${Date.now()}`,
        selectedOption: choice,
        questionVersionId: q.questionVersionId,
      });
      await api.nextQuestion(id);
      await load();
    } catch (e) {
      const apiError = e as ApiError;
      if (apiError.status === 409) await load();
      else setError(apiError.message);
    } finally {
      setSubmitting(false);
    }
  };
  const finish = () => router.push(`/diagnostic/${id}/result`);
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page diagnostic-page">
          <p className="eyebrow">DIAGNOSTIC</p>
          <h1>Work through the question</h1>
          {busy && (
            <p role="status" aria-live="polite">
              Loading the current question…
            </p>
          )}
          {error && (
            <div className="status" role="alert">
              {error}
              <button className="link-button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {data?.question ? (
            <section className="card question" aria-labelledby="question-stem">
              <div className="progress" aria-label="Diagnostic progress">
                Question {(data.question.sequence ?? 0) + 1} of{' '}
                {data.question.progress?.maximum ?? '—'}
              </div>
              <h2 id="question-stem">{data.question.stem}</h2>
              <div
                className="options"
                role="radiogroup"
                aria-labelledby="question-stem"
              >
                {Array.isArray(data.question.options) &&
                  data.question.options.map((option, index) => {
                    const value =
                      typeof option === 'string'
                        ? option
                        : String(option.id ?? option.value ?? index);
                    const label =
                      typeof option === 'string'
                        ? option
                        : String(option.label ?? option.text ?? value);
                    return (
                      <label className="option" key={value}>
                        <input
                          type="radio"
                          name="answer"
                          value={value}
                          checked={choice === value}
                          onChange={() => setChoice(value)}
                        />
                        {label}
                      </label>
                    );
                  })}
              </div>
              <div className="actions">
                <button
                  className="button"
                  onClick={() => void submit()}
                  disabled={!choice || submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit answer'}
                </button>
                <button className="button secondary" onClick={finish}>
                  View result
                </button>
              </div>
            </section>
          ) : (
            data && (
              <section className="card">
                <h2>Diagnostic state: {data.status}</h2>
                <p className="muted">
                  The service has no question available right now. Refresh to
                  restore the authoritative state.
                </p>
                <div className="actions">
                  <button className="button" onClick={() => void load()}>
                    Refresh
                  </button>
                  <button className="button secondary" onClick={finish}>
                    View result
                  </button>
                </div>
              </section>
            )
          )}
        </div>
      </Shell>
    </ProtectedGate>
  );
}

