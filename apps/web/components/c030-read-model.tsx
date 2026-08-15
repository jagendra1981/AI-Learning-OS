'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { ProtectedGate } from './route-gate';
import { Shell } from './shell';

type Scope = { contextId: string; academicVersion: string };
type Envelope = { state?: string; data?: any; freshness?: { state?: string } };
export function learnerSafeAction(action: any) {
  return action?.href === '/practice' || action?.href === '/revision'
    ? action
    : null;
}
function State({
  state,
  error,
  retry,
}: {
  state: string;
  error?: ApiError | null;
  retry: () => void;
}) {
  if (state === 'LOADING')
    return (
      <p role="status" aria-live="polite">
        Loading your learning data…
      </p>
    );
  if (state === 'ERROR')
    return (
      <div role="alert">
        <p>{error?.message ?? 'We could not load this projection.'}</p>
        <button className="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return null;
}

export function ReadModelPage({
  title,
  intro,
  load,
  render,
}: {
  title: string;
  intro: string;
  load: (scope: Scope) => Promise<Envelope>;
  render: (data: any, state: string) => React.ReactNode;
}) {
  const [state, setState] = useState('LOADING');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const read = async () => {
    setState('LOADING');
    setError(null);
    try {
      const selected = await api.diagnosticEntry();
      const scope = {
        contextId: selected.examId,
        academicVersion: selected.academicVersionId,
      };
      const result = await load(scope);
      setData(result.data);
      setState(result.state ?? result.freshness?.state ?? 'UNAVAILABLE');
    } catch (caught) {
      setError(caught as ApiError);
      setState('ERROR');
    }
  };
  // The load function is a page contract and is intentionally invoked once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void read();
  }, []);
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <p className="eyebrow">LEARNER VIEW</p>
          <h1>{title}</h1>
          <p className="muted">{intro}</p>
          <State state={state} error={error} retry={() => void read()} />
          {state !== 'LOADING' && state !== 'ERROR' && render(data, state)}
        </div>
      </Shell>
    </ProtectedGate>
  );
}

export function Action({ action }: { action: any }) {
  const safe = learnerSafeAction(action);
  return safe?.href ? (
    <Link className="button" href={safe.href}>
      {safe.label ?? 'Open'}
    </Link>
  ) : null;
}
export function Empty({
  children = 'Nothing is available here yet.',
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="card" role="status">
      <h2>Nothing to show</h2>
      <p>{children}</p>
    </div>
  );
}

