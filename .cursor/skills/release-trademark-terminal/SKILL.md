---
name: release-trademark-terminal
description: Cut a Trademark Terminal release. Updates CHANGELOG.md, opens a PR to main, and leaves deploy to GitHub Actions. Use for /release, ship, or cut a release.
---

# Release Trademark Terminal

GitHub Actions owns deploy. This skill writes the changelog and opens the PR.
Do not SSH to the Mac mini. Do not run `bun run deploy` from a laptop. Do not
dispatch `Deploy Stack` unless the operator asks for a redeploy of current
`main`.

## Steps

1. `git fetch origin main` and work from a branch off current `main`.
2. Collect Conventional Commits on `main` since the last dated heading in
   `CHANGELOG.md`. If the file has only `Unreleased`, take commits since that
   file was added.
3. Move those bullets from `## Unreleased` into a new `## YYYY-MM-DD` heading
   (UTC date). Keep `## Unreleased` at the top, empty. Group by type when it
   helps (`feat`, `fix`, `docs`). Skip chore-only noise.
4. Do not bump `@tmterminal/cli` or `@tmterminal/http-client` versions here.
   Package versions have their own `release:check` path.
5. Commit as `docs: record the YYYY-MM-DD release`.
6. Push and open a PR to `main`. Title: `release: YYYY-MM-DD`. Body lists the
   changelog heading and says merge deploys via `.github/workflows/deploy.yml`.
7. Stop. The operator merges. Push to `main` runs Quality (including the full
   `check` preflight) then the Mac mini deploy job.

## After merge

The Actions run is the release. If it fails, fix forward or re-dispatch
`Deploy Stack` on `main`. Rollback is still a known-good revert PR, not a
laptop compose rebuild.

## Out of scope

- USPTO source repair (`bun run source:repair` remains a private command)
- npm package publishes
- Editing production secrets
