import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';

async function render(locale: string) {
  const container = await AstroContainer.create();
  return container.renderToString(Home, { params: { locale } });
}

describe('Base layout', () => {
  it('FR-75 sets <html lang> to the route locale', async () => {
    expect(await render('ko')).toContain('<html lang="ko"');
    expect(await render('en')).toContain('<html lang="en"');
  });

  it('FR-27 links the Stairno icon so browsers stop asking for /favicon.ico', async () => {
    expect(await render('ko')).toMatch(
      /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/,
    );
  });

  it('FR-77 runs the @stairno/ui theme script before anything else in <head>', async () => {
    const html = await render('ko');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const firstScript = head.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(firstScript).toContain('data-theme');
  });
});
