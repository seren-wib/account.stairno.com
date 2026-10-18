# Payment rehearsal site

Roadmap step 4 (payments in test mode) closes only after its acceptance checklist passes on production. Orders need a site: the site's own client_credentials token, the buyer's access token in `X-User-Token`, and an https `returnUrl` on the site's origin. The step-5 sites come later, so this throwaway Worker stands in for one. It is kept and run again after any release that changes a payment path.

The steps, what each checks and who does what are in **`docs/specs/test-deploy.md` §8.4** ([shared copy](https://docs.google.com/document/d/1izJ7KAlia6LIA5oOHP8XjUKz_uZWJFR5q9Utyfg_1ZY/edit)). This README only covers the tool.

## What it does

One unstyled page on `*.workers.dev`, connected to `https://api.stairno.com` like any Stairno site. The API has no rehearsal route or exception.

| Button | Calls | Rehearsal step |
| --- | --- | --- |
| Sign in with Stairno | OIDC authorization code + PKCE (S256) at `/auth`, `resource=https://api.stairno.com` | all |
| Order in KRW (Toss) | `POST /v1/orders`, then Toss's payment window (SDK v2) with `TOSS_CLIENT_KEY` | 1, 2, 10 |
| Confirm / Confirm with the tampered amount | `POST /v1/payments/toss/confirm` with Toss's amount, or half of it | 1, 2 |
| Order in USD (PayPal) | `POST /v1/orders`, `POST /v1/payments/paypal/orders`, redirect to PayPal | 7 |
| Capture | `POST /v1/payments/paypal/capture` | 7 |
| Start the subscription | `POST /v1/orders` for `rehearsal-monthly` (charged at once on the default card) | 5 |
| Look up the order | `GET /v1/orders/{id}` with the site token | all |
| Entitlement for … | `GET /v1/entitlements?sku=` with the buyer's token | 1, 3, 5, 6, 7 |

- Every commerce call carries the site token (`grant_type=client_credentials`, `scope=commerce`, `resource=https://api.stairno.com`, kept per isolate until a minute before it expires) and, for orders, the buyer's token in `X-User-Token`.
- Cancel and resume: the API accepts them only from the account center's own session, so the page links there instead of calling them.
- Cards, refund requests and receipts live in the account center too; the page links to it.
- No input takes card data (DR-4). Toss's window takes the test card; PayPal takes its sandbox login.
- `TOSS_CLIENT_KEY` must be a `test_ck_` key: the shop's own API key whose pair is the API Worker's `TOSS_SECRET_KEY` (#159). The shared docs keys (`test_gck_docs…`) pay into another shop, so its webhooks never reach the API; the page refuses them.
- The sign-in state and the buyer's token live in `HttpOnly`, `Secure`, `SameSite=Lax` cookies sealed with AES-GCM under a key derived from the client secret. Nothing is logged but error messages.

## Settings

| Name | Where | Value |
| --- | --- | --- |
| `API_URL` | `wrangler.toml` | `https://api.stairno.com` |
| `ACCOUNT_URL` | `wrangler.toml` | `https://account.stairno.com` |
| `CLIENT_ID` | Wrangler secret | from the client registration |
| `CLIENT_SECRET` | Wrangler secret | from the client registration. Only here: never in the repository, this README or a chat |
| `TOSS_CLIENT_KEY` | Wrangler secret | the shop's `test_ck_` client key |

## Run order

Run `npm ci` at the repository root first: the scripts here use its `wrangler`. Commands below run in this folder unless they say `apps/api`.

1. Deploy. The page answers "Not configured" until the secrets are in.

   ```bash
   npm run deploy
   ```

   The address is `https://stairno-payment-rehearsal.<workers subdomain>.workers.dev`.

2. Register the client (test-deploy §8.1, operator sign-in). In `apps/api`, with the production `DATABASE_URL`, `BETTER_AUTH_SECRET`, `API_URL` and `ACCOUNT_URL` in the shell:

   ```bash
   ../../node_modules/.bin/tsx scripts/register-client.ts --name "Stairno Rehearsal" --redirect-uri https://stairno-payment-rehearsal.<workers subdomain>.workers.dev/callback
   ```

   The API reads the site's origin from this redirect URI, which is what makes the tool's return addresses acceptable.

3. Put the three secrets. Each command asks for the value.

   ```bash
   npm run wrangler -- secret put CLIENT_ID
   ```

   ```bash
   npm run wrangler -- secret put CLIENT_SECRET
   ```

   ```bash
   npm run wrangler -- secret put TOSS_CLIENT_KEY
   ```

4. Add the two products to that `client_id` (test-deploy §8.1). In `apps/api`, with the production `DATABASE_URL`:

   ```bash
   ../../node_modules/.bin/tsx scripts/add-product.ts --sku rehearsal-once --client-id <client_id> --name-ko "리허설 일회 상품" --name-en "Rehearsal one-time item" --kind one_time --price KRW:1000 --price USD:100
   ```

   ```bash
   ../../node_modules/.bin/tsx scripts/add-product.ts --sku rehearsal-monthly --client-id <client_id> --name-ko "리허설 월 구독" --name-en "Rehearsal monthly plan" --kind subscription --interval month --price KRW:1000
   ```

5. Check the webhooks and the account as in §8.4 "준비", then open the page, sign in and follow the §8.4 table.

## Tests

```bash
npm test
```

Node's own test runner (`node:test`), no dependencies. The cases drive the Worker's handler against a fake API and OIDC provider: PKCE and state, the token requests, the headers and bodies of every API call, the Toss key check, the PayPal round trip, escaping, and the sealed cookies.
