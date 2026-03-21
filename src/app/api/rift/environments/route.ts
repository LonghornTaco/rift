import { NextRequest, NextResponse } from 'next/server';

interface EnvironmentsRequestBody {
  accessToken: string;
  projectId: string;
}

export async function POST(request: NextRequest) {
  let body: EnvironmentsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { accessToken, projectId } = body;
  if (!accessToken || !projectId) {
    return NextResponse.json(
      { error: 'accessToken and projectId are required' },
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
      return NextResponse.json(
        { error: `Failed to fetch environments: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to connect to Deploy API: ${message}` },
      { status: 502 }
    );
  }
}
