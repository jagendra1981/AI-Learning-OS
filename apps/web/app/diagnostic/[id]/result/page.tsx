'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ProtectedGate } from '../../../../components/route-gate';
import { Shell } from '../../../../components/shell';
import { api, ApiError } from '../../../../lib/api';

export default function DiagnosticResult() {
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await api.result(id));
      setError('');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const status = result?.status as string | undefined;
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <p className="eyebrow">DIAGNOSTIC RESULT</p>
          <h1>Your diagnostic result</h1>
          {loading && (
            <p role="status" aria-live="polite">
              Loading your result…
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
          {result && (
            <section className="card result" aria-live="polite">
              <p className="result-state">{status}</p>
              {status === 'PENDING' && (
                <p>
                  The diagnostic is still being scored. Check again shortly.
                </p>
              )}
              {status === 'PROVISIONAL' && (
                <p>
                  Your learner-safe result is ready. Downstream learning
                  projection is still processing.
                </p>
              )}
              {status === 'UNAVAILABLE' && (
                <p>
                  We cannot safely display the result yet. Please try again
                  later.
                </p>
              )}
              {status === 'COMPLETED' && (
                <>
                  <p>Your result is complete.</p>
                  <dl className="facts">
                    {[
                      ['Score', result.score],
                      ['Maximum score', result.maximumScore],
                      [
                        'Percentage',
                        result.percentage == null
                          ? null
                          : `${String(result.percentage)}%`,
                      ],
                      ['Correct', result.correctCount],
                      ['Incorrect', result.incorrectCount],
                      ['Unanswered', result.unansweredCount],
                    ].map(([label, value]) =>
                      value == null ? null : (
                        <div key={String(label)}>
                          <dt>{String(label)}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                </>
              )}
              {result.projectionStatus != null && (
                <p className="muted">
                  Projection status: {String(result.projectionStatus)}
                </p>
              )}
              <button className="button" onClick={() => void load()}>
                Refresh result
              </button>
            </section>
          )}
        </div>
      </Shell>
    </ProtectedGate>
  );
}

