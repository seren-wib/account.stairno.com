import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { get, sessionUser, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

interface SessionItem {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  browser: string | null;
  os: string | null;
  current: boolean;
}

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// One user on a Windows laptop and an iPhone.
async function twoDevices() {
  const ctx = await createTestApp();
  const { email } = await signUp(ctx.app);
  const { cookie: laptop } = await signIn(ctx.app, email, undefined, {
    'user-agent': CHROME_WINDOWS,
  });
  const { cookie: phone } = await signIn(ctx.app, email, undefined, {
    'user-agent': SAFARI_IPHONE,
  });
  const list = async (cookie: string) => {
    const res = await get(ctx.app, '/v1/sessions', cookie);
    return (await res.json()) as { items: SessionItem[]; nextCursor: string | null };
  };
  const end = (id: string, cookie: string, origin = ACCOUNT_URL) =>
    ctx.app.request(`/v1/sessions/${id}`, { method: 'DELETE', headers: { cookie, origin } });
  return { ...ctx, email, laptop, phone, list, end };
}

describe('GET /v1/sessions', () => {
  it('FR-7 lists times and a device summary per session and marks the current one', async () => {
    const { list, phone } = await twoDevices();

    const { items, nextCursor } = await list(phone);

    expect(items).toHaveLength(3);
    expect(nextCursor).toBeNull();
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['browser', 'createdAt', 'current', 'id', 'lastUsedAt', 'os'].sort(),
      );
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(item.lastUsedAt))).toBe(false);
    }
    const current = items.filter((i) => i.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ browser: 'Safari', os: 'iOS' });
    expect(items.some((i) => i.browser === 'Chrome' && i.os === 'Windows' && !i.current)).toBe(
      true,
    );
  });

  it('FR-24 answers 401 in the error format without a session', async () => {
    const { app } = await createTestApp();

    const res = await app.request('/v1/sessions');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: expect.any(String) },
    });
  });
});

describe('DELETE /v1/sessions/:id', () => {
  it('FR-7 ending one session shortens the list by one and signs that device out', async () => {
    const { app, list, end, laptop, phone } = await twoDevices();
    const laptopId = (await list(laptop)).items.find((i) => i.current)?.id ?? '';

    expect((await end(laptopId, phone)).status).toBe(204);

    expect((await list(phone)).items).toHaveLength(2);
    expect(await sessionUser(app, laptop)).toBeNull();
    expect(await sessionUser(app, phone)).not.toBeNull();
  });

  it("FR-7 answers 404 for another user's session and leaves it alone", async () => {
    const { app, list, end, laptop } = await twoDevices();
    const { cookie: stranger } = await signUp(app);
    const laptopId = (await list(laptop)).items.find((i) => i.current)?.id ?? '';

    const res = await end(laptopId, stranger);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect(await sessionUser(app, laptop)).not.toBeNull();
  });

  it('NFR-5 refuses to end a session from another origin', async () => {
    const { app, list, end, laptop, phone } = await twoDevices();
    const laptopId = (await list(laptop)).items.find((i) => i.current)?.id ?? '';

    const res = await end(laptopId, phone, 'https://evil.example');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    expect(await sessionUser(app, laptop)).not.toBeNull();
  });
});
