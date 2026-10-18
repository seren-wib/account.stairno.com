import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import { en } from '../../src/i18n/en';
import { stubApi as stub } from './api-stub';

const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status: number, items: unknown[] = []) {
  stub({ '/v1/connections': [status, { items, nextCursor: null }] });
}

async function render() {
  const container = await AstroContainer.create();
  return container.renderToString(Home, {
    params: { locale: 'en' },
    request: new Request('https://account.stairno.com/en/', {
      headers: { cookie: 'stairno.session_token=abc' },
    }),
    locals,
  });
}

describe('connected sites page', () => {
  it('FR-21 lists each site with when it was connected and last used', async () => {
    stubApi(200, [
      {
        clientId: 'labs-client',
        name: 'Stairno Labs',
        connectedAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: '2026-10-15T00:00:00.000Z',
      },
    ]);
    const html = await render();
    expect(html).toContain('Stairno Labs');
    expect(html).toContain('Sep 1, 2026');
    expect(html).toContain('Oct 15, 2026');
    expect(html).toContain('data-disconnect="labs-client"');
    expect(html).toMatch(/data-api="https:\/\/api.stairno.com"/);
  });

  it('FR-21 says when no site is connected', async () => {
    stubApi(200, []);
    const html = await render();
    expect(html).toContain(en.connections.empty);
    expect(html).not.toContain('data-disconnect=');
  });

  it('says so when the list cannot be loaded', async () => {
    stubApi(500);
    expect(await render()).toContain(en.connections.unavailable);
  });
});
