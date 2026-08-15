'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiError } from './api';

export type SessionState =
  | 'UNKNOWN'
  | 'CHECKING_SESSION'
  | 'UNAUTHENTICATED'
  | 'AUTHENTICATED'
  | 'ONBOARDING_REQUIRED'
  | 'READY'
  | 'SESSION_EXPIRED'
  | 'AUTH_ERROR';

export function resolveReadiness(state: unknown): SessionState {
  if (state === 'READY_FOR_DIAGNOSTIC') return 'READY';
  if (
    state === 'NOT_STARTED' ||
    state === 'PROFILE_IN_PROGRESS' ||
    state === 'CONSENT_REQUIRED'
  )
    return 'ONBOARDING_REQUIRED';
  return 'AUTH_ERROR';
}

export const REVIEWER_ADMIN_ROLES = [
  'CONTENT_REVIEWER',
  'ACADEMIC_ADMIN',
  'PLATFORM_ADMIN',
] as const;
type User = {
  userId: string;
  sessionId?: string;
  email?: string;
  roles?: string[];
};
export type RouteIntent = 'RESTORE' | 'SIGN_IN' | 'SIGN_OUT';
type Session = {
  state: SessionState;
  user: User | null;
  routeIntent: RouteIntent;
  refresh: () => Promise<SessionState>;
  signIn: (user: User) => Promise<SessionState>;
  signOut: () => Promise<void>;
  error: ApiError | null;
};

const Context = createContext<Session | null>(null);
const invalidReadiness: ApiError = {
  status: 502,
  code: 'INVALID_READINESS',
  message: 'We could not confirm your account readiness. Please try again.',
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>('UNKNOWN');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [routeIntent, setRouteIntent] = useState<RouteIntent>('RESTORE');

  const resolve = useCallback(async () => {
    setState('AUTHENTICATED');
    const result = resolveReadiness((await api.onboarding()).state);
    if (result === 'AUTH_ERROR') {
      setError(invalidReadiness);
      setState('AUTH_ERROR');
      return result;
    }
    setState(result);
    return result;
  }, []);

  const refresh = useCallback(async () => {
    setRouteIntent('RESTORE');
    setState('CHECKING_SESSION');
    setError(null);
    try {
      const me = await api.me();
      setUser(me);
      return await resolve();
    } catch (caught) {
      const apiError = caught as ApiError;
      setUser(null);
      if (apiError.status === 401) {
        setState('UNAUTHENTICATED');
        return 'UNAUTHENTICATED';
      }
      setState('AUTH_ERROR');
      setError(apiError);
      return 'AUTH_ERROR';
    }
  }, [resolve]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (nextUser: User) => {
      setRouteIntent('SIGN_IN');
      setUser(nextUser);
      setError(null);
      try {
        return await resolve();
      } catch (caught) {
        const apiError = caught as ApiError;
        setState(apiError.status === 401 ? 'SESSION_EXPIRED' : 'AUTH_ERROR');
        setError(apiError);
        return apiError.status === 401 ? 'SESSION_EXPIRED' : 'AUTH_ERROR';
      }
    },
    [resolve],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch (caught) {
      if ((caught as ApiError).status !== 401) throw caught;
    }
    setUser(null);
    setError(null);
    setRouteIntent('SIGN_OUT');
    setState('UNAUTHENTICATED');
  }, []);

  const value = useMemo(
    () => ({ state, user, routeIntent, refresh, signIn, signOut, error }),
    [state, user, routeIntent, refresh, signIn, signOut, error],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}

export function hasReviewerAdminAccess(user: User | null) {
  return Boolean(
    user?.roles?.some((role) =>
      (REVIEWER_ADMIN_ROLES as readonly string[]).includes(role),
    ),
  );
}

