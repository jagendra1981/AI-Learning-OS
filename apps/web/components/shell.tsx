'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { hasReviewerAdminAccess, useSession } from '../lib/session';
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    router = useRouter(),
    { signOut, user } = useSession(),
    [open, setOpen] = useState(false);
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <header className="header">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">N</span>
          <span>AI Learning<span className="brand-sub"> OS</span></span>
        </Link>
        <button
          className="menu"
          type="button"
          aria-expanded={open}
          aria-controls="nav"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
        <nav
          id="nav"
          className={open ? 'nav open' : 'nav'}
          aria-label="Primary"
        >
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/dashboard' ? 'page' : undefined}
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/today' ? 'page' : undefined}
            href="/today"
          >
            Today
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/progress' ? 'page' : undefined}
            href="/progress"
          >
            Progress
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/mistakes' ? 'page' : undefined}
            href="/mistakes"
          >
            Mistakes
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/revision' ? 'page' : undefined}
            href="/revision"
          >
            Revision
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/tutor' ? 'page' : undefined}
            href="/tutor"
          >
            Tutor
          </Link>
          <Link onClick={() => setOpen(false)} className="nav-primary"
            aria-current={path === '/profile' ? 'page' : undefined}
            href="/profile"
          >
            Profile
          </Link>
          {hasReviewerAdminAccess(user) && (
            <Link onClick={() => setOpen(false)}
              aria-current={path === '/review' ? 'page' : undefined}
              href="/review"
            >
              Review
            </Link>
          )}
          <button
            onClick={async () => {
              await signOut();
              router.push('/login');
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
