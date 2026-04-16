'use client';

import { useEffect, useRef } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

function LoginFlow() {
  const { isAuthenticated, isLoading, loginWithRedirect, handleRedirectCallback, getAccessTokenSilently } = useAuth0();
  const relayedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const params = new URLSearchParams(window.location.search);
    if (params.has('code') && params.has('state')) {
      handleRedirectCallback().catch(console.error);
      return;
    }

    if (!isAuthenticated) {
      loginWithRedirect({
        appState: { returnTo: window.location.pathname + window.location.search },
      });
    }
  }, [isLoading, isAuthenticated, loginWithRedirect, handleRedirectCallback]);

  useEffect(() => {
    if (!isAuthenticated || relayedRef.current) return;
    relayedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const nonce = params.get('nonce');
    if (!nonce) return;

    getAccessTokenSilently().then((token) => {
      fetch('/api/auth/token-relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, token }),
      }).catch(console.error);
    }).catch(console.error);
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isLoading) {
    return <p style={{ padding: '2rem', fontFamily: 'system-ui' }}>Signing you in…</p>;
  }

  if (isAuthenticated) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Signed in successfully</h1>
        <p style={{ color: '#666' }}>
          Return to Rift in the Sitecore marketplace and click <strong>Start Migration</strong> again.
          <br />
          You can close this tab.
        </p>
      </div>
    );
  }

  return <p style={{ padding: '2rem', fontFamily: 'system-ui' }}>Redirecting to sign-in…</p>;
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
      useRefreshTokens={true}
      cacheLocation="localstorage"
      authorizationParams={{
        audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
        scope: process.env.NEXT_PUBLIC_AUTH0_SCOPE ?? 'openid profile email offline_access',
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_BASE_URL}/auth/login-redirect`,
      }}
    >
      <LoginFlow />
    </Auth0Provider>
  );
}
