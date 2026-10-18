# account.stairno.com

[**Quickstart**](#quickstart) | [**How it works**](#how-it-works) | [**Configuration**](#configuration) | [**Commands**](#commands) | [**FAQ**](#faq)

**account.stairno.com** is **one Stairno account for every Stairno site and product**: the account center at `account.stairno.com` and the shared API at `api.stairno.com`. Sites never build their own sign-in; they **sign people in through the API's OpenID Connect provider** and read the user from it. Two Cloudflare Workers (Hono + Better Auth for the API, Astro for the screens), PostgreSQL on Neon, mail through Resend. Phase 1 is sign-in; phase 2 adds payments in test mode.

![GitHub Repo stars](https://img.shields.io/github/stars/seren-wib/account.stairno.com?style=social)
[![ci](https://github.com/seren-wib/account.stairno.com/actions/workflows/ci.yml/badge.svg)](https://github.com/seren-wib/account.stairno.com/actions/workflows/ci.yml)
[![deploy](https://github.com/seren-wib/account.stairno.com/actions/workflows/deploy.yml/badge.svg)](https://github.com/seren-wib/account.stairno.com/actions/workflows/deploy.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#requirements)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](#how-it-works)
[![OpenID Connect](https://img.shields.io/badge/OpenID%20Connect-provider-2D3748.svg)](#how-it-works)
[![Languages](https://img.shields.io/badge/languages-ko%20%7C%20en-blue.svg)](#how-it-works)

## Updates

- [2026/10/18] **Phase 1 (sign-in) implemented.** Sign-up with email verification, sign-in, password reset, profile and email change, signed-in devices, connected sites, account deletion, OIDC provider for Stairno sites, terms and privacy pages, rate limits, CSP. Deployment workflow and custom domains in place; first public deployment pending.

## Star History

<a href="https://star-history.com/#seren-wib/account.stairno.com&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=seren-wib/account.stairno.com&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=seren-wib/account.stairno.com&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=seren-wib/account.stairno.com&type=Date" />
  </picture>
</a>

## Table of Contents

- [Why](#why)
- [Quickstart](#quickstart)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Commands](#commands)
- [Examples](#examples)
- [Privacy and security](#privacy-and-security)
- [FAQ](#faq)
- [Contribution](#contribution)
- [License](#license)

## Why

Stairno runs several sites on different domains (Works, Games, Labs). Without a shared account:

- every site builds its own sign-up, password reset and session handling, and gets one of them subtly wrong
- a person ends up with a separate account and password per site
- cookies cannot be shared across domains, so "already signed in" does not carry over

account.stairno.com does this once:

- **One account, one place to manage it.** The account center handles sign-up, email verification, password reset, profile, signed-in devices, connected sites and deleting the account.
- **Sign-in for other domains through OpenID Connect.** Sites are OIDC clients of the API (authorization code flow with PKCE). A person signed in at the account center lands back on the site without typing a password again.
- **One API for site servers.** `GET /v1/me` works with the account center's session cookie or a site's Bearer access token (a JWT the API can verify on its own).

## Quickstart

### Requirements

- **Node.js 22** or newer, **npm**, **Git**
- **Docker** (a local PostgreSQL plus the Neon HTTP proxy, so the API runs with its production database driver)
- `openssl` for generating a secret (Git Bash and macOS have it)

### 1. Clone and install

```bash
git clone https://github.com/seren-wib/account.stairno.com.git
cd account.stairno.com
npm ci
```

On Windows, keep the clone on a short path such as `C:\Users\<you>\projects\account.stairno.com`. A deep path breaks the local Workers runtime (see [FAQ 1](#1-unable-to-open-database-file-sqlite_cantopen-when-running-npm-run-dev)).

### 2. Start the local database

```bash
docker compose -f e2e/compose.yml up -d --wait
```

This runs PostgreSQL 17 on port 5432 and the Neon HTTP proxy on port 4444. The host `db.localtest.me` resolves to `127.0.0.1`.

### 3. Create the local settings

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/account/.dev.vars.example apps/account/.dev.vars
```

Then put a generated value into `BETTER_AUTH_SECRET` in `apps/api/.dev.vars`:

```bash
openssl rand -base64 32
```

> [!IMPORTANT]
> `.dev.vars` files are ignored by git and stay on your machine. Never put production values (the Neon connection string, the production `BETTER_AUTH_SECRET`, a live Resend key) in them or anywhere in the repository.

### 4. Create the tables

```bash
DATABASE_URL=postgres://postgres:postgres@db.localtest.me:5432/main npm run db:migrate --workspace apps/api
```

In Windows PowerShell:

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@db.localtest.me:5432/main"
npm.cmd run db:migrate --workspace apps/api
```

### 5. Run both Workers

In two terminals:

```bash
npm run dev
```

```bash
npm run dev --workspace apps/account
```

The API listens on `http://localhost:8787`, the account center on `http://localhost:4321`.

### 6. Check it

```bash
curl -s localhost:8787/health
curl -s localhost:8787/auth/.well-known/openid-configuration | grep -o '"issuer":"[^"]*"'
curl -sI localhost:4321/en/sign-up | head -1
```

<p align="center"><img src="docs/images/quickstart-check.svg" alt="Terminal: the health check answers status ok, the discovery document names the issuer http://localhost:8787/auth, and the sign-up page answers HTTP 200" width="860"></p>

Open `http://localhost:4321/en/sign-up` and create an account. Without `RESEND_API_KEY` no mail is sent; the API logs `mail skipped` and records the mail as `skipped` in the `mail_log` table, and you can sign in right away.

## How it works

<p align="center"><img src="docs/images/architecture.svg" alt="Architecture: the browser uses the account center and calls the API; the account center server checks the session with the API; the API stores data in Neon and sends mail through Resend; Stairno sites sign people in through the API's OpenID Connect provider" width="860"></p>

A few details:

- **One repository, two Workers.** `apps/api` is `api.stairno.com` (Hono, Better Auth, Drizzle); `apps/account` is `account.stairno.com` (Astro server rendering with `@stairno/ui`). `packages/contract` holds the zod schemas and constants both use.
- **Only the API touches the database.** The account center never imports Better Auth or Drizzle; its server forwards the visitor's `Cookie` header to the API to check the session and read data.
- **Sessions are shared within stairno.com.** The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax` with `Domain=stairno.com`, so the account center and the API see the same session.
- **Other domains use OIDC.** Sites are registered by an operator command (`npm run admin:register-client --workspace apps/api`), skip the consent screen as first-party clients, and get an ID token with `sub`, `email`, `email_verified`, `name`, `locale`. Access tokens are one-hour JWTs for `https://api.stairno.com`; refresh tokens rotate and last 90 days.
- **Deployment.** On every push to `main`, `.github/workflows/deploy.yml` tests, applies the Neon migrations, then deploys the API and the account center, in that order.

The design documents are written in Korean and kept as Google Docs. Requirement IDs such as `FR-3` in test names and pull requests refer to the requirements document.

| Document               | Google Docs                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Project plan           | [link](https://docs.google.com/document/d/1i9pkvCHo0XkBrcU8o8s-5u_3zz8CpeKMzTJ01olrLi8/edit) |
| Requirements (SRS)     | [link](https://docs.google.com/document/d/1-NKMcjcKf-ESB95-M6DhpTrbwxn0qYVAJy9A-q1d0N8/edit) |
| Design (SDD)           | [link](https://docs.google.com/document/d/1tEYwmJwJ6aDq26tzZ781eF_1wd9-DxVf9Smeh1Px8cY/edit) |
| Testing and deployment | [link](https://docs.google.com/document/d/1izJ7KAlia6LIA5oOHP8XjUKz_uZWJFR5q9Utyfg_1ZY/edit) |

## Configuration

API Worker (`apps/api/.dev.vars` locally, Wrangler vars and secrets in production):

- **`DATABASE_URL`** (secret): PostgreSQL connection string. Neon in production, the local proxy host `db.localtest.me` in development.
- **`BETTER_AUTH_SECRET`** (secret): signs sessions and encrypts the signing keys. Changing it invalidates existing sessions and keys.
- **`RESEND_API_KEY`** (secret, optional): without it mail is skipped and recorded as `skipped`.
- **`API_URL`**, **`ACCOUNT_URL`**: public URLs of the two Workers. They set the OIDC issuer, the trusted origin and the links in mail.
- **`COOKIE_DOMAIN`**: `stairno.com` in production, empty locally (host-only cookie).

Account center Worker (`apps/account/.dev.vars` locally, `wrangler.jsonc` in production):

- **`PUBLIC_API_URL`**: where the account center finds the API.

Deployment (GitHub Actions secrets; the deploy steps are skipped until all three exist):

- **`CLOUDFLARE_API_TOKEN`**, **`CLOUDFLARE_ACCOUNT_ID`**: deploy both Workers.
- **`NEON_DATABASE_URL`**: the migration step's database.

## Commands

| Command                                                                           | What it does                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                                                                     | API Worker on `localhost:8787` (Wrangler)                          |
| `npm run dev --workspace apps/account`                                            | Account center on `localhost:4321` (Astro)                         |
| `npm test`                                                                        | Unit, integration (PGlite) and screen tests of every workspace     |
| `npm run test:e2e`                                                                | End-to-end tests on the Workers runtime; needs step 2's containers |
| `npm run check`                                                                   | Type checks (`tsc`, `astro check`)                                 |
| `npm run format` / `npm run format:check`                                         | Prettier                                                           |
| `npm run db:check`                                                                | The Drizzle schema matches the committed migrations                |
| `npm run db:generate --workspace apps/api`                                        | New migration from schema changes                                  |
| `npm run db:migrate --workspace apps/api`                                         | Apply migrations to `DATABASE_URL`                                 |
| `npm run admin:register-client --workspace apps/api -- --name … --redirect-uri …` | Register a site as an OIDC client (prints its secret once)         |

## Examples

<details><summary><b>Register a site and sign in from it</b></summary>

With the production values of `DATABASE_URL`, `BETTER_AUTH_SECRET`, `API_URL` and `ACCOUNT_URL` in your shell:

```bash
npm run admin:register-client --workspace apps/api -- --name "Stairno Labs" \
  --redirect-uri https://stairnolabs.com/api/auth/oauth2/callback/stairno
```

The command asks for an operator account's email and password, registers the site and prints `client_id` and `client_secret` once. The secret goes into the site's own secrets and nowhere else. The site then points its OIDC client at `https://api.stairno.com/auth/.well-known/openid-configuration` and requests `openid profile email`, adding `offline_access` for refresh tokens and `resource=https://api.stairno.com` for an API access token.

</details>

<details><summary><b>Reproduce the cross-domain sign-in experiment</b></summary>

Before the design, an experiment checked whether a Stairno account can sign people in on another domain with Better Auth. Result: not by sharing cookies, but with the account server as an OIDC provider; 13 of 13 steps passed.

```bash
cd experiments/cross-domain-login
npm ci
npm start
```

Run it again after upgrading Better Auth.

</details>

## Privacy and security

- Passwords are stored only as scrypt hashes, and passwords known from data breaches are refused at sign-up and reset.
- Sign-in, sign-up, password reset and mail resend are rate-limited per client address. All API responses carry HSTS, `nosniff` and a strict referrer policy; the account center sends a Content Security Policy with script hashes.
- Logs carry no email addresses or tokens. CORS is limited to the account center and registered sites.
- What is collected and why is in the privacy policy at `/en/privacy` (Korean governs at `/ko/privacy`).

Please report security issues privately to contact@stairno.com rather than in a public issue.

## FAQ

### 1. `unable to open database file: SQLITE_CANTOPEN` when running `npm run dev`

The local Workers runtime keeps its state under `.wrangler/` in each app, and on Windows the full path then passes the 260-character limit. Move the clone to a short path and start again:

```bash
rm -rf apps/api/.wrangler apps/account/.wrangler
```

### 2. `npx : File ... npx.ps1 cannot be loaded because running scripts is disabled on this system`

Windows PowerShell blocks the `.ps1` shims. Use the `.cmd` versions, which are not affected:

```powershell
npm.cmd run dev
npx.cmd wrangler --version
```

### 3. `Failed to decrypt private key` from the API

The database holds signing keys encrypted with a different `BETTER_AUTH_SECRET`, for example after changing the secret in `.dev.vars`. Locally, delete the keys and they are created again:

```bash
docker exec stairno-account-e2e-postgres-1 psql -U postgres -d main -c "delete from jwks;"
```

In production, never change `BETTER_AUTH_SECRET` casually; it also signs out everyone.

### 4. Sign-in or sign-up fails after pulling new changes

A new migration has not been applied. Run step 4 again; the deploy workflow does this in production.

### 5. `npm run db:migrate` prints the driver line and then nothing

On some terminals drizzle-kit's progress output does not show. Check the result instead:

```bash
docker exec stairno-account-e2e-postgres-1 psql -U postgres -d main -c "\dt"
```

## Contribution

Bug reports and questions are welcome as GitHub issues. The workflow (one issue and one pull request per change, tests first, rebase merges) is in [CONTRIBUTING.md](CONTRIBUTING.md). If this helped you build shared sign-in on Workers, a star is appreciated.

## License

No license has been chosen yet, so all rights are reserved.
