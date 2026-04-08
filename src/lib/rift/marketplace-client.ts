'use client';

import { useState, useEffect, useRef } from 'react';
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { ApplicationContext } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import type { RiftEnvironment } from './types';

interface MarketplaceState {
  client: ClientSDK | null;
  appContext: ApplicationContext | null;
  environments: RiftEnvironment[];
  isInitialized: boolean;
  error: string | null;
}

export function useMarketplaceClient(): MarketplaceState {
  const [state, setState] = useState<MarketplaceState>({
    client: null,
    appContext: null,
    environments: [],
    isInitialized: false,
    error: null,
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        const client = await ClientSDK.init({
          target: window.parent,
          modules: [XMC],
        });

        const contextResult = await client.query('application.context');
        const appContext = contextResult.data ?? null;

        const environments: RiftEnvironment[] = (appContext?.resourceAccess ?? [])
          .filter(r => r.resourceId === 'xmcloud')
          .map(r => ({
            tenantId: r.tenantId,
            tenantDisplayName: r.tenantDisplayName ?? r.tenantName ?? r.tenantId,
            contextId: r.context.preview,
          }));

        setState({
          client,
          appContext,
          environments,
          isInitialized: true,
          error: null,
        });
      } catch (err) {
        setState(prev => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to initialize Marketplace SDK',
          isInitialized: true,
        }));
      }
    }

    init();
  }, []);

  return state;
}
