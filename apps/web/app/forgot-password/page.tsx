'use client';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { GuestGate } from '../../components/route-gate';
export default function Forgot() {
  const [email, setEmail] = useState(''),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.resetRequest(email);
      setDone(true);
    } catch (x) {
      setError((x as ApiError).message);
    }
  };
  return (
    <GuestGate>
      <div className="page">
        <h1>Reset your password</h1>
        {done ? (
          <p role="status">
            If an account exists, reset instructions will be sent.
          </p>
        ) : (
          <form className="card form" onSubmit={submit}>
            <div className="status" role="status" aria-live="polite">
              {error}
            </div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit">Send reset instructions</button>
          </form>
        )}
      </div>
    </GuestGate>
  );
}

