'use client';
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page">
      <h1>Something went wrong</h1>
      <p>Try again or return to the public entry page.</p>
      <button className="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
