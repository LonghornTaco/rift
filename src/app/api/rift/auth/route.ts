import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logAuth, logRateLimit, logError } from '@/lib/rift/logger';
import { createSession } from '@/lib/rift/session-store';
import { buildSessionCookie } from '@/lib/rift/session-middleware';

interface AuthRequestBody {
  clientId: string;
  clientSecret: string;
  envId: string;
  cmUrl: string;
  envName: string;
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  if (!rateLimit(clientIp, 60_000, 10)) {
    logRateLimit('/api/rift/auth', clientIp);
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  let body: AuthRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { clientId, clientSecret, envId, cmUrl, envName } = body;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'clientId and clientSecret are required' },
      { status: 400 }
    );
  }

  try {
    const tokenResponse = await fetch('https://auth.sitecorecloud.io/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: 'https://api.sitecorecloud.io',
      }),
    });

    if (!tokenResponse.ok) {
      const status = tokenResponse.status;
      logAuth('/api/rift/auth', clientIp, false, `Upstream ${status}`);
      if (status === 401 || status === 403) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Authentication failed' }, { status: 502 });
    }

    logAuth('/api/rift/auth', clientIp, true);
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create server-side session
    let sessionId: string;
    try {
      sessionId = await createSession({
        envId: envId || 'unknown',
        clientId,
        clientSecret,
        accessToken,
        cmUrl: cmUrl || '',
        envName: envName || '',
      });
    } catch (sessionErr) {
      const detail = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
      logError('/api/rift/auth', 'session_create_error', detail, { clientIp });
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 }
      );
    }

    // Return response with session cookie
    const response = NextResponse.json({
      accessToken,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
      sessionId,
    });
    response.headers.set('Set-Cookie', buildSessionCookie(sessionId));
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('/api/rift/auth', 'auth_connection_error', detail, { clientIp });
    return NextResponse.json(
      { error: 'Failed to connect to authentication server' },
      { status: 502 }
    );
  }
}
