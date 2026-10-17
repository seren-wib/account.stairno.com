import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';

async function render(locale: string) {
  const container = await AstroContainer.create();
  return container.renderToString(Home, {
    params: { locale },
    locals: {
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'Test User',
        emailVerified: false,
        locale,
      },
    } as unknown as App.Locals,
  });
}

function hrefs(html: string, from: string, to: string) {
  const part = html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
  return [...part.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
}

describe('account layout', () => {
  it('FR-77 renders the @stairno/ui header with the brand, locale switch and theme toggle', async () => {
    const html = await render('ko');
    expect(html).toContain('class="site-header"');
    expect(html).toContain('>Stairno');
    expect(html).toContain('hreflang="en"');
  });

  it('DR-7 links back to the hub from the footer and to no other Stairno site', async () => {
    const html = await render('en');
    const links = hrefs(html, '<footer', '</footer>');
    expect(links).toContain('https://stairno.com/en/');
    const stairnoSites = links.filter((h) =>
      /(^|\.)stairno(works|games|labs)?\.com$/.test(new URL(h, 'https://x.invalid').hostname),
    );
    expect(stairnoSites).toEqual(['https://stairno.com/en/']);
  });

  it('FR-76 speaks the page language', async () => {
    expect(await render('ko')).toContain('Stairno 계정');
    expect(await render('en')).toContain('Stairno Account');
  });
});
