import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory relay: the login-redirect tab POSTs a token keyed by a nonce,
// and the iframe GETs it. Entries expire after 5 minutes.
const store = new Map<string, { token: string; expires: number }>();
const TTL_MS = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, val] of store) {
    if (val.expires < now) store.delete(key);
  }
}

export async function POST(req: NextRequest) {
  cleanup();
  const body = (await req.json()) as { nonce?: string; token?: string };
  if (!body.nonce || !body.token) {
    return Response.json({ error: 'Missing nonce or token' }, { status: 400 });
  }
  store.set(body.nonce, { token: body.token, expires: Date.now() + TTL_MS });
  return Response.json({ ok: true });
}

export async function GET(req: NextRequest) {
  cleanup();
  const nonce = req.nextUrl.searchParams.get('nonce');
  if (!nonce) {
    return Response.json({ error: 'Missing nonce' }, { status: 400 });
  }
  const entry = store.get(nonce);
  if (!entry) {
    return Response.json({ token: null }, { status: 404 });
  }
  store.delete(nonce);
  return Response.json({ token: entry.token });
}
