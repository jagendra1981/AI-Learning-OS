'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedGate } from '../../../../components/route-gate';
import { Shell } from '../../../../components/shell';
import { hasReviewerAdminAccess, useSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api';

function QuestionReviewContent() {
  const { user } = useSession();
  const allowed = hasReviewerAdminAccess(user);
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.questionReview>> | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'ERROR' | 'ACTIONING'>('LOADING');
  const [error, setError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState('');

  const load = () => {
    setState('LOADING');
    setError(null);
    void api.questionReview(id).then((value) => {
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

  const act = (action: 'approve' | 'reject') => {
    if (!reason.trim()) {
      setError({ status: 400, message: 'A review reason is required.' });
      return;
    }
    setState('ACTIONING');
    setError(null);
    void api.reviewQuestion(id, action, reason.trim()).then(() => load()).catch((caught: ApiError) => {
      setError(caught);
      setState('READY');
    });
  };

  if (!allowed) return null;
  return (
    <Shell>
      <div className="page">
        <p><a href="/review">Back to review queue</a></p>
        <h1>Question review</h1>
        {state === 'LOADING' && <p role="status">Loading question review...</p>}
        {state === 'ERROR' && <div className="card"><p>{error?.message ?? 'Question review is unavailable.'}</p><button className="button" onClick={load}>Try again</button></div>}
        {detail && (state === 'READY' || state === 'ACTIONING') && (
          <>
            <div className="card">
              <p className="muted">{detail.questionType}</p>
              <h2>Status: {detail.status}</h2>
              <p>{typeof detail.stem === 'string' ? detail.stem : JSON.stringify(detail.stem)}</p>
              {detail.options != null && <pre>{String(JSON.stringify(detail.options))}</pre>}
              <p>Academic context: {detail.context.examId} / {detail.context.subjectId}</p>
              <p>Created: {new Date(detail.createdAt).toLocaleString()}</p>
              <p>Source verification: {detail.source?.verificationStatus ?? 'Unavailable'}</p>
              <p>Answer and solution ready: {detail.hasAnswer && detail.hasSolution ? 'Yes' : 'No'}</p>
            </div>
            {detail.status === 'IN_REVIEW' && (
              <div className="card">
                <label htmlFor="reason">Review reason</label>
                <textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                {error && <p role="alert">{error.message}</p>}
                <button className="button" disabled={state === 'ACTIONING'} onClick={() => act('approve')}>Approve</button>
                <button className="button secondary" disabled={state === 'ACTIONING'} onClick={() => act('reject')}>Reject</button>
              </div>
            )}
            {detail.status !== 'IN_REVIEW' && <p role="status">This question is no longer awaiting review.</p>}
          </>
        )}
      </div>
    </Shell>
  );
}

export default function QuestionReviewPage() {
  return <ProtectedGate ready><QuestionReviewContent /></ProtectedGate>;
}
