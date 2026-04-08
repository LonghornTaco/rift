'use client';

import { Auth0Provider } from '@auth0/auth0-react';
import type { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export function RiftAuthProvider({ children }: AuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;

  if (!clientId || !domain) {
    return <div>Auth0 configuration missing. Set NEXT_PUBLIC_AUTH0_CLIENT_ID and NEXT_PUBLIC_AUTH0_DOMAIN.</div>;
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
      }}
    >
      {children}
    </Auth0Provider>
  );
}
