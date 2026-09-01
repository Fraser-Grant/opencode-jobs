---
name: opencode-jobs
description: Schedule and manage recurring OpenCode agent jobs with project-local definitions and systemd user timers. Use when asked to schedule, inspect, run, enable, disable, or troubleshoot recurring jobs and their logs.
license: MIT
compatibility: opencode on Linux with systemd
---

# OpenCode Jobs

Use the `opencode-jobs` tools instead of editing systemd units or global
scheduler state directly.

## Workflow

1. Create or update a definition with `schedule_job`. Definitions belong in
   `.opencode/scheduler/jobs/<slug>.json` and should be committed with the
   project.
2. Inspect definitions with `list_jobs` or `get_job`.
3. Run `enable_project` after the first job is created. Run it again to
   reconcile timers after externally editing definitions.
4. Use `run_job` for a manual fire-and-forget run and `job_logs` to inspect
   its output.
5. Use `disable_project` to remove timers while retaining definitions,
   history, and logs. Use `delete_job` only when the definition should also
   be removed.

## Scheduling Rules

- Schedules are five-field cron expressions: minute, hour, day of month,
  month, day of week.
- Set exactly one of `prompt` or `command`. `arguments` only applies to a
  custom command.
- Default to `session: new`. Use `persist` when full continuity is needed,
  `compact` for summary continuity, or `compact+last` when the previous final
  result must also remain visible.
- A `guard` is a shell command that must exit zero for the job to run.
- Set `worktree: true` when the job should not touch the user's checkout:
  each run gets a fresh git worktree (default base
  `~/.local/state/opencode/scheduler/worktrees/…`, override with
  `worktree.base`), all changes are committed to a per-run branch
  `opencode-jobs/<slug>/…`, and the worktree is removed. Overlapping runs
  of the same job are skipped via a lock; subdirectory projects run in
  the matching worktree subdirectory. Requires a git repository.
- Scheduled jobs require Linux, a systemd user session, and an `opencode`
  executable available to the timer environment.

## Project Installation

When the plugin or this skill is missing, install both from a globally
installed package:

```sh
opencode-jobs install /path/to/project     # add plugin entry + skill
opencode-jobs uninstall /path/to/project   # reverse (add --purge to wipe data)
```

The commands default to the current directory. Restart OpenCode after
installation so it loads the plugin and discovers the skill.
