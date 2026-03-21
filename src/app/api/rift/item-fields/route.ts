import { NextRequest, NextResponse } from 'next/server';

interface ItemFieldsRequestBody {
  cmUrl: string;
  accessToken: string;
  itemPath: string;
  fieldNames: string[];
}

export async function POST(request: NextRequest) {
  let body: ItemFieldsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cmUrl, accessToken, itemPath, fieldNames } = body;
  if (!cmUrl || !accessToken || !itemPath) {
    return NextResponse.json(
      { error: 'cmUrl, accessToken, and itemPath are required' },
      { status: 400 }
    );
  }

  if (!/^\/[a-zA-Z0-9\s\-_\/()]+$/.test(itemPath)) {
    return NextResponse.json({ error: 'Invalid itemPath format' }, { status: 400 });
  }

  const safePath = itemPath.replace(/"/g, '\\"');

  const query = `
    query {
      item(where: { path: "${safePath}", language: "en", database: "master" }) {
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

    // Log GraphQL errors if any
    if (data?.errors) {
      console.error('[Rift item-fields] GraphQL errors:', JSON.stringify(data.errors));
      return NextResponse.json(
        { error: 'GraphQL query error', details: JSON.stringify(data.errors) },
        { status: 400 }
      );
    }

    const item = data?.data?.item;
    if (!item) {
      console.error('[Rift item-fields] Item not found. Path:', itemPath, 'Response:', JSON.stringify(data));
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch item fields: ${message}` },
      { status: 502 }
    );
  }
}
