'use client';

import { Auth0Provider } from '@auth0/nextjs-auth0';
import type { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export function RiftAuthProvider({ children }: AuthProviderProps) {
  return <Auth0Provider>{children}</Auth0Provider>;
}
