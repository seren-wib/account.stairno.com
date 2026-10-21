// PKCE (RFC 7636) and the sealed cookies that carry the sign-in state and the buyer's access
// token. Cookies are AES-GCM with a key derived from the client secret, so the Worker needs no
// second secret and nothing in a cookie can be read or changed by the browser.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(size = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function cookieKey(secret) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('payment-rehearsal cookie'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// `maxAge` in seconds; the payload comes back with `exp` in milliseconds.
export async function sealCookie(secret, payload, { now, maxAge }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify({ ...payload, exp: now + maxAge * 1000 }));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await cookieKey(secret),
    plain,
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(sealed))}`;
}

// null for anything that is not a live cookie sealed with this secret.
export async function openCookie(secret, value, { now }) {
  if (typeof value !== 'string') return null;
  const [iv, sealed, extra] = value.split('.');
  if (!iv || !sealed || extra !== undefined) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(iv) },
      await cookieKey(secret),
      fromBase64url(sealed),
    );
    const payload = JSON.parse(decoder.decode(plain));
    return typeof payload.exp === 'number' && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
