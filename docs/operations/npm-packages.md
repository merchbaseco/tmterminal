---
summary: Defines synchronized Trademark Terminal CLI and HTTP client versioning, changelog, and npm publishing from the production deploy.
read_when:
  - preparing or publishing a Trademark Terminal CLI or HTTP client release
  - changing package versions, npm metadata, release tags, or changelog policy
---

# npm Packages

Release `@tmterminal/http-client` and `@tmterminal/cli` at one
shared `X.Y.Z`. Changing a package means bumping its version in the same PR.

## Changelog

Update `packages/cli/CHANGELOG.md` only during release preparation. Do not keep
an Unreleased section. The first entry is `## vX.Y.Z - YYYY-MM-DD` and describes
customer outcomes rather than implementation details.

## Prepare

1. Set the same version in both package manifests.
2. Add the dated changelog entry.
3. Run `bun install` when package metadata or dependencies changed.
4. Run `bun run release:check`.

The release check verifies synchronized versions, the top changelog entry,
package builds, client and CLI tests, and both publishable tarballs.

## Commit

Commit the release metadata and merge it to `main`. The deploy publishes from
that commit. Do not push a `cli-vX.Y.Z` tag.

## Publish

After a production deploy, the shared workflow publishes each package whose
version is missing on npm. `@tmterminal/http-client` goes first, then
`@tmterminal/cli`. The repo is public, so publish uses provenance. The
workflow reads `MERCHBASE_NPM_PUBLISH_TOKEN` through the release client.
`.npmrc` references that token. It does not republish an existing version.
It then pushes `vX.Y.Z`.

The workflow does not open a GitHub Release. A clean global install whose
`tt --version`, help, and authenticated status command work outside the
repository is still the operator's check.
