'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from '../../lib/api';
import { Empty, ReadModelPage } from '../../components/c030-read-model';
export default function Progress() {
  return (
    <ReadModelPage
      title="Progress"
      intro="A server-composed view of your learning progress."
      load={api.progress}
      render={(data, state) => {
        if (state === 'EMPTY' || !data) return <Empty />;
        const subjects = data.subjects ?? [];
        return (
          <div className="card">
            <p className="result-state">{state}</p>
            <p className="progress-summary">
              {data.overallProgressPercent}% overall progress
              {data.overallBand ? ` · ${data.overallBand}` : ''}
            </p>
            <progress
              value={data.overallProgressPercent}
              max="100"
              aria-label="Overall progress"
            />
            {subjects.length > 0 && (
              <table>
                <caption>Progress by subject</caption>
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Band</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((s: any) => (
                    <tr key={s.subjectId}>
                      <th scope="row">{s.subjectLabel}</th>
                      <td>{s.progressPercent}%</td>
                      <td>{s.band ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              {data.eligibleConceptCount} of {data.totalConceptCount} concepts
              included.
            </p>
          </div>
        );
      }}
    />
  );
}

