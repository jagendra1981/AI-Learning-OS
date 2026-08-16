'use client';
import { FormEvent, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/api';
import { GuestGate } from '../../components/route-gate';
export default function Reset() {
  const p = useSearchParams(),
    r = useRouter(),
    [password, setPassword] = useState(''),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.resetComplete(p.get('token') ?? '', password);
      r.replace('/login?reset=success');
    } catch (x) {
      setError((x as ApiError).message);
    }
  };
  return (
    <GuestGate>
      <div className="page">
        <h1>Choose a new password</h1>
        <form className="card form" onSubmit={submit}>
          <div className="status" role="status" aria-live="polite">
            {error}
          </div>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">Update password</button>
        </form>
      </div>
    </GuestGate>
  );
}
