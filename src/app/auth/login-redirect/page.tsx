'use client';

import { useEffect } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

// Last-resort login page opened in a new tab by the marketplace host.
// Runs as a top-level page (not in iframe), so Auth0 redirect works.
// After login, the refresh token is stored in localStorage. User closes
// this tab and retries migration in the marketplace iframe — the iframe
// picks up the refresh token from localStorage (same partition for
// the same top-level origin in subsequent visits, or unpartitioned if
// visited top-level first).

function LoginFlow() {
  const { isAuthenticated, isLoading, loginWithRedirect, handleRedirectCallback } = useAuth0();

  useEffect(() => {
    if (isLoading) return;

    const params = new URLSearchParams(window.location.search);
    if (params.has('code') && params.has('state')) {
      handleRedirectCallback().catch(console.error);
      return;
    }

    if (!isAuthenticated) {
      loginWithRedirect({
        appState: { returnTo: '/auth/login-redirect' },
      });
    }
  }, [isLoading, isAuthenticated, loginWithRedirect, handleRedirectCallback]);

  if (isLoading) {
    return <p style={{ padding: '2rem', fontFamily: 'system-ui' }}>Signing you in…</p>;
  }

  if (isAuthenticated) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Signed in successfully</h1>
        <p style={{ color: '#666' }}>
          You can close this tab and return to Rift in the Sitecore marketplace.
          <br />
          Click <strong>Start Migration</strong> again — it will work now.
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
