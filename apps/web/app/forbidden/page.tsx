import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="page">
      <h1>Access unavailable</h1>
      <p>You do not have access to this area.</p>
      <Link className="button" href="/dashboard">
        Return to dashboard
      </Link>
    </main>
  );
}

