import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';

/**
 * Middleware: Auth0 session handling + CSRF protection for API routes.
 *
 * - /auth/* routes are handled by the Auth0 SDK (login, callback, logout)
 * - /api/rift/* routes get CSRF origin validation
 * - All other matched routes pass through Auth0 middleware for session refresh
 */

function logDeny(route: string, clientIp: string, reason: string) {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'WARN',
    event: 'access_control',
    route,
    clientIp,
    decision: 'deny',
    reason,
  }));
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function middleware(request: NextRequest) {
  // Auth0 SDK handles /auth/* routes (login, callback, logout, etc.)
  // and refreshes session cookies on all matched routes
  const authResponse = await auth0.middleware(request);

  // For /auth/* routes, return the Auth0 response directly
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    return authResponse;
  }

  // CSRF protection for /api/rift/* routes
  if (request.nextUrl.pathname.startsWith('/api/rift/')) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const host = request.headers.get('host');
    const clientIp = getClientIp(request);
    const route = request.nextUrl.pathname;

    if (origin || referer) {
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            logDeny(route, clientIp, `Origin mismatch: ${originHost} != ${host}`);
            return NextResponse.json({ error: 'Forbidden: cross-origin request' }, { status: 403 });
          }
        } catch {
          logDeny(route, clientIp, 'Invalid origin header');
          return NextResponse.json({ error: 'Forbidden: invalid origin' }, { status: 403 });
        }
      } else if (referer) {
        try {
          const refererHost = new URL(referer).host;
          if (refererHost !== host) {
            logDeny(route, clientIp, `Referer mismatch: ${refererHost} != ${host}`);
            return NextResponse.json({ error: 'Forbidden: cross-origin request' }, { status: 403 });
          }
        } catch {
          logDeny(route, clientIp, 'Invalid referer header');
          return NextResponse.json({ error: 'Forbidden: invalid referer' }, { status: 403 });
        }
      }
    }
  }

  return authResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|rift-logo.svg).*)',
  ],
};
