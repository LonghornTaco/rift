import { NextRequest, NextResponse } from 'next/server';
import { validateCmUrl, upstreamError, sanitizeError } from '@/lib/rift/api-security';

interface SitesRequestBody {
  cmUrl: string;
  accessToken: string;
}

export async function POST(request: NextRequest) {
  let body: SitesRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cmUrl, accessToken } = body;
  if (!cmUrl || !accessToken) {
    return NextResponse.json(
      { error: 'cmUrl and accessToken are required' },
      { status: 400 }
    );
  }

  const cmUrlError = validateCmUrl(cmUrl);
  if (cmUrlError) {
    return NextResponse.json({ error: cmUrlError }, { status: 400 });
  }

  const query = `
    query {
      item(where: { path: "/sitecore/content", language: "en", database: "master" }) {
        children {
          nodes {
            itemId
            name
            path
            hasChildren
            children {
              nodes {
                itemId
                name
                path
                hasChildren
              }
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
      return upstreamError('sites', response.status, errorText);
    }

    const data = await response.json();
    const collections = data?.data?.item?.children?.nodes ?? [];

    const sites: { name: string; rootPath: string; collection: string }[] = [];
    for (const collection of collections) {
      if (collection.hasChildren && collection.children?.nodes) {
        for (const site of collection.children.nodes) {
          sites.push({
            name: site.name,
            rootPath: site.path,
            collection: collection.name,
          });
        }
      }
    }

    return NextResponse.json({ sites });
  } catch (err) {
    return sanitizeError('sites', err);
  }
}
