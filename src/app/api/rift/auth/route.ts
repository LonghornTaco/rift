import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logAuth, logRateLimit, logError } from '@/lib/rift/logger';

interface AuthRequestBody {
  clientId: string;
  clientSecret: string;
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  // Rate limit: 10 requests per minute per IP
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

  const { clientId, clientSecret } = body;
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
      const errorText = await tokenResponse.text();
      const status = tokenResponse.status;
      logAuth('/api/rift/auth', clientIp, false, `Upstream ${status}`);
      if (status === 401 || status === 403) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Authentication failed' }, { status: 502 });
    }

    logAuth('/api/rift/auth', clientIp, true);
    const tokenData = await tokenResponse.json();
    return NextResponse.json({
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('/api/rift/auth', 'auth_connection_error', detail, { clientIp });
    return NextResponse.json(
      { error: 'Failed to connect to authentication server' },
      { status: 502 }
    );
  }
}
