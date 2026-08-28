---
summary: Defines synchronized Trademark Terminal CLI and HTTP client versioning, changelog, verification, tagging, npm publishing, and GitHub release steps.
read_when:
  - preparing or publishing a Trademark Terminal CLI or HTTP client release
  - changing package versions, npm metadata, release tags, or changelog policy
---

# npm Packages

Release `@tmterminal/http-client` and `@tmterminal/cli` at one
shared `X.Y.Z`. The CLI tag `cli-vX.Y.Z` is the release boundary.

Product version is a different clock. `VERSION`, the website footer, the
deploy gate, and GitHub tag `vX.Y.Z` move when the running service changes.
Do not bump these packages to match `VERSION`, and do not bump `VERSION` to
match these packages. `bun run release:check` syncs the two packages only.

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

## Commit and Tag

Commit the release metadata, create annotated tag `cli-vX.Y.Z`, then push
`main` and the tag. Never publish an unpushed release commit.

## Publish

Publishing uses the suite-wide `MERCHBASE_NPM_PUBLISH_TOKEN`, an `@internal`
schema item gated behind the release switch. Fetch it and pass it directly
through npm's registry auth option; exporting it alone is insufficient:

```bash
npm publish --//registry.npmjs.org/:_authToken="$(TMTERMINAL_RESOLVE_RELEASE_TOKENS=true bunx varlock printenv MERCHBASE_NPM_PUBLISH_TOKEN)"
```

Publish `@tmterminal/http-client` first. Confirm its registry version, then
publish `@tmterminal/cli` and confirm that version. Never republish
an existing version.

## GitHub Release

Create a GitHub Release from `cli-vX.Y.Z`. Use the matching changelog entry as
the release notes and title it `Trademark Terminal CLI vX.Y.Z`. Pass
`--latest=false` so the product Release `vX.Y.Z` stays Latest.

Final acceptance requires the two npm registry versions, the GitHub Release,
and a clean global install whose `tt --version`, help, and authenticated status
command work outside the repository.
