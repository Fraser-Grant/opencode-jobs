# Contributing

## Source of truth

[`Fraser-Grant/opencode-jobs`](https://github.com/Fraser-Grant/opencode-jobs)
is the authoritative repository. The copy under
`codeagentconfig/packagedPlugins/opencode-jobs` is a downstream mirror for
local integration and should not receive independent feature commits.

After a standalone change lands, synchronize the mirror from the
`codeagentconfig` root:

```sh
mirror=$(git subtree split --prefix=packagedPlugins/opencode-jobs HEAD)
git fetch git@github.com:Fraser-Grant/opencode-jobs.git main
git diff --binary "$mirror" FETCH_HEAD | \
  git apply --directory=packagedPlugins/opencode-jobs
```

Review and commit the resulting mirror changes in `codeagentconfig`. The split
SHA only supplies the current directory tree; it does not need to share commit
history with standalone `main`.

## Changes

1. Open or reference a GitHub issue for behavior changes that need design or
   coordination.
2. Keep each pull request focused on one outcome.
3. Run `npm run check` and `npm run smoke` before requesting review.
4. Use Conventional Commit titles because Release Please derives versions and
   changelog entries from them:
   - `fix:` for a patch release.
   - `feat:` for a minor release.
   - `feat!:` or a `BREAKING CHANGE:` footer for a major release.
   - `docs:`, `test:`, `refactor:`, and `chore:` for changes that do not need a
     release on their own.

## Releases

Release Please maintains a release pull request containing the version bump
and `CHANGELOG.md`. Merging that pull request creates the GitHub release and
tag, reruns the full quality gate, and publishes the exact package to npm.

The npm package should trust the GitHub Actions publisher with:

- Owner: `Fraser-Grant`
- Repository: `opencode-jobs`
- Workflow: `release.yml`
- Allowed action: `npm publish`

Trusted publishing requires no long-lived npm credential. `NPM_TOKEN` remains
an optional fallback until OIDC publishing has completed successfully once.

Release Please uses `GITHUB_TOKEN` by default. Add a fine-grained
`RELEASE_PLEASE_TOKEN` secret if release pull requests must trigger other
workflows automatically; GitHub suppresses events created by `GITHUB_TOKEN`.
