import { NextRequest, NextResponse } from 'next/server';
import { withSession } from '@/lib/rift/session-middleware';

export async function POST(request: NextRequest) {
  const sessionResult = await withSession(request);
  if (!sessionResult.ok) return sessionResult.response;
  const { session } = sessionResult;

  const accessToken = session.accessToken;

  try {
    const response = await fetch('https://xmclouddeploy-api.sitecorecloud.io/api/projects/v1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Rift projects] Upstream error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Rift projects] Connection error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'Failed to connect to Deploy API' },
      { status: 502 }
    );
  }
}
