// FR-45, DR-4: a billing key can charge the buyer's card, so it is stored only encrypted. Both
// keys used here come from BILLING_KEY_SECRET through HKDF with their own labels: one AES-GCM key
// for the billing keys, one HMAC key for the customerKey. Web Crypto only, so it runs the same on
// Workers and in Node.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 'v1';

function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function derive(
  secret: string | undefined,
  info: string,
  // Typed from the call itself: the Node and Workers type sets name these params differently.
  algorithm: Parameters<typeof crypto.subtle.deriveKey>[2],
  usages: Parameters<typeof crypto.subtle.deriveKey>[4],
): ReturnType<typeof crypto.subtle.deriveKey> {
  if (!secret || secret.length < 32) {
    throw new Error('BILLING_KEY_SECRET must be set and at least 32 characters long.');
  }
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('stairno-account'),
      info: encoder.encode(info),
    },
    base,
    algorithm,
    false,
    usages,
  );
}

const encryptionKey = (secret: string | undefined) =>
  derive(secret, 'billing-key-encryption', { name: 'AES-GCM', length: 256 }, [
    'encrypt',
    'decrypt',
  ]);

// `v1.<iv>.<ciphertext>`, base64url. A fresh 96-bit IV every time; the version is authenticated.
export async function encryptBillingKey(secret: string | undefined, billingKey: string) {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(VERSION) },
    key,
    encoder.encode(billingKey),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(data))}`;
}

export async function decryptBillingKey(secret: string | undefined, stored: string) {
  const [version, iv, data] = stored.split('.');
  if (version !== VERSION || !iv || !data) throw new Error('Not an encrypted billing key.');
  const key = await encryptionKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: encoder.encode(VERSION) },
    key,
    fromBase64Url(data),
  );
  return decoder.decode(plain);
}

// Toss ties billing keys to a customerKey: 2 to 50 of letters, digits and -_=.@, and it must not
// be guessable. An HMAC of the user id under our secret is both, and needs no row to exist first.
export async function customerKeyFor(secret: string | undefined, userId: string) {
  const key = await derive(secret, 'customer-key', { name: 'HMAC', hash: 'SHA-256' }, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(userId));
  return `cus_${toBase64Url(new Uint8Array(mac)).slice(0, 40)}`;
}
