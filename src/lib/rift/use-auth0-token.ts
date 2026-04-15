'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 650;
const POPUP_RETURN_TO = '/auth/popup-complete';
const POPUP_TIMEOUT_MS = 120_000; // 2 minutes to complete login before we give up

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
 * Opens a popup login flow (top-level window, escapes the Sitecore iframe),
 * awaits an access token via postMessage from the popup-complete page, and
 * stores it in React state. The token stays in memory only — a full refresh
 * requires re-signing-in.
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
      const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
      const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
      const features = `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},menubar=no,toolbar=no`;

      const popup = window.open(url, 'rift-auth-popup', features);
      if (!popup) {
        reject(new Error('Popup blocked — please allow popups for this site and try again'));
        return;
      }

      pendingRef.current = { resolve, reject };
      setState((prev) => ({ ...prev, isSigningIn: true, error: null }));

      const timeout = window.setTimeout(() => {
        if (pendingRef.current) {
          pendingRef.current.reject(new Error('Sign-in timed out'));
          pendingRef.current = null;
          setState((prev) => ({ ...prev, isSigningIn: false, error: 'Sign-in timed out' }));
          try {
            popup.close();
          } catch {
            // ignore — popup may already be closed or cross-origin
          }
        }
      }, POPUP_TIMEOUT_MS);

      const checkClosed = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(checkClosed);
          window.clearTimeout(timeout);
          // If the popup closed without posting a message, treat it as cancelled.
          if (pendingRef.current) {
            pendingRef.current.reject(new Error('Sign-in cancelled'));
            pendingRef.current = null;
            setState((prev) => ({ ...prev, isSigningIn: false, error: 'Sign-in cancelled' }));
          }
        }
      }, 500);
    });
  }, []);

  const clearToken = useCallback(() => {
    setState({ token: null, isSigningIn: false, error: null });
  }, []);

  return { ...state, signIn, clearToken };
}
