import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// CSRF protection for Rift API routes. Rejects cross-origin POSTs by comparing
// Origin/Referer against the request host.

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

export function middleware(request: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/rift/:path*'],
};
