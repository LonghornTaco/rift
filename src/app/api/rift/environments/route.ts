import { NextRequest, NextResponse } from 'next/server';
import { upstreamError } from '@/lib/rift/api-security';
import { withSession } from '@/lib/rift/session-middleware';

interface EnvironmentsRequestBody {
  projectId: string;
}

export async function POST(request: NextRequest) {
  const sessionResult = await withSession(request);
  if (!sessionResult.ok) return sessionResult.response;
  const { session } = sessionResult;

  const accessToken = session.accessToken;

  let body: EnvironmentsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId is required' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://xmclouddeploy-api.sitecorecloud.io/api/environments/v1?projectId=${encodeURIComponent(projectId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return upstreamError('environments', response.status, errorText);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Rift environments] Connection error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'Failed to connect to Deploy API' },
      { status: 502 }
    );
  }
}
