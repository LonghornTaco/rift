import { auth0 } from '@/lib/auth0';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the current user's XMC access token if an Auth0 session exists.
// Used by the client on mount to hydrate token state after a full-page
// redirect through /auth/login → /auth/callback → /rift.
export async function GET() {
  try {
    const { token } = await auth0.getAccessToken();
    return Response.json({ token });
  } catch {
    return Response.json({ token: null }, { status: 401 });
  }
}
