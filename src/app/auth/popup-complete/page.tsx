import { auth0 } from '@/lib/auth0';

// Server-rendered page that runs at the end of the popup login flow.
// Reads the fresh Auth0 session, serializes the access token into an inline
// script, postMessages it to window.opener, then closes itself.
export default async function PopupCompletePage() {
  let token: string | null = null;
  let error: string | null = null;
  try {
    const result = await auth0.getAccessToken();
    token = result.token;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const payload = token
    ? { type: 'rift-auth-token', token }
    : { type: 'rift-auth-error', error: error ?? 'Unknown error' };

  const script = `
    try {
      if (window.opener) {
        window.opener.postMessage(${JSON.stringify(payload)}, window.location.origin);
      }
    } catch (e) {
      console.error('[Rift popup] failed to postMessage token:', e);
    }
    window.close();
  `;

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Signing you in…</h1>
        <p style={{ color: '#666' }}>You can close this window if it doesn&apos;t close automatically.</p>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>
  );
}
