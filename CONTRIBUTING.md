# Contributing

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

## Tests

- `npm test` builds the package and runs the `node:test` integration suite.
- `npm run smoke` is the full behavioral gate: generated POSIX scripts,
  systemd unit verification, CLI installation, built-plugin tools, and the
  fake-systemd lifecycle tests.
- Integration tests use temporary projects, an isolated `XDG_CONFIG_HOME`, and
  fake executables on `PATH` instead of monkey-patching Node process APIs.

## Branch policy

- Branch from `main` and merge through a pull request; direct pushes are not
  part of the release process.
- `CI / check` must pass on the current `main` base before merge, and review
  conversations must be resolved.
- Use squash merges so the Conventional Commit pull request title becomes the
  commit Release Please evaluates.
- Force pushes and branch deletion are blocked on `main`.
- No approval count is required while the repository has one maintainer. Seek
  review for security-sensitive, persistence-format, and release changes.

## Releases

Release Please maintains a release pull request containing the version bump
and `CHANGELOG.md`. Merging that pull request creates the GitHub release and
tag, reruns the full quality gate, and publishes the exact package to npm.

The npm package should trust the GitHub Actions publisher with:

- Owner: `Fraser-Grant`
- Repository: `opencode-jobs`
- Workflow: `release.yml`
- Allowed action: `npm publish`

Trusted publishing requires no long-lived npm credential. The publish job uses
OIDC only and deliberately has no `NPM_TOKEN` fallback. After the first
successful OIDC release, set npm publishing access to **Require two-factor
authentication and disallow tokens**.

`RELEASE_PLEASE_TOKEN` is required because GitHub suppresses workflow events
created by `GITHUB_TOKEN`. Store a fine-grained personal access token with
repository access to `opencode-jobs` and read/write permissions for Contents,
Issues, and Pull requests. Release Please pull requests then receive the same
required CI check as every other pull request.
