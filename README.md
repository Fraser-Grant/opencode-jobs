# opencode-jobs

> **Status:** v0.x — Linux-only early release. The job format, tool names,
> and CLI may still change.

Recurring scheduled jobs for [opencode](https://opencode.ai), backed by
systemd user timers. Job definitions are git-committable files in your repo,
each job runs through a frozen POSIX shell script, and every run appends
JSONL history your agent can read back. Jobs are just agent prompts — with
optional session continuity so a nightly job can build on what it learned
yesterday.

## Install

Install the package globally, then wire the plugin and bundled skill into the
current project:

```sh
npm install --global opencode-jobs
opencode-jobs install
```

Pass a project path when running the command from elsewhere:

```sh
opencode-jobs install /path/to/project
```

The installer is idempotent. It adds `opencode-jobs` to the project's local
`plugin` array and copies the bundled skill to
`.opencode/skills/opencode-jobs/SKILL.md` — the skill teaches your agent the
job file format, session modes, and the day-to-day workflow. It does not
enable timers; create a job first, then use `enable_project`. If an existing
config contains comments or malformed JSON, the installer leaves it untouched
and reports the manual change required.

Job files are committed agent prompts that run on your machine on a
schedule — only install and enable projects whose
`.opencode/scheduler/jobs/` you trust, the same care you would take before
running an unfamiliar repository's build.

Alternatively, add the package manually to the project root `opencode.json`
or global `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-jobs"]
}
```

Restart opencode and ask your agent to schedule something, e.g.
_"schedule a job that reviews new commits every weekday at 9am"_.

## Uninstall

Reverse an install from anywhere:

```sh
opencode-jobs uninstall            # current directory
opencode-jobs uninstall /path/to/project
```

Uninstall stops and removes the project's systemd units (if enabled),
removes the plugin entry from the project config, and deletes the copied
skill — a skill you have modified locally is kept and reported, and a config
the uninstaller cannot rewrite safely is left untouched with a non-zero
exit. Job definitions, run history, session state, and logs are kept.

Add `--purge` to also delete the project's job definitions
(`.opencode/scheduler/`) and its scheduler data (run scripts, run history,
session state, and logs):

```sh
opencode-jobs uninstall --purge
```

## CLI

```text
opencode-jobs install [projectDir]
opencode-jobs uninstall [projectDir] [--purge]
```

The CLI is installed as the `opencode-jobs` npm executable. `projectDir`
defaults to the current directory. Both commands print a JSON result so they
can also be used from setup scripts and CI.

## Tools

| Tool              | What it does                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `schedule_job`    | Create or update a job (cron schedule, prompt or custom command, session mode, guard, timeout) |
| `list_jobs`       | List job definitions in the project with next/last run status                                  |
| `get_job`         | Show one job: definition, timer state, last runs, recent log tail                              |
| `run_job`         | Fire a job now, through the exact script the timer would run                                   |
| `job_logs`        | Tail a job's log (scheduled and manual runs both append)                                       |
| `delete_job`      | Delete a job, its units, run script, and session state                                         |
| `enable_project`  | Install systemd user units for all jobs in the project and register it                         |
| `disable_project` | Stop and remove the project's units (jobs and history are kept)                                |
| `list_projects`   | List all projects that have enabled jobs                                                       |

## Job definitions

Jobs live in your repo at `.opencode/scheduler/jobs/<slug>.json` — review
them in PRs like any other code:

```json
{
  "slug": "nightly-review",
  "name": "Nightly Review",
  "schedule": "0 9 * * 1-5",
  "run": {
    "prompt": "Review commits since the last run and flag risky changes."
  },
  "session": "compact+last",
  "guard": "! git diff --quiet",
  "timeoutSeconds": 1800
}
```

- `schedule` — 5-field cron expression (`m h dom mon dow`, names and ranges
  supported), mapped to `OnCalendar` systemd timers.
- `run` — either a natural-language `prompt` (run with `opencode run`), or a
  `command` + optional `arguments` for a project custom command. Optional
  `agent` and `model` (`"provider/model"`) select who runs it.
- `session` — continuity between runs (below).
- `guard` — shell command run first; a non-zero exit skips the run (recorded
  as `skipped`). Example: `"! git diff --quiet"` runs only when the repo has
  changes.
- `timeoutSeconds` — hard limit; systemd stops the run with SIGTERM.

### Session modes

| Mode           | Behavior                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `new`          | Fresh session each run (default)                                                                                         |
| `persist`      | Continue the same session every run (`opencode run --session`)                                                           |
| `compact`      | Continue the same session; after each run the history is compacted into a summary the next run starts from               |
| `compact+last` | Like `compact`, but the run's final result is re-injected after the summary so the next run starts from summary + result |

Tracked modes (`persist`/`compact`/`compact+last`) self-heal a deleted or
stale session by retrying once with a fresh session.

## How it works

- `enable_project` generates, for each job: a frozen POSIX `run-<slug>.sh`
  script, a `opencode-sched-<scope>-<slug>.service` + `.timer` unit pair,
  and enables the timer. `disable_project` removes them.
- Run scripts work standalone: they append a JSONL record (status, exit
  code, duration, session id) per run, capture `--format json` output for
  tracked session modes, and never leave temp files behind.
- A global registry tracks enabled projects so `list_projects` and
  `disable_project` work from any session.
- Schedules are cron expressions compiled to systemd `OnCalendar` and
  verified with `systemd-analyze verify` before install.

## Storage

| What                | Where                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Job definitions     | `<project>/.opencode/scheduler/jobs/<slug>.json` (git-committed)       |
| Run scripts         | `~/.config/opencode/scheduler/scopes/<scopeId>/run-<slug>.sh`          |
| Run history (JSONL) | `~/.config/opencode/scheduler/runs/<scopeId>/<slug>.jsonl`             |
| Session state       | `~/.config/opencode/scheduler/sessions/<scopeId>/<slug>.txt`           |
| Job logs            | `~/.config/opencode/logs/scheduler/<scopeId>/<slug>.log`               |
| Project registry    | `~/.config/opencode/scheduler/registry.json`                           |
| systemd units       | `~/.config/systemd/user/opencode-sched-<scope>-<slug>.{service,timer}` |

`scopeId` is a stable hash of the project path, so multiple projects can
define jobs without colliding. Because it is path-derived, moving or renaming
a project directory orphans its units, history, and registry entry — run
`opencode-jobs uninstall --purge` from the old path before moving, or clean
up `~/.config/opencode/scheduler/` (and the unit files) manually afterwards.

## Configuration

- `OPENCODE_SCHEDULER_OPENCODE_PATH` — absolute path to the `opencode`
  binary the run scripts invoke (default: resolved from `PATH`, then
  `~/.opencode/bin/opencode`, then common install locations).

## Requirements

- Linux with a systemd user session (jobs run via `systemctl --user`)
- `curl` (used by `compact`/`compact+last` modes only)
- POSIX `sh` (generated scripts are `sh`/`dash`-verified)
- The `opencode` CLI available to the timer environment

Not supported on macOS or Windows.

## Development

```
npm install
npm run check    # prettier + eslint + tsc
npm run build    # Bun plugin bundle + Node CLI bundle + declarations
npm run smoke    # build, scheduler behavior, CLI install, and package contents
```

Node >= 20 is required for the CLI and dev toolchain; the plugin runs on Bun
inside opencode.

## License

MIT

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the quality and release workflow and
[ROADMAP.md](ROADMAP.md) for current planning priorities.
