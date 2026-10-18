// Bindings and secrets of the API Worker (SDD §10). Secrets come from Wrangler secrets
// in production and from .dev.vars locally; nothing here is ever committed with a value.
export interface Env {
  // vars
  API_URL: string;
  ACCOUNT_URL: string;
  // The hub stairno.com, whose account menu reads the session (FR-80).
  HUB_URL: string;
  // Parent domain shared by account and api for the session cookie (FR-10). Empty locally.
  COOKIE_DOMAIN: string;
  // test, live or off (FR-42). Anything else, or unset, means off.
  PAYMENTS_MODE?: string;
  // secrets
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  // Unset locally and until the stairno.com domain is verified in Resend: mail is skipped.
  RESEND_API_KEY?: string;
  // Toss secret key, test_sk_... until business registration (FR-43). Unset means Toss is off.
  TOSS_SECRET_KEY?: string;
  // PayPal REST app (sandbox until business registration) and its webhook's id (FR-49, FR-52)
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
}
