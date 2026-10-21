import { describe, expect, it } from 'vitest';
import {
  customerKeyFor,
  decryptBillingKey,
  encryptBillingKey,
} from '../../src/payments/billing-keys';

// FR-45, DR-4: a billing key can charge the buyer's card, so it is only ever stored encrypted
// (AES-GCM, key derived from BILLING_KEY_SECRET). The customerKey Toss ties it to is derived per
// user from the same secret, so it is unguessable and exists before the first card does.

const SECRET = 'test-billing-key-secret-0123456789abcdef';
const BILLING_KEY = 'Z_t5vOvQxrj4499PeiJcjen28-V2RyqgYTwN44Rdzk0=';
const USER = '0e9c58f4-2f4e-4b2f-9a59-0d6b9b0f6a11';

describe('billing key encryption', () => {
  it('FR-45 DR-4 decrypts what it encrypted', async () => {
    const stored = await encryptBillingKey(SECRET, BILLING_KEY);

    await expect(decryptBillingKey(SECRET, stored)).resolves.toBe(BILLING_KEY);
  });

  it('DR-4 never stores the key readable, and never the same way twice', async () => {
    const a = await encryptBillingKey(SECRET, BILLING_KEY);
    const b = await encryptBillingKey(SECRET, BILLING_KEY);

    expect(a).not.toContain(BILLING_KEY);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('DR-4 refuses a stored value that was changed or made with another secret', async () => {
    const stored = await encryptBillingKey(SECRET, BILLING_KEY);
    const [version, iv, data] = stored.split('.');
    // Change the second-to-last character, which always carries ciphertext bits.
    const flipped = `${version}.${iv}.${data!.slice(0, -2)}${data!.at(-2) === 'A' ? 'B' : 'A'}${data!.slice(-1)}`;

    await expect(decryptBillingKey(SECRET, flipped)).rejects.toThrow();
    await expect(decryptBillingKey(`${SECRET}-other`, stored)).rejects.toThrow();
    await expect(decryptBillingKey(SECRET, 'plain-billing-key')).rejects.toThrow();
  });

  it('DR-4 needs a secret long enough to be one', async () => {
    await expect(encryptBillingKey('short', BILLING_KEY)).rejects.toThrow();
    await expect(encryptBillingKey(undefined, BILLING_KEY)).rejects.toThrow();
  });
});

describe('customer key', () => {
  it('FR-45 is the same for a user every time and different between users', async () => {
    const a = await customerKeyFor(SECRET, USER);

    expect(await customerKeyFor(SECRET, USER)).toBe(a);
    expect(await customerKeyFor(SECRET, '1f0c58f4-2f4e-4b2f-9a59-0d6b9b0f6a22')).not.toBe(a);
  });

  it('FR-45 fits Toss’s rule and cannot be guessed from the user id', async () => {
    const key = await customerKeyFor(SECRET, USER);

    expect(key).toMatch(/^[A-Za-z0-9_\-=.@]{2,50}$/);
    expect(key).not.toContain(USER);
    expect(await customerKeyFor(`${SECRET}-other`, USER)).not.toBe(key);
  });
});
