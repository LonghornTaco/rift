import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates that a cmUrl points to a legitimate SitecoreAI host.
 * Prevents SSRF by enforcing an allowlist of permitted URL patterns.
 */
const CM_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.sitecorecloud\.io\/?$/i;

export function validateCmUrl(cmUrl: string): string | null {
  if (!CM_URL_PATTERN.test(cmUrl)) {
    return 'Invalid cmUrl: must be a valid SitecoreAI URL (https://*.sitecorecloud.io)';
  }
  return null;
}

/**
 * Validates a Sitecore item path to prevent injection.
 * Allows alphanumeric characters, spaces, hyphens, underscores, forward slashes, and parentheses.
 */
const ITEM_PATH_PATTERN = /^\/[a-zA-Z0-9\s\-_\/()]+$/;

export function validateItemPath(itemPath: string): string | null {
  if (!ITEM_PATH_PATTERN.test(itemPath)) {
    return 'Invalid path format';
  }
  return null;
}

/**
 * Strips internal details from error messages before sending to clients.
 * Logs the full error server-side for debugging.
 */
export function sanitizeError(context: string, err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[Rift ${context}]`, message);
  return NextResponse.json(
    { error: `${context} failed` },
    { status: 502 }
  );
}

/**
 * Creates a generic error response for upstream failures without leaking details.
 */
export function upstreamError(context: string, status: number, errorText: string): NextResponse {
  console.error(`[Rift ${context}] Upstream ${status}:`, errorText);
  return NextResponse.json(
    { error: `${context} failed` },
    { status: status >= 400 && status < 500 ? status : 502 }
  );
}

/**
 * Simple in-memory sliding window rate limiter.
 * Tracks request timestamps per key (e.g., IP address).
 */
const rateLimitStore = new Map<string, number[]>();

export function rateLimit(
  key: string,
  windowMs: number = 60_000,
  maxRequests: number = 10
): boolean {
  const now = Date.now();
  const timestamps = rateLimitStore.get(key) ?? [];

  // Remove timestamps outside the window
  const recent = timestamps.filter((t) => now - t < windowMs);

  if (recent.length >= maxRequests) {
    rateLimitStore.set(key, recent);
    return false; // rate limited
  }

  recent.push(now);
  rateLimitStore.set(key, recent);
  return true; // allowed
}

/**
 * Extracts a client identifier from the request for rate limiting.
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
