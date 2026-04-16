'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POPUP_RETURN_TO = '/auth/popup-complete';
const POPUP_TIMEOUT_MS = 120_000;

interface AuthState {
  token: string | null;
  isSigningIn: boolean;
  error: string | null;
}

interface SignInMessage {
  type: 'rift-auth-token' | 'rift-auth-error';
  token?: string;
  error?: string;
}

/**
 * Popup-based Auth0 login. Earlier attempts used a features string on
 * window.open which may have tripped Firefox's parameter validation inside
 * the Sitecore marketplace iframe sandbox. This version calls window.open
 * with only a URL + target — the minimal signature — and lets the browser
 * pick default sizing. If the iframe sandbox allows popups at all, this
 * should open.
 */
export function useAuth0Token() {
  const [state, setState] = useState<AuthState>({ token: null, isSigningIn: false, error: null });
  const pendingRef = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<SignInMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || (data.type !== 'rift-auth-token' && data.type !== 'rift-auth-error')) return;

      const pending = pendingRef.current;
      pendingRef.current = null;

      if (data.type === 'rift-auth-token' && data.token) {
        setState({ token: data.token, isSigningIn: false, error: null });
        pending?.resolve(data.token);
      } else {
        const message = data.error ?? 'Login failed';
        setState((prev) => ({ ...prev, isSigningIn: false, error: message }));
        pending?.reject(new Error(message));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const signIn = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      if (pendingRef.current) {
        reject(new Error('Sign-in already in progress'));
        return;
      }

      const url = `/auth/login?returnTo=${encodeURIComponent(POPUP_RETURN_TO)}`;

      let popup: Window | null;
      try {
        // Minimal args — URL + target only. No features string.
        popup = window.open(url, 'rift-auth-popup');
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (!popup) {
        reject(new Error('Popup blocked — please allow popups for this site and try again'));
        return;
      }

      pendingRef.current = { resolve, reject };
      setState((prev) => ({ ...prev, isSigningIn: true, error: null }));

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.clearInterval(checkClosed);
      };

      const timeout = window.setTimeout(() => {
        if (pendingRef.current) {
          pendingRef.current.reject(new Error('Sign-in timed out'));
          pendingRef.current = null;
          setState((prev) => ({ ...prev, isSigningIn: false, error: 'Sign-in timed out' }));
        }
        cleanup();
      }, POPUP_TIMEOUT_MS);

      const checkClosed = window.setInterval(() => {
        let closed = false;
        try {
          closed = popup!.closed;
        } catch {
          // Accessing .closed on a cross-origin window can throw in some
          // sandbox configurations — treat as still open until timeout.
          return;
        }
        if (closed) {
          if (pendingRef.current) {
            pendingRef.current.reject(new Error('Sign-in cancelled'));
            pendingRef.current = null;
            setState((prev) => ({ ...prev, isSigningIn: false, error: 'Sign-in cancelled' }));
          }
          cleanup();
        }
      }, 500);
    });
  }, []);

  const clearToken = useCallback(() => {
    setState({ token: null, isSigningIn: false, error: null });
  }, []);

  return { ...state, signIn, clearToken };
}
