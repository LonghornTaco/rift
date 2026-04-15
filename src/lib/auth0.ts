import { Auth0Client } from '@auth0/nextjs-auth0/server';

// Rift runs inside the Sitecore Marketplace iframe. The session cookie must
// allow cross-site delivery (SameSite=None) so the popup login flow's result
// is readable when we navigate back. audience must match the XMC edge-platform
// resource server so access tokens are JWTs usable by experimental_createXMCClient.
export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN || 'auth.sitecorecloud.io',
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  secret: process.env.AUTH0_SECRET,
  appBaseUrl: process.env.APP_BASE_URL,
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email offline_access',
  },
  session: {
    cookie: {
      sameSite: 'none',
      secure: true,
    },
  },
});
