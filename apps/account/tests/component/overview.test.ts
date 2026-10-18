import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Overview from '../../src/pages/[locale]/index.astro';
import { en } from '../../src/i18n/en';

function locals(emailVerified: boolean) {
  return {
    apiUrl: 'https://api.stairno.com',
    user: {
      id: 'u1',
      email: 'yu@example.com',
      name: 'Yu Seong',
      emailVerified,
      locale: 'en',
    },
  } as unknown as App.Locals;
}

async function render(emailVerified: boolean, locale = 'en') {
  const container = await AstroContainer.create();
  return container.renderToString(Overview, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/`),
    locals: locals(emailVerified),
  });
}

describe('overview', () => {
  it('FR-29 shows the name, the email and shortcuts to the account pages', async () => {
    const html = await render(true);
    expect(html).toContain('Yu Seong');
    expect(html).toContain('yu@example.com');
    for (const page of ['profile', 'devices', 'connections', 'payment-methods']) {
      expect(html).toContain(`href="/en/${page}/"`);
    }
  });

  it('FR-29 FR-2 says the email is confirmed and offers no resend', async () => {
    const html = await render(true);
    expect(html).toContain(en.overview.verified);
    expect(html).not.toContain('data-resend-verification');
  });

  it('FR-29 FR-74 offers to send the verification mail again while unconfirmed', async () => {
    const html = await render(false);
    expect(html).toContain(en.overview.unverified);
    expect(html).toMatch(/data-resend-verification[^>]*data-email="yu@example.com"/);
  });
});

describe('signed-in frame', () => {
  it('FR-29 NFR-18 lists the account pages and marks the current one', async () => {
    const html = await render(true);
    const start = html.indexOf('class="account-menu"');
    const menu = html.slice(start, html.indexOf('</nav>', start));
    for (const page of [
      '',
      'profile/',
      'devices/',
      'connections/',
      'payment-methods/',
      'delete/',
    ]) {
      expect(menu).toContain(`href="/en/${page}"`);
    }
    expect(menu).toMatch(/href="\/en\/"[^>]*aria-current="page"/);
  });

  it('FR-82 FR-79 puts the signed-in account menu in the header', async () => {
    const html = await render(true);
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).toMatch(/data-account-menu[^>]*data-state="signed-in"/);
    expect(header).toContain('data-sign-out-url="https://api.stairno.com/auth/sign-out"');
    expect(header).toMatch(/data-account-initial[^>]*>\s*Y\s*</);
    expect(header).toContain('Yu Seong');
    expect(header).toContain('yu@example.com');
    expect(header).toContain('href="/en/"');
    expect(header).toContain(en.nav.accountMenu.manage);
    expect(header).toContain(en.nav.accountMenu.signOut);
  });

  it('FR-82 drops the old email and sign-out button from the header', async () => {
    const html = await render(true);
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).not.toContain('class="account-sign-out"');
    expect(header).not.toContain('class="account-email"');
  });
});
