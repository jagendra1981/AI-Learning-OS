'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from '../../lib/api';
import { Action, Empty, ReadModelPage } from '../../components/c030-read-model';
export default function Mistakes() {
  return (
    <ReadModelPage
      title="Mistakes to revisit"
      intro="Learner-safe patterns that can guide your next practice."
      load={api.mistakes}
      render={(data, state) => {
        const items = data?.items ?? [];
        if (state === 'EMPTY' || !items.length)
          return <Empty>There are no active mistakes to review.</Empty>;
        return (
          <div className="stack">
            {items.map((item: any) => (
              <article className="card" key={item.mistakeId ?? item.mistakeKey}>
                <p className="eyebrow">{item.category ?? 'Review'}</p>
                <h2>{item.label ?? 'Practice opportunity'}</h2>
                {item.explanation && <p>{item.explanation}</p>}
                <p className="muted">
                  {item.severity ?? 'Review'} · seen {item.recurrence ?? 0}{' '}
                  times
                </p>
                <Action action={item.recoveryAction} />
              </article>
            ))}
          </div>
        );
      }}
    />
  );
}

