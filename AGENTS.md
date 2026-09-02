# opencode-jobs

opencode plugin: recurring agent jobs as systemd user timers, with
git-committable job definitions, JSONL run history, and session continuity.
Published as [`opencode-jobs`](https://www.npmjs.com/package/opencode-jobs)
on npm; loads from the `plugin` config array in a project `opencode.json`
or the global `~/.config/opencode/opencode.json`.

## Quality gate

Run before finishing any change. `check` is the finish line — formatting,
linting, and types must all be clean:

```
npm run check    # prettier --check . && eslint && tsc --noEmit
npm run format   # prettier --write .
npm run build    # bun bundle + tsc declarations (must stay green)
npm run smoke    # behavioral tests: cron, units, run records, guard,
                 # session modes, worktrees (needs systemd-analyze, dash,
                 # git; Node >= 20)
```

Fix findings properly — never disable a rule or widen a type to silence it.
Linting is typescript-eslint strictTypeChecked + stylisticTypeChecked with
eslint-plugin-unicorn recommended.

## Layout

- `src/index.ts` — plugin entry (default export, non-Linux load warning).
- `src/cli.ts` / `install.ts` / `management.ts` — global npm CLI (`install`,
  `uninstall [--purge]`, `list`, `enable`, `disable`, `run`), shared job
  management operations, and idempotent project wiring for the package config
  entry and bundled skill.
- `src/tools.ts` — the nine agent tools (`jobsTools`).
- `src/job.ts` / `cron.ts` / `systemd.ts` — job JSON validation, cron
  parsing → OnCalendar, and the systemd unit + POSIX run-script generators
  (the run script is the heart: run records, session state, compaction,
  worktree create/commit/remove).
- `src/paths.ts` / `registry.ts` / `runs.ts` / `project.ts` / `json.ts` —
  storage layout (config for state, XDG state home for worktrees), project
  registry, history parsing, strict JSON guards.
- `src/internals.ts` — pure functions re-exported for the smoke harness.
- `scripts/smoke.mjs` — behavioral smoke test (compiles src, checks
  generated scripts against real `systemd-analyze`, runs them with fake
  `opencode`/`curl` binaries and real git repos for worktree jobs).
- `scripts/cli-smoke.mjs` — real built-bin install/idempotency/config/package
  smoke coverage.
- `skill/opencode-jobs/SKILL.md` — project skill copied by the CLI installer.
- `dist/` — build output shipped to npm; never edit by hand.

Zero runtime dependencies beyond `@opencode-ai/plugin` types (erased at
bundle). Run scripts are generated POSIX sh — keep them `sh -n`/`dash -n`
clean.
