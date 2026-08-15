'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingGate } from '../../components/route-gate';
import { useSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api';

type Profile = { targetExamId?: string | null; targetYear?: number | null };

export default function Onboarding() {
  const { refresh } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [consents, setConsents] = useState<
    Awaited<ReturnType<typeof api.consents>>
  >([]);
  const [examId, setExamId] = useState('');
  const [year, setYear] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const [nextProfile, nextConsents] = await Promise.all([
        api.profile(),
        api.consents(),
      ]);
      const p = (nextProfile ?? {}) as Profile;
      setProfile(p);
      setExamId(String(p.targetExamId ?? ''));
      setYear(p.targetYear ? String(p.targetYear) : '');
      setConsents(nextConsents);
      setAccepted(nextConsents.some((c) => c.state === 'GRANTED'));
    } catch (caught) {
      setError((caught as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.updateProfile({
        targetExamId: examId.trim(),
        targetYear: Number(year),
      });
      await api.goal({ examId: examId.trim(), targetYear: Number(year) });
      if (!accepted)
        throw { message: 'Accept the required consent to continue.' };
      const current = consents.find((c) => c.state === 'GRANTED');
      if (!current) {
        // The frozen server definition is enforced by C007; the UI submits
        // only the approved contract values and never uses a client readiness flag.
        await api.consent({ consentType: 'LEARNING', policyVersion: 'C027' });
      }
      await api.finalizeOnboarding();
      const readiness = await refresh();
      if (readiness === 'READY') router.replace('/diagnostic');
      else await load();
    } catch (caught) {
      setError(
        (caught as ApiError).message ?? 'Please complete the required steps.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingGate>
      <main id="main" className="page">
        <p className="eyebrow">ONBOARDING</p>
        <h1>Set up your learning workspace</h1>
        <p className="muted">
          Your server profile controls when diagnostic access becomes available.
        </p>
        {busy ? (
          <p role="status" aria-live="polite">
            Loading your onboarding details…
          </p>
        ) : (
          <form
            className="card form"
            onSubmit={submit}
            aria-describedby="onboarding-status"
          >
            <div
              id="onboarding-status"
              className="status"
              role="status"
              aria-live="polite"
            >
              {error}
            </div>
            <label htmlFor="exam">Exam or goal</label>
            <input
              id="exam"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              required
              autoComplete="off"
            />
            <label htmlFor="year">Target year</label>
            <input
              id="year"
              type="number"
              min="2024"
              max="2100"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            />
            <label className="check-row" htmlFor="consent">
              <input
                id="consent"
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>I agree to the learning terms.</span>
            </label>
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save and continue'}
            </button>
            <p className="muted small">
              Current profile:{' '}
              {profile.targetExamId
                ? `${profile.targetExamId} / ${profile.targetYear}`
                : 'not configured'}
            </p>
          </form>
        )}
      </main>
    </OnboardingGate>
  );
}

