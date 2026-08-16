'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasReviewerAdminAccess, useSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api';
import { ProtectedGate } from '../../components/route-gate';
import { Shell } from '../../components/shell';

function ReviewAccess() {
  const { user } = useSession();
  const router = useRouter();
  const allowed = hasReviewerAdminAccess(user);
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.reviewQueue>>['items']>([]);
  const [status, setStatus] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [error, setError] = useState<ApiError | null>(null);

  const load = () => {
    setStatus('LOADING');
    setError(null);
    void api.reviewQueue().then((result) => {
      setItems(result.items);
      setStatus('READY');
    }).catch((caught: ApiError) => {
      setError(caught);
      setStatus('ERROR');
    });
  };

  useEffect(() => {
    if (!allowed) router.replace('/forbidden');
    else load();
  }, [allowed, router]);

  if (!allowed) return null;
  return (
    <Shell>
      <div className="page">
        <p className="muted">Reviewer workspace</p>
        <h1>Review</h1>
        {status === 'LOADING' && <p role="status">Loading review queue...</p>}
        {status === 'ERROR' && (
          <div className="card">
            <p>{error?.message ?? 'The review queue is unavailable.'}</p>
            <button className="button" onClick={load}>Try again</button>
          </div>
        )}
        {status === 'READY' && items.length === 0 && (
          <div className="card"><p>No items need review.</p></div>
        )}
        {status === 'READY' && items.length > 0 && (
          <div className="review-list" aria-label="Review queue">
            {items.map((item, index) => (
              <article className="card" key={`${item.itemType}-${item.createdAt}-${index}`}>
                <p className="muted">{item.itemType}</p>
                {item.itemType === 'QUESTION' ? (
                  <h2><a href={`/review/questions/${item.itemId}`}>{item.title}</a></h2>
                ) : item.itemType === 'CONFIGURATION' ? (
                  <h2><a href={`/review/configuration/${item.itemId}`}>{item.title}</a></h2>
                ) : <h2><a href={`/review/academic-issues/${item.itemId}`}>{item.title}</a></h2>}
                <p>Status: {item.status}</p>
                <p>Academic context: {item.context.examId} / {item.context.subjectId}</p>
                {item.actionNeeded && <p>Action needed</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function ReviewPage() {
  return (
    <ProtectedGate ready>
      <ReviewAccess />
    </ProtectedGate>
  );
}
