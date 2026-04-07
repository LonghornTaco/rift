import { NextRequest, NextResponse } from 'next/server';
import { validateCmUrl, validateItemPath, upstreamError, sanitizeError } from '@/lib/rift/api-security';
import { withSession } from '@/lib/rift/session-middleware';

interface TreeRequestBody {
  parentPath: string;
}

export async function POST(request: NextRequest) {
  const sessionResult = await withSession(request);
  if (!sessionResult.ok) return sessionResult.response;
  const { session } = sessionResult;

  let body: TreeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { parentPath } = body;
  const cmUrl = session.cmUrl;
  const accessToken = session.accessToken;

  if (!parentPath) {
    return NextResponse.json(
      { error: 'parentPath is required' },
      { status: 400 }
    );
  }

  const cmUrlError = validateCmUrl(cmUrl);
  if (cmUrlError) {
    return NextResponse.json({ error: cmUrlError }, { status: 400 });
  }

  const pathError = validateItemPath(parentPath);
  if (pathError) {
    return NextResponse.json({ error: 'Invalid parentPath format' }, { status: 400 });
  }

  const query = `
    query($path: String!) {
      item(where: { path: $path, language: "en", database: "master" }) {
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
      body: JSON.stringify({ query, variables: { path: parentPath } }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return upstreamError('tree', response.status, errorText);
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
    return sanitizeError('tree', err);
  }
}
