import type { TransferPhase } from './types';

interface TransferRequest {
  sourceContextId: string;
  targetContextId: string;
  itemPath: string;
  scope: string;
  mergeStrategy?: string;
  accessToken: string;
  onProgress?: (phase: TransferPhase, detail?: string) => void;
  signal?: AbortSignal;
}

type StreamEvent =
  | { type: 'progress'; phase: TransferPhase; detail?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Client-side wrapper that POSTs a single-path transfer to the server route
 * and streams NDJSON progress events back to the caller's onProgress callback.
 */
export async function transferPathViaApi(request: TransferRequest): Promise<void> {
  const { onProgress, signal, accessToken, ...body } = request;
  const res = await fetch('/api/rift/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Transfer request failed (${res.status}): ${errText || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === 'progress') {
          onProgress?.(event.phase, event.detail);
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
