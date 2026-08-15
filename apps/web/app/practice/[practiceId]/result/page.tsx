/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { Shell } from '../../../../components/shell';
import { ProtectedGate } from '../../../../components/route-gate';
export default function PracticeResult() {
  const { practiceId } = useParams<{ practiceId: string }>();
  const [data, setData] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    void api
      .practice(practiceId)
      .then(setData)
      .catch(() => setData(null));
  }, [practiceId]);
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <p className="eyebrow">PRACTICE RESULT</p>
          <h1>Practice result</h1>
          <div className="card">
            {data ? (
              <dl className="facts">
                <dt>Status</dt>
                <dd>{data.status}</dd>
                <dt>Questions answered</dt>
                <dd>{data.questionCount ?? 0}</dd>
                <dt>Completion reason</dt>
                <dd>{data.stopReason ?? '—'}</dd>
              </dl>
            ) : (
              <p role="status">Loading result…</p>
            )}
          </div>
        </div>
      </Shell>
    </ProtectedGate>
  );
}

