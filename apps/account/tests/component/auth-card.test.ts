import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignIn from '../../src/pages/[locale]/sign-in.astro';
import SignUp from '../../src/pages/[locale]/sign-up.astro';
import Forgot from '../../src/pages/[locale]/forgot-password.astro';
import Reset from '../../src/pages/[locale]/reset-password.astro';
import VerifyEmail from '../../src/pages/[locale]/verify-email.astro';
import Home from '../../src/pages/[locale]/index.astro';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render(page: typeof SignIn, path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ code: 'INVALID_TOKEN' }, { status: 400 })),
  );
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale: 'ko' },
    request: new Request(`https://account.stairno.com/ko/${path}`),
    locals,
  });
}

describe('auth card', () => {
  it.each([
    ['sign-in', SignIn],
    ['sign-up', SignUp],
    ['forgot-password', Forgot],
    ['reset-password?token=t', Reset],
    ['verify-email?token=t', VerifyEmail],
  ])('FR-27 frames %s in one card under the night band', async (path, page) => {
    const html = await render(page, path);
    expect(html).toContain('class="page-body page-body-card container"');
    expect(html).toMatch(/<div class="card">/);
  });

  it('FR-82 FR-79 shows the signed-out account menu on auth pages', async () => {
    const html = await render(SignIn, 'sign-in');
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).toMatch(/data-account-menu[^>]*data-state="signed-out"/);
    expect(header).toContain('href="/ko/sign-in/"');
    expect(header).toContain('href="/ko/sign-up/"');
    expect(header).not.toContain('data-session-url');
  });

  it('FR-27 leaves pages without a card alone', async () => {
    const html = await render(Home, '');
    expect(html).not.toContain('class="card"');
  });
});
