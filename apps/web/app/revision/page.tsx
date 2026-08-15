'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from '../../lib/api';
import { Action, Empty, ReadModelPage } from '../../components/c030-read-model';
export default function Revision() {
  return (
    <ReadModelPage
      title="Revision"
      intro="Review sessions scheduled by the revision engine."
      load={api.revisions}
      render={(data, state) => {
        const items = data?.items ?? [];
        if (state === 'EMPTY' || !items.length)
          return <Empty>There is no revision scheduled right now.</Empty>;
        return (
          <div className="stack">
            {items.map((item: any) => (
              <article className="card" key={item.itemId ?? item.revisionKey}>
                <p className="result-state">{item.state ?? 'SCHEDULED'}</p>
                <h2>{item.title ?? item.concept?.label ?? 'Revision item'}</h2>
                {item.reason && <p>{item.reason}</p>}
                <p className="muted">{item.dueStatus ?? 'Scheduled'}</p>
                <Action action={item.action} />
              </article>
            ))}
          </div>
        );
      }}
    />
  );
}

