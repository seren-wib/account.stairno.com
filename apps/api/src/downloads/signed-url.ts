// FR-62 (SDD §6.8): a download link the API signs itself. An R2 binding cannot presign a URL, so
// the link points at the API with the file's key and an expiry, signed with HMAC-SHA256 under a
// key derived from a secret only the API has. The key and expiry are inside the signed part, so
// neither can be changed; the user is not in the link at all.

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Its own key, so a download signature can never stand for anything else the secret signs.
function signingKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`stairno-download-url-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signDownload(secret: string, key: string, expiresAt: number) {
  const payload = base64url(encoder.encode(JSON.stringify({ k: key, e: expiresAt })));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

// The file's key when the link is ours and still valid, otherwise null.
export async function verifyDownload(secret: string, token: string, now = Date.now()) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const signatureBytes = fromBase64url(signature);
  const payloadBytes = fromBase64url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signatureBytes,
    encoder.encode(payload),
  );
  if (!valid) return null;
  try {
    const { k, e } = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      k?: unknown;
      e?: unknown;
    };
    if (typeof k !== 'string' || typeof e !== 'number' || e <= now) return null;
    return k;
  } catch {
    return null;
  }
}
