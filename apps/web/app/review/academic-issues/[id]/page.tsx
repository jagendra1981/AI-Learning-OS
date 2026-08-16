'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedGate } from '../../../../components/route-gate';
import { Shell } from '../../../../components/shell';
import { hasReviewerAdminAccess, useSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api';

function AcademicIssueReviewContent() {
  const { user } = useSession();
  const allowed = hasReviewerAdminAccess(user);
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.academicIssueReview>> | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'ERROR' | 'ACTIONING'>('LOADING');
  const [error, setError] = useState<ApiError | null>(null);

  const load = () => {
    setState('LOADING');
    setError(null);
    void api.academicIssueReview(id).then((value) => {
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

  const resolve = () => {
    setState('ACTIONING');
    setError(null);
    void api.resolveAcademicIssue(id).then(() => load()).catch((caught: ApiError) => {
      setError(caught);
      setState('READY');
    });
  };

  if (!allowed) return null;
  return (
    <Shell>
      <div className="page">
        <p><a href="/review">Back to review queue</a></p>
        <h1>Academic issue review</h1>
        {state === 'LOADING' && <p role="status">Loading academic issue...</p>}
        {state === 'ERROR' && <div className="card"><p>{error?.message ?? 'Academic issue review is unavailable.'}</p><button className="button" onClick={load}>Try again</button></div>}
        {detail && (state === 'READY' || state === 'ACTIONING') && (
          <>
            <div className="card">
              <p className="muted">{detail.itemType} · {detail.sourceType}</p>
              <h2>Status: {detail.status}</h2>
              <p>{detail.summary}</p>
              <p>Academic context: {detail.context.examId} / {detail.context.subjectId}</p>
              <p>Created: {new Date(detail.createdAt).toLocaleString()}</p>
              <p>Updated: {new Date(detail.updatedAt).toLocaleString()}</p>
            </div>
            {detail.status === 'OPEN' && <button className="button" disabled={state === 'ACTIONING'} onClick={resolve}>Resolve issue</button>}
            {detail.status !== 'OPEN' && <p role="status">This academic issue is already resolved.</p>}
            {error && <p role="alert">{error.message}</p>}
          </>
        )}
      </div>
    </Shell>
  );
}

export default function AcademicIssueReviewPage() {
  return <ProtectedGate ready><AcademicIssueReviewContent /></ProtectedGate>;
}
