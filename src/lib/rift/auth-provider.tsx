'use client';

import {
  Auth0Provider,
  type Auth0ContextInterface,
  type GetTokenSilentlyOptions,
  useAuth0,
} from '@auth0/auth0-react';
import type { ReactNode } from 'react';

export function RiftAuthProvider({ children }: { children: ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;

  if (!domain || !clientId) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444' }}>
        Auth0 configuration missing — set NEXT_PUBLIC_AUTH0_DOMAIN and NEXT_PUBLIC_AUTH0_CLIENT_ID.
      </div>
    );
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        organization_id: process.env.NEXT_PUBLIC_SITECORE_ORGANIZATION_ID,
        tenant_id: process.env.NEXT_PUBLIC_SITECORE_TENANT_ID,
        product_codes: process.env.NEXT_PUBLIC_SITECORE_APP_ID
          ? `mkp_${process.env.NEXT_PUBLIC_SITECORE_APP_ID}`
          : undefined,
        audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
        redirect_uri: process.env.NEXT_PUBLIC_APP_BASE_URL,
        scope: 'openid profile email',
      }}
    >
      {children}
    </Auth0Provider>
  );
}

export function useAuth(): Auth0ContextInterface {
  const { getAccessTokenSilently, ...rest } = useAuth0();

  const wrappedGetAccessTokenSilently = (options?: GetTokenSilentlyOptions) => {
    return getAccessTokenSilently({
      ...options,
      authorizationParams: {
        ...options?.authorizationParams,
        organization_id: process.env.NEXT_PUBLIC_SITECORE_ORGANIZATION_ID,
        tenant_id: process.env.NEXT_PUBLIC_SITECORE_TENANT_ID,
      },
    });
  };

  return {
    ...rest,
    getAccessTokenSilently: wrappedGetAccessTokenSilently as Auth0ContextInterface['getAccessTokenSilently'],
  };
}
