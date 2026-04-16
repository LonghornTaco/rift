import type { NextConfig } from 'next';

const allowedParentDomains = [
  'https://marketplace-app.sitecorecloud.io',
  'https://pages.sitecorecloud.io',
  'https://xmapps.sitecorecloud.io',
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [],
  pageExtensions: ['ts', 'tsx', 'js', 'jsx'],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: `frame-ancestors 'self' ${allowedParentDomains.join(' ')}`,
        },
      ],
    },
  ],
};

export default nextConfig;
