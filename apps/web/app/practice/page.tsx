'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '../../components/shell';
import { ProtectedGate } from '../../components/route-gate';
import { api, ApiError } from '../../lib/api';
import { useRouter } from 'next/navigation';

export default function PracticeEntry() {
  const router = useRouter();
  const [state, setState] = useState<'LOADING' | 'ERROR' | 'UNAVAILABLE'>(
    'LOADING',
  );
  const [message, setMessage] = useState(
    'Finding your next authorized practice.',
  );
  useEffect(() => {
    let active = true;
    void api
      .practiceAcquire()
      .then((result) => {
        if (!active) return;
        if (
          (result.status === 'ACQUIRED' || result.status === 'CONTINUE') &&
          result.practiceSessionId
        ) {
          router.replace(
            `/practice/${encodeURIComponent(result.practiceSessionId)}`,
          );
          return;
        }
        setState(
          result.status === 'UNAVAILABLE' || result.status === 'NOT_ELIGIBLE'
            ? result.status
            : 'UNAVAILABLE',
        );
        setMessage(
          result.reasonCode === 'ASSESSMENT_UNAVAILABLE'
            ? 'Practice is not available yet.'
            : 'No authorized practice is available right now.',
        );
      })
      .catch((error: ApiError) => {
        if (!active) return;
        setState('ERROR');
        setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <p className="eyebrow">PRACTICE</p>
          <h1>Practice</h1>
          <div className="card">
            <h2>
              {state === 'LOADING'
                ? 'Preparing practice'
                : state === 'ERROR'
                  ? 'Practice could not be opened'
                  : 'Practice unavailable'}
            </h2>
            <p className="muted" role="status">
              {message}
            </p>
            {state !== 'LOADING' && (
              <Link className="button" href="/dashboard">
                Return to dashboard
              </Link>
            )}
          </div>
        </div>
      </Shell>
    </ProtectedGate>
  );
}

