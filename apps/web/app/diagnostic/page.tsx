'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedGate } from '../../components/route-gate';
import { Shell } from '../../components/shell';
import { api, ApiError } from '../../lib/api';

type Scope = Awaited<ReturnType<typeof api.diagnosticEntry>>;

export default function DiagnosticEntry() {
  const router = useRouter();
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    void api
      .diagnosticEntry()
      .then(setScope)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const start = async () => {
    if (!scope) return;
    setStarting(true);
    setError('');
    try {
      const run = await api.acquireDiagnostic(scope);
      router.push(`/diagnostic/${run.diagnosticRunId}`);
    } catch (e) {
      setError((e as ApiError).message);
      setStarting(false);
    }
  };
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <p className="eyebrow">DIAGNOSTIC</p>
          <h1>Begin your diagnostic</h1>
          {loading && (
            <p role="status" aria-live="polite">
              Preparing your authorized entry…
            </p>
          )}
          {error && (
            <div className="status" role="alert">
              {error}
              <button className="link-button" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          )}
          {scope && (
            <section className="card" aria-labelledby="scope-title">
              <h2 id="scope-title">Ready to begin</h2>
              <p className="muted">
                Your diagnostic scope is selected by the learning service.
              </p>
              <dl className="facts">
                <dt>Exam</dt>
                <dd>{scope.examId}</dd>
                <dt>Subject</dt>
                <dd>{scope.subjectId}</dd>
              </dl>
              <button
                className="button"
                onClick={() => void start()}
                disabled={starting}
              >
                {starting ? 'Starting…' : 'Start diagnostic'}
              </button>
            </section>
          )}
        </div>
      </Shell>
    </ProtectedGate>
  );
}

