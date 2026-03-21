import { NextRequest, NextResponse } from 'next/server';

interface ProjectsRequestBody {
  accessToken: string;
}

export async function POST(request: NextRequest) {
  let body: ProjectsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { accessToken } = body;
  if (!accessToken) {
    return NextResponse.json({ error: 'accessToken is required' }, { status: 400 });
  }

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
