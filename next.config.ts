import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  pageExtensions: ['ts', 'tsx', 'js', 'jsx'],
  allowedDevOrigins: ['local.marketplace.mcc.mayo.edu'],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self' https:",
            "frame-ancestors https://*.sitecorecloud.io",
          ].join('; '),
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
      ],
    },
  ],
};

export default nextConfig;
