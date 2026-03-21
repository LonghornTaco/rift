interface AuthResult {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

export async function authenticate(
  clientId: string,
  clientSecret: string
): Promise<AuthResult> {
  const res = await fetch('/api/rift/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Authentication failed (${res.status})`);
  }

  return res.json();
}
