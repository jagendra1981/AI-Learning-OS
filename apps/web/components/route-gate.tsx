'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '../lib/session';

export function GuestGate({ children }: { children: React.ReactNode }) {
  const { state, error, refresh, routeIntent } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (routeIntent === 'RESTORE' && state === 'READY')
      router.replace('/dashboard');
    if (routeIntent === 'RESTORE' && state === 'ONBOARDING_REQUIRED')
      router.replace('/onboarding');
  }, [routeIntent, router, state]);
  if (
    state === 'UNKNOWN' ||
    state === 'CHECKING_SESSION' ||
    state === 'AUTHENTICATED'
  )
    return (
      <p className="page" role="status">
        Checking your session...
      </p>
    );
  if (state === 'AUTH_ERROR')
    return (
      <div className="page">
        <h1>We could not restore your session</h1>
        <p>{error?.message}</p>
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (state === 'READY' || state === 'ONBOARDING_REQUIRED') return null;
  return <>{children}</>;
}

export function PublicGate({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state === 'READY') router.replace('/dashboard');
  }, [router, state]);
  if (state === 'READY') return null;
  return <>{children}</>;
}

export function ProtectedGate({
  children,
  ready = false,
}: {
  children: React.ReactNode;
  ready?: boolean;
}) {
  const { state, error, refresh, routeIntent } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (
      (state === 'UNAUTHENTICATED' || state === 'SESSION_EXPIRED') &&
      routeIntent !== 'SIGN_OUT'
    )
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    else if (ready && state === 'ONBOARDING_REQUIRED')
      router.replace('/onboarding');
  }, [pathname, ready, routeIntent, router, state]);
  if (
    state === 'UNKNOWN' ||
    state === 'CHECKING_SESSION' ||
    state === 'AUTHENTICATED'
  )
    return (
      <div className="page">
        <p role="status">Checking your session...</p>
      </div>
    );
  if (state === 'AUTH_ERROR')
    return (
      <div className="page">
        <h1>We could not restore your session</h1>
        <p>{error?.message}</p>
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (
    state === 'UNAUTHENTICATED' ||
    state === 'SESSION_EXPIRED' ||
    (ready && state !== 'READY')
  )
    return null;
  return <>{children}</>;
}

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { state, error, refresh } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state === 'UNAUTHENTICATED' || state === 'SESSION_EXPIRED')
      router.replace('/login?returnTo=%2Fonboarding');
    else if (state === 'READY') router.replace('/dashboard');
  }, [router, state]);
  if (
    state === 'UNKNOWN' ||
    state === 'CHECKING_SESSION' ||
    state === 'AUTHENTICATED'
  )
    return (
      <div className="page">
        <p role="status">Preparing onboarding...</p>
      </div>
    );
  if (state === 'AUTH_ERROR')
    return (
      <div className="page">
        <h1>We could not confirm your readiness</h1>
        <p>{error?.message}</p>
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (state !== 'ONBOARDING_REQUIRED') return null;
  return <>{children}</>;
}

