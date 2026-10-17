declare namespace App {
  interface Locals {
    // Set by the session guard on pages that need sign-in (FR-12).
    user?: import('./lib/session-guard').SessionUser;
  }
}

// Worker bindings from wrangler.jsonc.
declare module 'cloudflare:workers' {
  export const env: {
    PUBLIC_API_URL: string;
  };
}
