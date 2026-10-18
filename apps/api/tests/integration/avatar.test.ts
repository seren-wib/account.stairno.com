import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, PASSWORD, post, sessionUser, signUp } from '../helpers/auth';
import { createMemoryAvatarBucket } from '../helpers/bucket';
import { stubPwnedPasswords } from '../helpers/hibp';

// FR-85 (SDD §7.6): the profile photo. The browser sends a small square image; the API checks
// its size and type, stores it in R2 under the user, points user.image at a public address and
// serves it from there with long caching. Removing it, or deleting the account, removes the file.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);
const WEBP = new Uint8Array([
  ...new TextEncoder().encode('RIFF'),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode('WEBPVP8 '),
]);
const GIF = new TextEncoder().encode('GIF89a-not-allowed');

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const avatars = createMemoryAvatarBucket();
  const ctx = await createTestApp({ avatars });
  const { cookie } = await signUp(ctx.app);
  const upload = (bytes: Uint8Array, type: string, as: string | null = cookie) =>
    ctx.app.request('/v1/me/image', {
      method: 'PUT',
      headers: { 'content-type': type, origin: ACCOUNT_URL, ...(as ? { cookie: as } : {}) },
      body: bytes,
    });
  const remove = () =>
    ctx.app.request('/v1/me/image', {
      method: 'DELETE',
      headers: { origin: ACCOUNT_URL, cookie },
    });
  const image = async () => ((await sessionUser(ctx.app, cookie))?.image as string | null) ?? null;
  return { ...ctx, avatars, cookie, upload, remove, image };
}

describe('profile photo', () => {
  it('FR-85 stores a PNG, points the profile at its public address and serves it for a year', async () => {
    const { app, upload, image, avatars } = await setup();

    const res = await upload(PNG, 'image/png');

    expect(res.status).toBe(200);
    const url = await image();
    expect(url).toMatch(new RegExp(`^${API_URL}/v1/avatars/[0-9a-f-]{36}/[0-9a-f]{16}\\.png$`));
    expect(((await res.json()) as { image: string }).image).toBe(url);
    expect(avatars.keys()).toHaveLength(1);

    const file = await app.request(new URL(url!).pathname);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('FR-85 takes JPEG and WebP too', async () => {
    const { upload, image } = await setup();
    expect((await upload(JPEG, 'image/jpeg')).status).toBe(200);
    expect(await image()).toMatch(/\.jpg$/);
    expect((await upload(WEBP, 'image/webp')).status).toBe(200);
    expect(await image()).toMatch(/\.webp$/);
  });

  it('FR-85 replaces the old file, which stops being served', async () => {
    const { app, upload, image, avatars } = await setup();
    await upload(PNG, 'image/png');
    const old = await image();

    await upload(JPEG, 'image/jpeg');

    expect(await image()).not.toBe(old);
    expect(avatars.keys()).toHaveLength(1);
    expect((await app.request(new URL(old!).pathname)).status).toBe(404);
  });

  it('FR-85 refuses more than 512 KB with 413 and changes nothing', async () => {
    const { upload, image, avatars } = await setup();
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);

    const res = await upload(big, 'image/png');

    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'payload_too_large',
    );
    expect(await image()).toBeNull();
    expect(avatars.keys()).toEqual([]);
  });

  it('FR-85 refuses other formats, and bytes that do not match the stated type, with 415', async () => {
    const { upload, image, avatars } = await setup();
    for (const [bytes, type] of [
      [GIF, 'image/gif'],
      [GIF, 'image/png'],
      [PNG, 'image/jpeg'],
      [new Uint8Array(), 'image/png'],
    ] as const) {
      const res = await upload(bytes, type);
      expect(res.status, type).toBe(415);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'unsupported_media_type',
      );
    }
    expect(await image()).toBeNull();
    expect(avatars.keys()).toEqual([]);
  });

  it('FR-85 removes the photo: the file goes and the profile has none', async () => {
    const { app, upload, remove, image, avatars } = await setup();
    await upload(PNG, 'image/png');
    const url = await image();

    const res = await remove();

    expect(res.status).toBe(200);
    expect(await image()).toBeNull();
    expect(avatars.keys()).toEqual([]);
    expect((await app.request(new URL(url!).pathname)).status).toBe(404);
  });

  it('FR-85 needs the account center session', async () => {
    const { upload } = await setup();
    expect((await upload(PNG, 'image/png', null)).status).toBe(401);
  });

  it('FR-85 FR-8 deletes the files with the account', async () => {
    const { app, upload, cookie, avatars } = await setup();
    await upload(PNG, 'image/png');

    expect((await post(app, '/auth/delete-user', { password: PASSWORD }, cookie)).status).toBe(200);

    expect(avatars.keys()).toEqual([]);
  });

  it('FR-85 answers 404 for an address that is not a stored photo', async () => {
    const { app } = await setup();
    for (const path of [
      '/v1/avatars/not-a-user/0123456789abcdef.png',
      '/v1/avatars/6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11/0123456789abcdef.png',
      '/v1/avatars/6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11/..%2Fsecret.png',
    ]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it('FR-23 FR-85 /v1/me carries the photo address', async () => {
    const { app, upload, cookie, image } = await setup();
    await upload(PNG, 'image/png');
    const me = (await (await get(app, '/v1/me', cookie)).json()) as { image: string | null };
    expect(me.image).toBe(await image());
  });
});
