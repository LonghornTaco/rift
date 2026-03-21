import { NextRequest, NextResponse } from 'next/server';

interface TreeRequestBody {
  cmUrl: string;
  accessToken: string;
  parentPath: string;
}

export async function POST(request: NextRequest) {
  let body: TreeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cmUrl, accessToken, parentPath } = body;
  if (!cmUrl || !accessToken || !parentPath) {
    return NextResponse.json(
      { error: 'cmUrl, accessToken, and parentPath are required' },
      { status: 400 }
    );
  }

  if (!/^\/[a-zA-Z0-9\s\-_\/()]+$/.test(parentPath)) {
    return NextResponse.json(
      { error: 'Invalid parentPath format' },
      { status: 400 }
    );
  }

  const safePath = parentPath.replace(/"/g, '\\"');

  const query = `
    query {
      item(where: { path: "${safePath}", language: "en", database: "master" }) {
        children {
          nodes {
            itemId
            name
            path
            hasChildren
            template {
              name
            }
          }
        }
      }
    }
  `;

  try {
    const graphqlUrl = `${cmUrl.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `GraphQL request failed: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    const nodes = data?.data?.item?.children?.nodes ?? [];

    const children = nodes.map((node: { itemId: string; name: string; path: string; hasChildren: boolean; template?: { name: string } }) => ({
      itemId: node.itemId,
      name: node.name,
      path: node.path,
      hasChildren: node.hasChildren,
      templateName: node.template?.name ?? '',
    }));

    return NextResponse.json({ children });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to query content tree: ${message}` },
      { status: 502 }
    );
  }
}
