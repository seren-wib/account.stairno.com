import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, tokenRequest, type Site } from '../helpers/oidc';

const OFFLINE = { scope: 'openid profile email offline_access' };

interface Connection {
  clientId: string;
  name: string;
  connectedAt: string;
  lastUsedAt: string;
}

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const labs = await registerLabs(ctx);
  const works = await registerSite(
    ctx,
    'Stairno Works',
    'https://stairnoworks.com/api/auth/callback',
  );
  const user = await signUp(ctx.app);
  const list = async (cookie = user.cookie) => {
    const res = await get(ctx.app, '/v1/connections', cookie);
    return ((await res.json()) as { items: Connection[] }).items;
  };
  const disconnect = (clientId: string, cookie = user.cookie) =>
    ctx.app.request(`/v1/connections/${clientId}`, {
      method: 'DELETE',
      headers: { cookie, origin: ACCOUNT_URL },
    });
  const refresh = (site: Site, refreshToken: string) =>
    tokenRequest(ctx.app, site, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return { ...ctx, labs, works, user, list, disconnect, refresh };
}

describe('connected sites', () => {
  it('FR-21 lists the sites the user is signed in to', async () => {
    const ctx = await setup();
    await signInToSite(ctx, ctx.labs, ctx.user.cookie, OFFLINE);

    const items = await ctx.list();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ clientId: ctx.labs.clientId, name: 'Stairno Labs' });
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ['clientId', 'connectedAt', 'lastUsedAt', 'name'].sort(),
    );
    expect(String(items[0]?.connectedAt)).toMatch(/Z$/);
  });

  it('FR-21 disconnecting a site makes its refresh token fail', async () => {
    const ctx = await setup();
    const tokens = await signInToSite(ctx, ctx.labs, ctx.user.cookie, OFFLINE);

    expect((await ctx.disconnect(ctx.labs.clientId)).status).toBe(204);

    expect(await ctx.list()).toEqual([]);
    expect((await ctx.refresh(ctx.labs, tokens.refresh_token ?? '')).status).toBe(400);
  });

  it('FR-21 disconnecting one site leaves the others signed in', async () => {
    const ctx = await setup();
    await signInToSite(ctx, ctx.labs, ctx.user.cookie, OFFLINE);
    const atWorks = await signInToSite(ctx, ctx.works, ctx.user.cookie, OFFLINE);

    await ctx.disconnect(ctx.labs.clientId);

    expect((await ctx.list()).map((c) => c.name)).toEqual(['Stairno Works']);
    expect((await ctx.refresh(ctx.works, atWorks.refresh_token ?? '')).status).toBe(200);
  });

  it('FR-21 answers 404 for a site that is not connected', async () => {
    const ctx = await setup();

    const res = await ctx.disconnect(ctx.works.clientId);

    expect(res.status).toBe(404);
  });

  it("FR-21 never shows or ends another user's connections", async () => {
    const ctx = await setup();
    const tokens = await signInToSite(ctx, ctx.labs, ctx.user.cookie, OFFLINE);
    const stranger = await signUp(ctx.app);

    expect(await ctx.list(stranger.cookie)).toEqual([]);
    expect((await ctx.disconnect(ctx.labs.clientId, stranger.cookie)).status).toBe(404);
    expect((await ctx.refresh(ctx.labs, tokens.refresh_token ?? '')).status).toBe(200);
  });
});
