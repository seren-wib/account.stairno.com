import type { AstroIntegration } from 'astro';

// Pages that must answer outside /ko and /en. Astro's i18n routing (prefixDefaultLocale) turns
// every other page there into a 404 after it renders; routes injected by an integration are the
// one exception. /sign-in is the OIDC provider's login page (SDD §4), which carries no locale.
const routes = [{ pattern: '/sign-in', entrypoint: './src/routes/sign-in.astro' }];

export function unprefixedRoutes(): AstroIntegration {
  return {
    name: 'stairno:unprefixed-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const route of routes) injectRoute(route);
      },
    },
  };
}
