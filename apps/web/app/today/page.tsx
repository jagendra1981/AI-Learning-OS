'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Action, Empty, ReadModelPage } from '../../components/c030-read-model';
export default function Today() {
  const [nba, setNba] = useState<any>(null);
  useEffect(() => {
    void api
      .diagnosticEntry()
      .then((s) =>
        api.recommendation({
          contextId: s.examId,
          academicVersion: s.academicVersionId,
        }),
      )
      .then((r) => setNba(r.data))
      .catch(() => setNba(null));
  }, []);
  return (
    <ReadModelPage
      title="Today"
      intro="Your next learning steps, composed by the learning system."
      load={(scope) =>
        api.today({
          ...scope,
          planDateLocal: new Date().toISOString().slice(0, 10),
        })
      }
      render={(data, state) => {
        if (state === 'EMPTY' || !data) return <Empty />;
        const items = data.items ?? data.todayItems ?? [];
        return (
          <>
            <div className="card">
              <p className="result-state">{state}</p>
              <h2>{data.headline ?? 'Your learning plan'}</h2>
              <ul className="clean-list">
                {items.map((item: any) => (
                  <li key={item.itemKey ?? item.itemId}>
                    <strong>{item.title ?? 'Learning activity'}</strong>
                    <Action action={item.action} />
                  </li>
                ))}
              </ul>
              {items.length === 0 && (
                <Empty>Today has no planned activities.</Empty>
              )}
            </div>
            {nba?.actionType && (
              <section className="card" aria-labelledby="nba-title">
                <p className="eyebrow">NEXT BEST ACTION</p>
                <h2 id="nba-title">{nba.title}</h2>
                {nba.reason && <p>{nba.reason}</p>}
                <Action action={nba.action} />
              </section>
            )}
          </>
        );
      }}
    />
  );
}

