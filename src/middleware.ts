import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF protection middleware for all /api/rift/* routes.
 * Validates that requests originate from the same site by checking
 * the Origin or Referer header against the request's host.
 *
 * Structured log output for access control decisions (denied requests).
 */

function logDeny(route: string, clientIp: string, reason: string) {
  // Structured JSON log — cannot import from @/lib in middleware (edge runtime),
  // so we inline the log format here.
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
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const clientIp = getClientIp(request);
  const route = request.nextUrl.pathname;

  // Allow requests with no origin/referer (e.g., server-to-server, curl in dev)
  // In production, browsers always send Origin on POST requests
  if (!origin && !referer) {
    return NextResponse.next();
  }

  // Validate origin matches host
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        logDeny(route, clientIp, `Origin mismatch: ${originHost} != ${host}`);
        return NextResponse.json(
          { error: 'Forbidden: cross-origin request' },
          { status: 403 }
        );
      }
    } catch {
      logDeny(route, clientIp, 'Invalid origin header');
      return NextResponse.json(
        { error: 'Forbidden: invalid origin' },
        { status: 403 }
      );
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        logDeny(route, clientIp, `Referer mismatch: ${refererHost} != ${host}`);
        return NextResponse.json(
          { error: 'Forbidden: cross-origin request' },
          { status: 403 }
        );
      }
    } catch {
      logDeny(route, clientIp, 'Invalid referer header');
      return NextResponse.json(
        { error: 'Forbidden: invalid referer' },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/rift/:path*',
};
