---
name: release-trademark-terminal
description: Cut a Trademark Terminal product release. Bumps VERSION, updates CHANGELOG.md, opens a PR to main, and leaves deploy to GitHub Actions. After deploy, creates GitHub Release vX.Y.Z. Does not publish npm. Use for /release, ship, or cut a release.
---

# Release Trademark Terminal

GitHub Actions owns deploy. This skill bumps `VERSION`, writes the changelog,
and opens the PR. Do not SSH to the Mac mini. Do not run `bun run deploy` from
a laptop. Do not dispatch `Deploy Stack` unless the operator asks for a
redeploy of current `main`.

## Steps

1. `git fetch origin main` and work from a branch off current `main`.
2. Read `VERSION`. Bump it as semver (`MAJOR.MINOR.PATCH`). Patch for fixes,
   minor for additive product work, major for a breaking caller or website
   contract. Do not bump `@tmterminal/cli` or `@tmterminal/http-client` here.
   Those packages share their own clock and `release:check` path. A product
   `1.0.0` and a CLI `4.0.0` are correct.
3. Collect Conventional Commits on `main` since the last dated version heading
   in `CHANGELOG.md`.
4. Move those bullets from `## Unreleased` into a new `## X.Y.Z - YYYY-MM-DD`
   heading (UTC date). Keep `## Unreleased` at the top, empty. Group by type
   when it helps (`feat`, `fix`, `docs`). Skip chore-only noise.
5. Commit as `release: vX.Y.Z`.
6. Push and open a PR to `main`. Title: `release: vX.Y.Z`. Body lists the
   changelog heading and says merge deploys because `VERSION` changed.
7. Stop. The operator merges. The `VERSION` change on `main` runs Quality
   (including the full `check` preflight) then the Mac mini deploy job.

## After merge

The Actions run is the deploy. If it fails, fix forward or re-dispatch
`Deploy Stack` on `main`. Rollback is still a known-good revert PR, not a
laptop compose rebuild.

After deploy succeeds, run `./scripts/create-product-release`. That tags
`vX.Y.Z` from `VERSION` and opens a GitHub Release from the matching
`CHANGELOG.md` heading. Title is `Trademark Terminal vX.Y.Z`. It does not
create `cli-v*` tags and does not publish npm.

## Out of scope

- npm package publishes (`docs/operations/npm-packages.md`)
- Editing production secrets
- Importing a USPTO source ZIP
