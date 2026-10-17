import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { termsVersion } from '@stairno-account/contract';
import Terms from '../../src/pages/[locale]/terms.astro';
import Privacy from '../../src/pages/[locale]/privacy.astro';
import { legal } from '../../src/legal';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

async function render(page: typeof Terms, locale: string, path: string) {
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/${path}`),
    locals,
  });
}

function text(doc: { title: string; sections: { heading: string; body: string[] }[] }) {
  return [doc.title, ...doc.sections.flatMap((s) => [s.heading, ...s.body])].join('\n');
}

describe('legal documents', () => {
  it('FR-31 ko and en have the same sections', () => {
    for (const kind of ['terms', 'privacy'] as const) {
      expect(legal.en[kind].sections.length).toBe(legal.ko[kind].sections.length);
      for (const section of [...legal.ko[kind].sections, ...legal.en[kind].sections]) {
        expect(section.heading.trim()).not.toBe('');
        expect(section.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('DR-6 never calls Stairno a company, group or studio', () => {
    const all = [legal.ko.terms, legal.ko.privacy, legal.en.terms, legal.en.privacy]
      .map(text)
      .join('\n')
      .toLowerCase();
    for (const word of ['회사', '그룹', '스튜디오', 'company', 'studio']) {
      expect(all).not.toContain(word);
    }
  });
});

describe('terms and privacy pages', () => {
  it.each([
    [Terms, 'terms'],
    [Privacy, 'privacy'],
  ] as const)('FR-31 FR-9 shows the version and effective date on /%s', async (page, path) => {
    for (const locale of ['ko', 'en']) {
      const html = await render(page, locale, path);
      expect(html).toContain(termsVersion);
      expect(html).toContain(legal[locale as 'ko' | 'en'][path].effective);
      expect(html).toContain(legal[locale as 'ko' | 'en'][path].sections[0]?.heading ?? '');
    }
  });
});
