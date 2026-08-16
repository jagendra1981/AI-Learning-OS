'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedGate } from '../../../../components/route-gate';
import { Shell } from '../../../../components/shell';
import { hasReviewerAdminAccess, useSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api';

function ConfigurationReviewContent() {
  const { user } = useSession();
  const allowed = hasReviewerAdminAccess(user);
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.configurationReview>> | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'ERROR' | 'ACTIONING'>('LOADING');
  const [error, setError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState('');

  const load = () => {
    setState('LOADING');
    setError(null);
    void api.configurationReview(id).then((value) => {
      setDetail(value);
      setState('READY');
    }).catch((caught: ApiError) => {
      setError(caught);
      setState('ERROR');
    });
  };

  useEffect(() => {
    if (!allowed) router.replace('/forbidden');
    else load();
  }, [allowed, id, router]);

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    if (!reason.trim()) {
      setError({ status: 400, message: 'A review reason is required.' });
      return;
    }
    setState('ACTIONING');
    setError(null);
    void api.reviewConfiguration(id, decision, reason.trim()).then(() => load()).catch((caught: ApiError) => {
      setError(caught);
      setState('READY');
    });
  };

  if (!allowed) return null;
  return (
    <Shell>
      <div className="page">
        <p><a href="/review">Back to review queue</a></p>
        <h1>Configuration review</h1>
        {state === 'LOADING' && <p role="status">Loading configuration review...</p>}
        {state === 'ERROR' && <div className="card"><p>{error?.message ?? 'Configuration review is unavailable.'}</p><button className="button" onClick={load}>Try again</button></div>}
        {detail && (state === 'READY' || state === 'ACTIONING') && (
          <>
            <div className="card">
              <p className="muted">Configuration version {detail.versionNumber}</p>
              <h2>Status: {detail.status}</h2>
              <p>Academic context: {detail.context.examId} / {detail.context.subjectId}</p>
              <p>Created: {new Date(detail.createdAt).toLocaleString()}</p>
              <p>Pending changes: {detail.changeCount}</p>
              <p>Configuration values are protected and are not displayed here.</p>
            </div>
            {detail.status === 'APPROVED' && (
              <div className="card">
                <label htmlFor="configuration-reason">Review reason</label>
                <textarea id="configuration-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                {error && <p role="alert">{error.message}</p>}
                <button className="button" disabled={state === 'ACTIONING'} onClick={() => decide('APPROVED')}>Approve</button>
                <button className="button secondary" disabled={state === 'ACTIONING'} onClick={() => decide('REJECTED')}>Reject</button>
              </div>
            )}
            {detail.status !== 'APPROVED' && <p role="status">This configuration is no longer awaiting review.</p>}
          </>
        )}
      </div>
    </Shell>
  );
}

export default function ConfigurationReviewPage() {
  return <ProtectedGate ready><ConfigurationReviewContent /></ProtectedGate>;
}
