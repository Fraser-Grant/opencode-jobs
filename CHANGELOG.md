# Changelog

## Unreleased

### Breaking changes

- Job definitions and persisted state move from legacy `scheduler` paths to
  `.opencode/jobs/`, `~/.config/opencode/jobs/`, and
  `~/.local/state/opencode/jobs/`. The plugin and CLI migrate 0.1.x data
  automatically, preserve the registry and run/session history, and re-sync
  enabled projects without changing their existing systemd unit names.

## [1.1.0](https://github.com/Fraser-Grant/opencode-jobs/compare/opencode-jobs-v1.0.0...opencode-jobs-v1.1.0) (2026-09-02)

### Features

- add job management CLI commands ([#13](https://github.com/Fraser-Grant/opencode-jobs/issues/13)) ([5bea4ad](https://github.com/Fraser-Grant/opencode-jobs/commit/5bea4ad18ce9fcd7aea91a9d589edbd927ba7d00))

## [1.0.0](https://github.com/Fraser-Grant/opencode-jobs/compare/opencode-jobs-v0.2.0...opencode-jobs-v1.0.0) (2026-09-02)

### ⚠ BREAKING CHANGES

- migrate storage paths from scheduler to jobs ([#11](https://github.com/Fraser-Grant/opencode-jobs/issues/11))

### Features

- migrate storage paths from scheduler to jobs ([#11](https://github.com/Fraser-Grant/opencode-jobs/issues/11)) ([3fe296f](https://github.com/Fraser-Grant/opencode-jobs/commit/3fe296ff3bb88af4c436fe1b9b1812a12d029f17))

## [0.2.0](https://github.com/Fraser-Grant/opencode-jobs/compare/opencode-jobs-v0.1.2...opencode-jobs-v0.2.0) (2026-09-01)

### Features

- run jobs in a fresh git worktree ([#9](https://github.com/Fraser-Grant/opencode-jobs/issues/9)) ([b037955](https://github.com/Fraser-Grant/opencode-jobs/commit/b0379551764f7fc9e486291ebd0d6cdc1904d0aa))

## [0.1.2](https://github.com/Fraser-Grant/opencode-jobs/compare/opencode-jobs-v0.1.1...opencode-jobs-v0.1.2) (2026-08-31)

### Bug Fixes

- return structured validation errors ([#6](https://github.com/Fraser-Grant/opencode-jobs/issues/6)) ([ddf246d](https://github.com/Fraser-Grant/opencode-jobs/commit/ddf246df72060a521a0183ea2a895b8ce7273850))

## [0.1.1](https://github.com/Fraser-Grant/opencode-jobs/compare/opencode-jobs-v0.1.0...opencode-jobs-v0.1.1) (2026-08-31)

### Bug Fixes

- format generated release changelogs ([#5](https://github.com/Fraser-Grant/opencode-jobs/issues/5)) ([58b336c](https://github.com/Fraser-Grant/opencode-jobs/commit/58b336c6eac18feb0b95033abe89ca824d317f8c))
- harden automated releases ([#2](https://github.com/Fraser-Grant/opencode-jobs/issues/2)) ([3fa4a0b](https://github.com/Fraser-Grant/opencode-jobs/commit/3fa4a0bffe767bd42168f699d3d0e8d4c8c032f3))
