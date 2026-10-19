import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unprefixedRoutes } from '../../src/integrations/unprefixed-routes';

type Route = { pattern: string; entrypoint: string };

function injected() {
  const routes: Route[] = [];
  const hook = unprefixedRoutes().hooks['astro:config:setup'] as unknown as (options: {
    injectRoute: (route: Route) => void;
  }) => void;
  hook({ injectRoute: (route) => routes.push(route) });
  return routes;
}

describe('unprefixed routes', () => {
  // Astro's i18n routing (prefixDefaultLocale) answers 404 for any page outside /ko and /en,
  // after the page has rendered. Only routes injected by an integration may live outside them.
  it('FR-17 injects /sign-in, the OIDC login page, outside the locale prefixes', () => {
    expect(injected().map((route) => route.pattern)).toEqual(['/sign-in']);
  });

  it('FR-17 points every injected route at a file that exists', () => {
    for (const route of injected()) {
      const file = fileURLToPath(new URL(`../../${route.entrypoint}`, import.meta.url));
      expect(existsSync(file), route.entrypoint).toBe(true);
    }
  });
});
