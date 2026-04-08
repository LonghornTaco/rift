import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logError } from '@/lib/rift/logger';
import {
  storeCredentials,
  hasStoredCredentials,
  deleteStoredCredentials,
} from '@/lib/rift/credential-store';

interface CredentialRequestBody {
  envId: string;
  clientId?: string;
  clientSecret?: string;
  action?: 'store' | 'check' | 'delete';
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  if (!rateLimit(clientIp, 60_000, 20)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  let body: CredentialRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { envId, action = 'store' } = body;
  if (!envId) {
    return NextResponse.json({ error: 'envId is required' }, { status: 400 });
  }

  try {
    if (action === 'check') {
      const has = await hasStoredCredentials(envId);
      return NextResponse.json({ hasCredentials: has });
    }

    if (action === 'delete') {
      await deleteStoredCredentials(envId);
      return NextResponse.json({ deleted: true });
    }

    // action === 'store'
    const { clientId, clientSecret } = body;
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'clientId and clientSecret are required for store action' },
        { status: 400 }
      );
    }

    await storeCredentials(envId, clientId, clientSecret);
    return NextResponse.json({ stored: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('/api/rift/credentials', 'credential_operation_error', detail, { clientIp });
    return NextResponse.json(
      { error: 'Credential operation failed' },
      { status: 500 }
    );
  }
}
