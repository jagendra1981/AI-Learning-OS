'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, safePath, ApiError } from '../lib/api';
import { useSession } from '../lib/session';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!email || password.length < 12) {
      setError('Enter a valid email and a password of at least 12 characters.');
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, password });
      const readiness = await signIn(result.user);
      if (readiness === 'ONBOARDING_REQUIRED') {
        router.replace('/onboarding');
      } else if (readiness === 'READY') {
        router.replace(
          mode === 'login' ? safePath(params.get('returnTo')) : '/dashboard',
        );
      }
    } catch (caught) {
      setError((caught as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <div id="auth-error" className="status" role="status" aria-live="polite">
        {error}
      </div>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        aria-describedby={error ? 'auth-error' : undefined}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        aria-describedby={error ? 'auth-error' : undefined}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={12}
      />
      <button disabled={busy} type="submit">
        {busy ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {mode === 'login' ? (
        <p>
          <a href="/forgot-password">Forgot your password?</a>
        </p>
      ) : (
        <p>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      )}
    </form>
  );
}

