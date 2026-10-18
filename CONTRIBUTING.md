# Contributing

This is a one-person project that runs like a team: issue → branch → failing test → implementation → pull request → CI → merge. The rules match the hub's ([stairno.com](https://github.com/seren-wib/stairno.com)) CONTRIBUTING.md, plus what only this repository has (two workspaces, migrations, secrets).

## Branches

| Branch                      | Lifetime  | Role                                    | From   | Merges into |
| --------------------------- | --------- | --------------------------------------- | ------ | ----------- |
| `main`                      | Permanent | What is deployed. A merge is a release. | —      | —           |
| `feature/<issue>-<summary>` | One task  | A single piece of work                  | `main` | `main`      |

- There are no `develop` or `release` branches
- Nothing is committed to `main` directly. Every change goes through a pull request
- One task, one issue, one branch, one pull request. Example: `feature/1-account-specs`
- A task is one feature or concern. Documentation, workspace tooling, database wiring, auth wiring, screen skeletons, unit tests, end-to-end tests and CI each get their own issue and pull request. Do not bundle them
- Merge one pull request (and see it deployed) before opening the next. There is never more than one open pull request
- While a pull request waits for CI and its deployment, the next issue, branch and failing tests may be prepared locally

## Issues

- Open an issue before starting. The title uses the commit format (`feat: add billing key issuance`)
- The body states the scope, the related requirement IDs from the SRS and when it is done

## Commits: Conventional Commits

```
<type>(<scope>): <summary>
```

- `scope` is a workspace name (`api`, `account`, `contract`) or an area. Optional
- `summary` is English, imperative, lower case, no trailing period
- The body explains why the change was made. The diff already shows what changed

| type       | Use for                          |
| ---------- | -------------------------------- |
| `feat`     | New behaviour                    |
| `fix`      | Bug fixes                        |
| `test`     | Adding or changing tests         |
| `refactor` | Code changes that keep behaviour |
| `docs`     | Documentation                    |
| `style`    | Formatting only                  |
| `chore`    | Configuration, dependencies      |
| `ci`       | CI and deploy workflows          |

Test-driven work is committed in the same order:

```
test(api): add failing cases for order transitions
feat(api): implement order state machine
refactor(api): extract transition table
```

## Pull requests

- The title uses the commit format. The body links the issue (`Closes #1`) and says why, how it was checked and which requirement IDs it covers
- CI must pass before merging: formatting, type checks, tests, builds, the migration check (`verify`) and the end-to-end tests on the Workers runtime (`e2e`). The `main` ruleset requires both
- Merges are rebase merges, so every commit lands on `main` as it is and each one must follow the commit rules above
- Delete the feature branch right after merging

## Tests

- Every feature starts with a failing test. Test names start with the requirement ID, for example `FR-36 rejects paid -> pending`
- Payment providers are replaced by a fake adapter in tests. Real test-key calls happen only in deployment rehearsals (NFR-16)
- Integration tests run on PGlite, an in-memory PostgreSQL, so CI needs no secrets
- `npm test` runs every workspace; `npm run test:e2e` needs the containers in `e2e/compose.yml`
- Before pushing, run the test files you changed together with `npm run format:check`, `npm run check` and `npm run db:check`. The full suite runs in CI (`verify`)

## Database

- The Drizzle schema in `apps/api/src/db/schema/` is the source of truth. SQL is never edited by hand
- After a schema change, generate the migration with `drizzle-kit generate` and commit it in the same pull request
- Rolling back means a new migration

## Secrets

- Secrets live only in Wrangler secrets, GitHub Actions secrets and the local `.dev.vars`. Never in the repository, logs or pull request text
- Payment providers use test keys and sandboxes only. Switching to live keys follows the operations document

## Keeping documents in sync

Updating documents is part of the work. When code changes, the related document changes in the same pull request.

- Design changes go into `docs/specs/sdd.md`
- The markdown files in `docs/specs/` are the sources and change with each pull request. The shared Google Docs copies are brought up to date once per roadmap step, or before they are shown to anyone, by editing the same documents so their links stay
- Requirement changes go into `docs/specs/srs.md`; scope changes into the scope and decision log of `docs/specs/plan.md`
- After upgrading Better Auth, run `experiments/cross-domain-login` again and check all 13 steps pass
- Public documents (README.md, CONTRIBUTING.md) are written in English. The specifications and CLAUDE.md are in Korean

## Environment

- Work moves between Windows (Git Bash or PowerShell) and macOS. Never hard-code paths
- `.gitattributes` fixes line endings to LF. Leave `core.autocrlf` alone
- Node 22 or newer, as set by `engines` in the root `package.json`
