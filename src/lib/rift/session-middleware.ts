import { NextRequest, NextResponse } from 'next/server';
import { getSession, touchSession, type Session } from './session-store';

const SESSION_COOKIE = 'rift_session';

export type SessionResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/**
 * Extract and validate session from request cookie.
 * On success, extends the session TTL (sliding window).
 * On failure, returns a 401 response.
 */
export async function withSession(request: NextRequest): Promise<SessionResult> {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookieValue) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'session_missing', message: 'No session found. Please connect an environment.' },
        { status: 401 }
      ),
    };
  }

  // Cookie format: sessionId
  const session = await getSession(cookieValue);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'session_expired', message: 'Session expired. Please reconnect.' },
        { status: 401 }
      ),
    };
  }

  // Sliding window: extend TTL on every successful access
  await touchSession(cookieValue);

  return { ok: true, session };
}

/**
 * Look up a session by envId from a specific session cookie value.
 * Used by migrate route which needs two sessions (source + target).
 */
export async function getSessionForEnv(
  sessionMap: Map<string, string>,
  envId: string
): Promise<{ session: Session } | { error: NextResponse }> {
  const sessionId = sessionMap.get(envId);
  if (!sessionId) {
    return {
      error: NextResponse.json(
        { error: 'session_expired', envId, message: `No session for environment ${envId}. Please reconnect.` },
        { status: 401 }
      ),
    };
  }

  const session = await getSession(sessionId);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'session_expired', envId, message: `Session expired for environment. Please reconnect.` },
        { status: 401 }
      ),
    };
  }

  await touchSession(sessionId);
  return { session };
}

/** Build Set-Cookie header value for a session */
export function buildSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/api/rift`;
}

/** Build Set-Cookie header value to clear the session */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/rift; Max-Age=0`;
}
