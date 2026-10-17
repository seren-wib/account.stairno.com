// Bindings and secrets of the API Worker (SDD §10). Secrets come from Wrangler secrets
// in production and from .dev.vars locally; nothing here is ever committed with a value.
export interface Env {
  // secrets
  DATABASE_URL: string;
}
