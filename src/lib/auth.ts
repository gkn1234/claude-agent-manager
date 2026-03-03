/**
 * Simple authentication module using Web Crypto API (Edge Runtime compatible).
 *
 * AUTH_PASSWORD: login password (env var, required — app is locked if unset)
 * AUTH_SECRET:   HMAC signing key for cookies (env var, required)
 */

const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? '';
const AUTH_SECRET = process.env.AUTH_SECRET ?? '';
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const AUTH_COOKIE_NAME = 'auth_token';

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

/** Whether auth is configured. If false, all requests are rejected. */
export function isAuthConfigured(): boolean {
  return AUTH_PASSWORD.length > 0 && AUTH_SECRET.length > 0;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false if lengths differ (leaks length info, acceptable for passwords).
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Verify login password against AUTH_PASSWORD env var. */
export function verifyPassword(input: string): boolean {
  if (!AUTH_PASSWORD || !input) return false;
  return constantTimeEqual(input, AUTH_PASSWORD);
}

/** Encode string to Uint8Array (TextEncoder). */
function encode(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>;
}

/** Convert ArrayBuffer to hex string. */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Import AUTH_SECRET as HMAC-SHA256 CryptoKey. */
async function getSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encode(AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Create a signed token: `timestamp.hex_signature`. */
export async function createToken(): Promise<string> {
  const timestamp = Date.now().toString();
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, encode(timestamp));
  return `${timestamp}.${bufToHex(sig)}`;
}

/** Verify a token's signature and expiry (7 days). */
export async function verifyToken(token: string): Promise<boolean> {
  if (!AUTH_SECRET || !token) return false;

  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  // Check expiry
  const age = Date.now() - Number(timestamp);
  if (isNaN(age) || age < 0 || age > TOKEN_MAX_AGE_MS) return false;

  // Verify signature
  const key = await getSigningKey();
  const expected = bufToHex(
    await crypto.subtle.sign('HMAC', key, encode(timestamp)),
  );

  return constantTimeEqual(signature, expected);
}
