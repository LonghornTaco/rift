'use client';

import { useEffect, useRef, useState } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

function LoginFlow() {
  const { isAuthenticated, isLoading, loginWithRedirect, handleRedirectCallback, getAccessTokenSilently } = useAuth0();
  const handledRef = useRef(false);
  const [status, setStatus] = useState<'loading' | 'redirecting' | 'processing' | 'done' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isLoading || handledRef.current) return;

    const params = new URLSearchParams(window.location.search);

    // After Auth0 callback — process the code and relay the token
    if (params.has('code') && params.has('state')) {
      handledRef.current = true;
      setStatus('processing');

      handleRedirectCallback()
        .then(async (result) => {
          const nonce = result?.appState?.nonce;
          console.log('[Rift login-redirect] Callback processed, nonce:', nonce);

          if (!nonce) {
            console.error('[Rift login-redirect] No nonce in appState');
            setErrorMsg('Authentication succeeded but nonce was lost. Please try again.');
            setStatus('error');
            return;
          }

          const token = await getAccessTokenSilently();
          console.log('[Rift login-redirect] Got token, relaying...');

          const res = await fetch('/api/auth/token-relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce, token }),
          });
          console.log('[Rift login-redirect] Relay response:', res.status);
          setStatus('done');
        })
        .catch((err) => {
          console.error('[Rift login-redirect] Callback/relay failed:', err);
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus('error');
        });
      return;
    }

    // First visit — stash nonce in appState and redirect to Auth0
    if (!isAuthenticated) {
      handledRef.current = true;
      setStatus('redirecting');
      const nonce = params.get('nonce') ?? '';
      console.log('[Rift login-redirect] Starting login with nonce:', nonce);
      loginWithRedirect({
        appState: { nonce },
      });
    }
  }, [isLoading, isAuthenticated, loginWithRedirect, handleRedirectCallback, getAccessTokenSilently]);

  // Edge case: already authenticated (e.g. page refreshed after login)
  useEffect(() => {
    if (!isAuthenticated || status !== 'loading') return;
    setStatus('done');
  }, [isAuthenticated, status]);

  if (status === 'loading' || status === 'redirecting') {
    return <p style={{ padding: '2rem', fontFamily: 'system-ui' }}>Redirecting to sign-in…</p>;
  }

  if (status === 'processing') {
    return <p style={{ padding: '2rem', fontFamily: 'system-ui' }}>Completing sign-in…</p>;
  }

  if (status === 'error') {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#ef4444' }}>Sign-in error</h1>
        <p style={{ color: '#666' }}>{errorMsg}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Signed in successfully</h1>
      <p style={{ color: '#666' }}>
        Return to Rift in the Sitecore marketplace — the migration will start automatically.
        <br />
        You can close this tab.
      </p>
    </div>
  );
}

export default function LoginRedirectPage() {
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;

  if (!domain || !clientId) {
    return <p style={{ padding: '2rem', color: '#ef4444' }}>Auth0 not configured.</p>;
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
        scope: 'openid profile email',
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_BASE_URL}/auth/login-redirect`,
      }}
    >
      <LoginFlow />
    </Auth0Provider>
  );
}
