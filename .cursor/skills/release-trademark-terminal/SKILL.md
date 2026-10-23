---
name: release-trademark-terminal
description: Cut a Trademark Terminal release. Bumps VERSION, updates CHANGELOG.md, opens a PR to main, and leaves deploy to GitHub Actions. Use for /release, ship, or cut a release.
---

# Release Trademark Terminal

GitHub Actions owns deploy. Every push to `main` deploys after Quality
succeeds for that commit. This skill bumps `VERSION` and writes the
changelog. It does not publish npm packages, and `VERSION` does not select
the deploy.

Do not SSH to the Mac mini. Do not run `bun run deploy` from a laptop. Do not
dispatch `Deploy Stack` unless the operator asks for a redeploy or a
rollback. A dispatch `ref` is a SHA on `main`.

## Steps

1. `git fetch origin main` and work from a branch off current `main`.
2. Read `VERSION`. Bump it as semver (`MAJOR.MINOR.PATCH`). Patch for fixes,
   minor for additive product work, major for a breaking caller or website
   contract. Do not bump `@tmterminal/cli` or `@tmterminal/http-client` here.
   Package versions have their own `release:check` path. Changing a package
   means bumping its version in the same PR.
3. Collect Conventional Commits on `main` since the last dated version heading
   in `CHANGELOG.md`.
4. Move those bullets from `## Unreleased` into a new `## X.Y.Z - YYYY-MM-DD`
   heading (UTC date). Keep `## Unreleased` at the top, empty. Group by type
   when it helps (`feat`, `fix`, `docs`). Skip chore-only noise.
5. Commit as `release: vX.Y.Z`.
6. Push and open a PR to `main`. Title: `release: vX.Y.Z`. Body lists the
   changelog heading. Merging deploys this commit after Quality, the same as
   any other merge to `main`.
7. Stop. The operator merges.

## After merge

The Actions run is the deploy. If it fails, fix forward or dispatch `Deploy
Stack` with the SHA. Rollback is a dispatch `ref` of a known-good SHA on
`main`, or a revert commit. Not a laptop compose rebuild.

## Out of scope

- npm package publishes
- Editing production secrets
- Importing a USPTO source ZIP
