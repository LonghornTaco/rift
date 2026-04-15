'use client';

import { useCallback, useEffect, useState } from 'react';

interface AuthState {
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Manages the Sitecore access token used for Content Transfer API calls.
 *
 * Strategy: full-page navigation inside the Sitecore marketplace iframe.
 * window.open is blocked (iframe sandbox has no allow-popups), so we can't
 * use a popup flow. Instead:
 *
 *   1. On mount, GET /api/auth/me — if an Auth0 session cookie exists, this
 *      returns the XMC access token and we cache it in state.
 *   2. signIn() navigates window.location to /auth/login?returnTo=/rift,
 *      which reloads the iframe through Auth0 and back to /rift. The next
 *      page load picks up the new session via step 1.
 *
 * The token is held in memory only; a full refresh rehydrates via /api/auth/me.
 */
export function useAuth0Token() {
  const [state, setState] = useState<AuthState>({ token: null, isLoading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { token: string | null };
          setState({ token: data.token, isLoading: false, error: null });
        } else {
          setState({ token: null, isLoading: false, error: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          token: null,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback((): Promise<string> => {
    // Full-page navigation inside the iframe. This resolves never (we're
    // redirecting away), but returning a pending promise keeps the caller's
    // UI in its "signing in" state until the browser actually navigates.
    const returnTo = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/rift';
    window.location.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    return new Promise<string>(() => {
      /* never resolves — the tab is navigating away */
    });
  }, []);

  const clearToken = useCallback(() => {
    setState({ token: null, isLoading: false, error: null });
  }, []);

  return { ...state, signIn, clearToken };
}
