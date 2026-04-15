import { NextRequest } from 'next/server';
import { experimental_createXMCClient } from '@sitecore-marketplace-sdk/xmc';
import { transferPath } from '@/lib/rift/content-transfer';
import type { TransferPhase } from '@/lib/rift/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TransferRequestBody {
  sourceContextId: string;
  targetContextId: string;
  itemPath: string;
  scope: string;
  mergeStrategy?: string;
}

interface ProgressEvent {
  type: 'progress';
  phase: TransferPhase;
  detail?: string;
}

interface DoneEvent {
  type: 'done';
}

interface ErrorEvent {
  type: 'error';
  message: string;
}

type StreamEvent = ProgressEvent | DoneEvent | ErrorEvent;

export async function POST(req: NextRequest) {
  let body: TransferRequestBody;
  try {
    body = (await req.json()) as TransferRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sourceContextId, targetContextId, itemPath, scope, mergeStrategy } = body;
  if (!sourceContextId || !targetContextId || !itemPath || !scope) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Token is forwarded from the browser, which obtained it via the popup
  // login flow (src/app/auth/popup-complete/page.tsx). The browser stores it
  // in React state and sends it here as a Bearer header on each transfer.
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  }
  const accessToken = match[1];

  const xmc = await experimental_createXMCClient({
    getAccessToken: async () => accessToken,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      try {
        await transferPath(xmc, {
          sourceContextId,
          targetContextId,
          itemPath,
          scope,
          mergeStrategy,
          signal: req.signal,
          onProgress: (phase, detail) => write({ type: 'progress', phase, detail }),
        });
        write({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        write({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
