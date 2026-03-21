import { NextRequest, NextResponse } from 'next/server';

interface AuthRequestBody {
  clientId: string;
  clientSecret: string;
}

export async function POST(request: NextRequest) {
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
      return NextResponse.json(
        { error: `Authentication failed: ${tokenResponse.status}`, details: errorText },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    return NextResponse.json({
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to connect to auth server: ${message}` },
      { status: 502 }
    );
  }
}
