import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCookie, pkceChallenge, randomToken, sealCookie } from '../src/crypto.mjs';

const SECRET = 'a-client-secret-long-enough-for-the-tests-0123456789';

test('PKCE challenge is base64url(SHA-256(verifier)) (RFC 7636 appendix B)', async () => {
  assert.equal(
    await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('random tokens are base64url and differ', () => {
  const a = randomToken();
  const b = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('a sealed cookie opens with the same secret before it expires', async () => {
  const value = await sealCookie(SECRET, { accessToken: 'abc' }, { now: 1000, maxAge: 60 });
  assert.doesNotMatch(value, /abc/);
  assert.deepEqual(await openCookie(SECRET, value, { now: 1000 + 59_000 }), {
    accessToken: 'abc',
    exp: 61_000,
  });
});

test('a sealed cookie is refused after it expires, with another secret, or changed', async () => {
  const value = await sealCookie(SECRET, { accessToken: 'abc' }, { now: 1000, maxAge: 60 });
  assert.equal(await openCookie(SECRET, value, { now: 61_000 }), null);
  assert.equal(await openCookie(`${SECRET}x`, value, { now: 1000 }), null);
  const changed = value.slice(0, -2) + (value.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(await openCookie(SECRET, changed, { now: 1000 }), null);
  assert.equal(await openCookie(SECRET, 'not-a-cookie', { now: 1000 }), null);
  assert.equal(await openCookie(SECRET, undefined, { now: 1000 }), null);
});

test('every seal of the same payload differs', async () => {
  const a = await sealCookie(SECRET, { x: 1 }, { now: 0, maxAge: 60 });
  const b = await sealCookie(SECRET, { x: 1 }, { now: 0, maxAge: 60 });
  assert.notEqual(a, b);
});
