# Contributing

This is a one-person project that runs like a team, on Git Flow: issue → feature branch → failing test → implementation → `develop`; when a roadmap step is done, a release branch → pull request → CI → `main`, which deploys. The rules match the hub's ([stairno.com](https://github.com/seren-wib/stairno.com)) CONTRIBUTING.md, plus what only this repository has (two workspaces, migrations, secrets).

## Branches (Git Flow)

| Branch                      | Lifetime  | Role                                                | From      | Merges into          |
| --------------------------- | --------- | --------------------------------------------------- | --------- | -------------------- |
| `main`                      | Permanent | What is released. A merge into it deploys           | —         | —                    |
| `develop`                   | Permanent | The next release being built. The default branch    | `main`    | —                    |
| `feature/<issue>-<summary>` | One task  | One feature                                         | `develop` | `develop`            |
| `release/vX.Y.Z`            | One step  | Preparing this release: fixes and docs, no features | `develop` | `main` and `develop` |
| `hotfix/vX.Y.Z`             | One fix   | A bug in the released version                       | `main`    | `main` and `develop` |

- `main` changes only through pull requests from `release/*` or `hotfix/*`. CI must pass, and the merge is a merge commit, so `main` and `develop` keep one history
- `develop` takes direct pushes for documents and small changes. A feature goes through its own branch and a pull request into `develop`, which does not wait for CI; the pull request is the record. Run the local checks (see Tests) before pushing anything to `develop`
- Release: once per roadmap step. When every feature of the step is on `develop`, branch `release/v0.N.0` (N is the step) from `develop` and open a pull request into `main`. Fix only what CI or the final check finds, merge, tag `v0.N.0` on the merge commit, then merge `main` back into `develop`. The rehearsal and the acceptance checklist run on production in test mode right after the deploy
- Hotfix: branch `hotfix/vX.Y.Z` (the next patch) from `main`, open a pull request into `main`, merge, tag, then merge `main` back into `develop`
- Versions follow semver: MINOR is the roadmap step (step 4 is `v0.4.0`), a hotfix raises PATCH
- One task, one issue, one branch. Example: `feature/185-payment-mails`
- A task is one feature a user can use: its API, screen, tests and document updates go in together, so the feature can be checked as a whole
- Something that only serves that feature, such as an adapter or a small fix found on the way, goes in as commits of the same branch. Only a change that stands on its own or touches other features gets its own branch
- As a size guide, 300 to 800 changed lines including tests. Past 1000, look for a place to split
- There is never more than one open pull request into `main`

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

Each slice of a feature is a `test` → `feat` pair, committed in that order. A move or clean-up that keeps behaviour is its own `refactor` commit, before the pair it prepares. Each commit should be small enough to revert on its own:

```
refactor(api): share the payment JSON between routes
test(api): add failing cases for receipts
feat(api): send a receipt when an order is paid
test(api): add failing cases for the renewal failure mail
feat(api): tell the buyer when a renewal is declined
```

## Pull requests

- The title uses the commit format. The body links the issue (`Closes #1`) and says why, how it was checked and which requirement IDs it covers
- CI runs on pull requests into `main`: formatting, type checks, tests, builds, the migration check (`verify`) and the end-to-end tests on the Workers runtime (`e2e`). The `main` ruleset requires both. Every push to `develop` runs the same CI for information; nothing waits for it
- Feature pull requests into `develop` are rebase merges, so every commit lands as it is and must follow the commit rules above. Release and hotfix pull requests into `main` are merge commits
- Delete the branch right after merging

## Releases

- A merge into `main` deploys through the deploy workflow: it runs the tests once more, migrates, then deploys the API and the account center. The workflow can also be run by hand
- The release tag `vX.Y.Z` goes on the merge commit in `main`

## Tests

Testing happens in layers, each wider than the one before:

1. Every commit, locally: the failing test first, then the code that passes it
2. Every push to `develop`: the full CI, for information. A failure is fixed before the next feature starts
3. The release pull request into `main`: the full CI, required
4. The deploy: the tests once more before migrating
5. Production in test mode: the rehearsal and the acceptance checklist. Provider webhooks and return addresses only reach production

- Every feature starts with a failing test. Test names start with the requirement ID, for example `FR-36 rejects paid -> pending`
- Payment providers are replaced by a fake adapter in tests. Real test-key calls happen only in deployment rehearsals (NFR-16)
- Integration tests run on PGlite, an in-memory PostgreSQL, so CI needs no secrets
- `npm test` runs every workspace; `npm run test:e2e` needs the containers in `e2e/compose.yml`
- Before pushing, run the test files you changed together with `npm run format:check`, `npm run check` and `npm run db:check`. The full suite runs in CI (`verify`) on every push to `develop` and every pull request into `main`

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
