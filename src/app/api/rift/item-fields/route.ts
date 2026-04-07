import { NextRequest, NextResponse } from 'next/server';
import { validateCmUrl, validateItemPath, upstreamError, sanitizeError } from '@/lib/rift/api-security';
import { withSession } from '@/lib/rift/session-middleware';

interface ItemFieldsRequestBody {
  itemPath: string;
  fieldNames: string[];
}

export async function POST(request: NextRequest) {
  const sessionResult = await withSession(request);
  if (!sessionResult.ok) return sessionResult.response;
  const { session } = sessionResult;

  const cmUrl = session.cmUrl;
  const accessToken = session.accessToken;

  let body: ItemFieldsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { itemPath, fieldNames } = body;
  if (!itemPath) {
    return NextResponse.json(
      { error: 'itemPath is required' },
      { status: 400 }
    );
  }

  const cmUrlError = validateCmUrl(cmUrl);
  if (cmUrlError) {
    return NextResponse.json({ error: cmUrlError }, { status: 400 });
  }

  const pathError = validateItemPath(itemPath);
  if (pathError) {
    return NextResponse.json({ error: 'Invalid itemPath format' }, { status: 400 });
  }

  const query = `
    query($path: String!) {
      item(where: { path: $path, language: "en", database: "master" }) {
        itemId
        name
        path
        template {
          name
        }
        fields(ownFields: true) {
          nodes {
            name
            value
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
      body: JSON.stringify({ query, variables: { path: itemPath } }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return upstreamError('item-fields', response.status, errorText);
    }

    const data = await response.json();

    if (data?.errors) {
      console.error('[Rift item-fields] GraphQL errors:', JSON.stringify(data.errors));
      return NextResponse.json({ error: 'GraphQL query error' }, { status: 400 });
    }

    const item = data?.data?.item;
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const fields: Record<string, string> = {};
    const fieldNodes = item.fields?.nodes ?? [];
    for (const f of fieldNodes) {
      if (fieldNames && fieldNames.length > 0) {
        if (fieldNames.includes(f.name)) {
          fields[f.name] = f.value ?? '';
        }
      } else {
        fields[f.name] = f.value ?? '';
      }
    }

    return NextResponse.json({
      itemId: item.itemId,
      name: item.name,
      path: item.path,
      templateId: item.templateId ?? '',
      templateName: item.templateName ?? '',
      fields,
    });
  } catch (err) {
    return sanitizeError('item-fields', err);
  }
}
