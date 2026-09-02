import {
  tool,
  type ToolDefinition,
  type ToolResult,
} from "@opencode-ai/plugin";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describeCron, parseCron, type CronSets } from "./cron.js";
import {
  deriveScopeId,
  jobsDirectory,
  logFile,
  nowIso,
  sessionStateFile,
  slugify,
  timerUnit,
  unitBase,
  worktreesDirectory,
} from "./paths.js";
import {
  type Job,
  loadJobFile,
  saveJob,
  validateGuard,
  validateRunSpec,
  validateSession,
  validateTimeout,
  validateWorktree,
} from "./job.js";
import { loadRegistry, registryEntry, saveRegistry } from "./registry.js";
import { formatRunLine, readRunRecords, tailFile } from "./runs.js";
import {
  findOpencode,
  removeJobUnits,
  systemdHint,
  systemctl,
  timerStatus,
  writeJobUnits,
} from "./systemd.js";
import { disableProject, enableProject } from "./project.js";
import { errorMessage } from "./json.js";
import { listJobs, runJobNow, type ManagementResult } from "./management.js";

function ok(output: string): ToolResult {
  return { output };
}

function fail(message: string): ToolResult {
  return { output: `Error: ${message}`, metadata: { error: true } };
}

function managementToolResult(result: ManagementResult): ToolResult {
  return result.ok ? ok(result.output) : fail(result.output);
}

interface ScheduleJobInput {
  name: string;
  schedule: string;
  prompt?: string | undefined;
  command?: string | undefined;
  arguments?: string | undefined;
  session?: string | undefined;
  guard?: string | undefined;
  worktree?: boolean | undefined;
  worktreeBase?: string | undefined;
  worktreeRef?: string | undefined;
  worktreeCommitMessage?: string | undefined;
  agent?: string | undefined;
  model?: string | undefined;
  timeoutSeconds?: number | undefined;
  slug?: string | undefined;
}

function scheduleJobOutput(
  input: ScheduleJobInput,
  directory: string,
): ToolResult {
  const slug = slugify(input.slug ?? input.name);
  let sets: CronSets;
  try {
    sets = parseCron(input.schedule);
  } catch (error) {
    return fail(errorMessage(error));
  }
  const hasWorktreeOptions =
    input.worktreeBase !== undefined ||
    input.worktreeRef !== undefined ||
    input.worktreeCommitMessage !== undefined;
  if (hasWorktreeOptions && input.worktree !== true) {
    return fail(
      "set worktree: true to enable worktree options (worktreeBase, worktreeRef, worktreeCommitMessage)",
    );
  }
  let run: Job["run"];
  let session: Job["session"] | "new";
  let guard: string | undefined;
  let worktree: Job["worktree"];
  let timeoutSeconds: number | undefined;
  try {
    run = validateRunSpec(
      {
        prompt: input.prompt,
        command: input.command,
        arguments: input.arguments,
        agent: input.agent,
        model: input.model,
      },
      "job",
    );
    session = validateSession(input.session, "job");
    guard = validateGuard(input.guard, "job");
    worktree = validateWorktree(
      input.worktree === true
        ? {
            ...(input.worktreeBase !== undefined && {
              base: input.worktreeBase,
            }),
            ...(input.worktreeRef !== undefined && {
              ref: input.worktreeRef,
            }),
            ...(input.worktreeCommitMessage !== undefined && {
              commitMessage: input.worktreeCommitMessage,
            }),
          }
        : undefined,
      "job",
    );
    timeoutSeconds = validateTimeout(input.timeoutSeconds, "job");
  } catch (error) {
    return fail(errorMessage(error));
  }
  const existing = loadJobFile(
    path.join(jobsDirectory(directory), `${slug}.json`),
    slug,
  );
  const job: Job = {
    slug,
    name: input.name,
    schedule: input.schedule,
    run,
    ...(session !== "new" && { session }),
    ...(guard !== undefined && { guard }),
    ...(worktree !== undefined && { worktree }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    createdAt: existing.ok ? existing.job.createdAt : nowIso(),
    updatedAt: nowIso(),
  };
  saveJob(directory, job);
  const relativePath = `.opencode/jobs/${slug}.json`;
  const lines = [
    `${existing.ok ? "Updated" : "Created"} job "${job.name}" (${slug})`,
    `Definition: ${relativePath} (${job.schedule} — ${describeCron(sets)})`,
  ];
  if (session !== "new") lines.push(`Session: ${session}`);
  if (worktree !== undefined)
    lines.push(
      `Worktree: yes (base ${worktree.base ?? "default"}, branch opencode-jobs/${slug}/<run>)`,
    );
  const entry = registryEntry(directory);
  if (entry === undefined) {
    lines.push(
      "Project not enabled yet. Run enable_project to install the systemd timer.",
    );
    return ok(lines.join("\n"));
  }
  const abs = path.resolve(directory);
  const opencodeBin = findOpencode();
  const pathEnvironment = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const base = writeJobUnits(
    job,
    abs,
    entry.scopeId,
    opencodeBin,
    pathEnvironment,
  );
  const reload = systemctl(["daemon-reload"]);
  const enable = systemctl(["enable", "--now", timerUnit(base)]);
  if (!reload.ok || !enable.ok) {
    const stderr = reload.ok ? enable.stderr : reload.stderr;
    return fail(
      `Saved ${relativePath} but systemd re-sync failed: ${stderr}${systemdHint(stderr)}`,
    );
  }
  if (!entry.jobs.includes(slug)) {
    const registry = loadRegistry();
    const current = registry.projects[abs];
    if (current !== undefined) {
      current.jobs = [...new Set([...current.jobs, slug])];
      current.updatedAt = nowIso();
      saveRegistry(registry);
    }
  }
  const next = timerStatus(base).next;
  const nextDesc = next === undefined ? "" : `, next run: ${next}`;
  lines.push(`Re-synced systemd units (project enabled)${nextDesc}`);
  return ok(lines.join("\n"));
}

function showJobOutput(slugInput: string, directory: string): ToolResult {
  const file = path.join(
    jobsDirectory(directory),
    `${slugify(slugInput)}.json`,
  );
  if (!existsSync(file)) {
    return fail(
      `No job "${slugInput}" in ${jobsDirectory(directory)}. Use list_jobs to see definitions.`,
    );
  }
  const result = loadJobFile(file);
  if (!result.ok) return fail(result.error);
  const job = result.job;
  const sets = parseCron(job.schedule);
  const entry = registryEntry(directory);
  const scopeId = entry?.scopeId ?? deriveScopeId(directory);
  const runDesc =
    "prompt" in job.run
      ? `prompt "${job.run.prompt}"`
      : `command "${job.run.command}"${job.run.arguments === undefined ? "" : ` "${job.run.arguments}"`}`;
  const lines = [
    `${job.name} (${job.slug})`,
    `Schedule: ${job.schedule} — ${describeCron(sets)}`,
    `Definition: .opencode/jobs/${job.slug}.json (updated ${job.updatedAt})`,
    `Run: ${runDesc}`,
  ];
  if (job.guard !== undefined)
    lines.push(`Guard: ${job.guard} (must exit 0 for the run to start)`);
  if (job.worktree !== undefined) {
    const base = job.worktree.base ?? worktreesDirectory(scopeId);
    lines.push(
      `Worktree: fresh per run at ${base} (from ${job.worktree.ref ?? "HEAD"}) — changes are committed to opencode-jobs/${job.slug}/… before the worktree is removed`,
    );
  }
  if (job.session !== undefined) {
    const state = sessionStateFile(scopeId, job.slug);
    const sessionId = existsSync(state)
      ? readFileSync(state, "utf8").trim()
      : "";
    lines.push(
      `Session: ${job.session}${sessionId.length > 0 ? ` — current ${sessionId}` : " — no session yet"}`,
    );
  }
  if (job.run.agent !== undefined) lines.push(`Agent: ${job.run.agent}`);
  if (job.run.model !== undefined) lines.push(`Model: ${job.run.model}`);
  if (job.timeoutSeconds !== undefined && job.timeoutSeconds > 0) {
    lines.push(
      `Timeout: ${String(job.timeoutSeconds)}s (systemd TimeoutStartSec)`,
    );
  }
  if (entry === undefined) {
    lines.push("Enabled: no (run enable_project to install the timer)");
  } else {
    const base = unitBase(scopeId, job.slug);
    const status = timerStatus(base);
    lines.push(`Enabled: yes (timer ${timerUnit(base)})`);
    if (status.next !== undefined) lines.push(`Next run: ${status.next}`);
    if (status.last !== undefined) lines.push(`Last trigger: ${status.last}`);
    lines.push(`Log: ${logFile(scopeId, job.slug)}`);
  }
  const records = readRunRecords(scopeId, job.slug, 10);
  if (records.length > 0) {
    lines.push("Recent runs:");
    for (const record of records.toReversed())
      lines.push(`  ${formatRunLine(record)}`);
  } else {
    lines.push("Recent runs: none");
  }
  return ok(lines.join("\n"));
}

function removeJobDefinitionOutput(
  slugInput: string,
  directory: string,
): ToolResult {
  const slug = slugify(slugInput);
  const file = path.join(jobsDirectory(directory), `${slug}.json`);
  if (!existsSync(file))
    return fail(`No job "${slug}" in ${jobsDirectory(directory)}`);
  const abs = path.resolve(directory);
  const entry = registryEntry(directory);
  if (entry?.jobs.includes(slug)) {
    const removalFailure = removeJobUnits(entry.scopeId, slug);
    if (removalFailure !== undefined) {
      return fail(`Failed to remove systemd units: ${removalFailure}`);
    }
    const reload = systemctl(["daemon-reload"]);
    if (!reload.ok) {
      return fail(
        `Removed the units but systemd reload failed: ${reload.stderr}${systemdHint(reload.stderr)}`,
      );
    }
  }
  rmSync(file);
  const lines = [`Deleted job definition .opencode/jobs/${slug}.json`];
  const scopeId = entry?.scopeId ?? deriveScopeId(directory);
  const state = sessionStateFile(scopeId, slug);
  if (existsSync(state)) {
    rmSync(state);
    lines.push(`Removed session state ${state}`);
  }
  if (entry?.jobs.includes(slug)) {
    const registry = loadRegistry();
    const current = registry.projects[abs];
    if (current !== undefined) {
      current.jobs = current.jobs.filter((jobSlug) => jobSlug !== slug);
      current.updatedAt = nowIso();
      if (current.jobs.length === 0) omitProject(registry, abs);
      saveRegistry(registry);
    }
    lines.push("Removed systemd units (project was enabled)");
  }
  return ok(lines.join("\n"));
}

function omitProject(
  registry: { projects: Record<string, unknown> },
  workdir: string,
): void {
  const { [workdir]: _omitted, ...remaining } = registry.projects;
  registry.projects = remaining;
}

function jobLogsOutput(
  slugInput: string,
  lineCountInput: number | undefined,
  directory: string,
): ToolResult {
  const entry = registryEntry(directory);
  const scopeId = entry?.scopeId ?? deriveScopeId(directory);
  const log = logFile(scopeId, slugify(slugInput));
  const lineCount = Math.min(lineCountInput ?? 100, 500);
  const tail = tailFile(log, lineCount, 20_000);
  if (tail === undefined)
    return ok(`No log yet for "${slugInput}" (expected at ${log})`);
  if (tail.length === 0) return ok(`Log is empty: ${log}`);
  return ok(`${log} (tail):\n${tail}`);
}

function listProjectsOutput(): ToolResult {
  const registry = loadRegistry();
  const entries = Object.values(registry.projects).toSorted((a, b) =>
    a.workdir.localeCompare(b.workdir),
  );
  if (entries.length === 0)
    return ok("No projects with scheduled jobs are registered.");
  const lines = ["Registry: ~/.config/opencode/jobs/registry.json"];
  for (const entry of entries) {
    const missing = existsSync(entry.workdir) ? "" : " [WORKDIR MISSING]";
    lines.push(
      `- ${entry.workdir}${missing}`,
      `  scope ${entry.scopeId}, ${String(entry.jobs.length)} job(s): ${entry.jobs.join(", ")}`,
    );
  }
  return ok(lines.join("\n"));
}

const listJobsTool = tool({
  description:
    "List scheduled job definitions for the current project (from .opencode/jobs/), including enabled state, next run, and last run status.",
  args: {},
  execute: (_input, context) =>
    Promise.resolve(managementToolResult(listJobs(context.directory))),
});

const scheduleJobTool = tool({
  description:
    "Create or update a scheduled job definition in the current project (.opencode/jobs/<slug>.json, git-committable). Schedule is a 5-field cron expression. Set either prompt (natural language) or command (custom command name). If the project is enabled, systemd units are re-synced automatically.",
  args: {
    name: tool.schema.string().describe("Human-readable job name"),
    schedule: tool.schema
      .string()
      .describe(
        '5-field cron expression, e.g. "0 9 * * *" (daily 9am), "0 */6 * * *" (every 6h), "30 8 * * 1" (Mon 8:30)',
      ),
    prompt: tool.schema
      .string()
      .optional()
      .describe("Natural language prompt the job runs via `opencode run`"),
    command: tool.schema
      .string()
      .optional()
      .describe("Custom command name to run instead of a prompt"),
    arguments: tool.schema
      .string()
      .optional()
      .describe("Arguments passed to the custom command"),
    session: tool.schema
      .string()
      .optional()
      .describe(
        'Session continuity between runs: "new" (default, fresh session each run), "persist" (continue the same session), "compact" (continue the same session; after each run the history is compacted into a summary the next run starts from), "compact+last" (like compact, but the run\'s final result message is re-injected after the summary so the next run starts from summary plus last result)',
      ),
    guard: tool.schema
      .string()
      .optional()
      .describe(
        'Shell command run before the job; the run only starts if it exits 0, otherwise it is recorded as skipped (applies to run_job too). E.g. "! git diff --quiet" to run only when the repo has changes',
      ),
    worktree: tool.schema
      .boolean()
      .optional()
      .describe(
        "Run the job in a fresh git worktree instead of the project checkout: the worktree is created from worktreeRef (default HEAD), the job runs inside it, all changes are committed to a per-run branch opencode-jobs/<slug>/…, and the worktree is removed afterwards (kept if the safety commit fails). Requires the project to be a git repository",
      ),
    worktreeBase: tool.schema
      .string()
      .optional()
      .describe(
        "Parent directory for the worktree (default: ~/.local/state/opencode/jobs/worktrees/<scopeId>/<slug>). Relative paths resolve against the project directory; it should be dedicated to job worktrees",
      ),
    worktreeRef: tool.schema
      .string()
      .optional()
      .describe('Git ref the worktree branch starts from (default: "HEAD")'),
    worktreeCommitMessage: tool.schema
      .string()
      .optional()
      .describe(
        'Commit message used when saving worktree changes (default: "opencode-jobs: <slug> run <runId>")',
      ),
    agent: tool.schema.string().optional().describe("Agent to use for the run"),
    model: tool.schema.string().optional().describe("Model to use for the run"),
    timeoutSeconds: tool.schema
      .number()
      .optional()
      .describe(
        "Hard timeout in seconds (0 or omitted disables). systemd stops the run with SIGTERM after this",
      ),
    slug: tool.schema
      .string()
      .optional()
      .describe("URL-safe identifier; defaults to a slugified name"),
  },
  execute: (input, context) =>
    Promise.resolve(scheduleJobOutput(input, context.directory)),
});

const showJobTool = tool({
  description:
    "Show full details for one scheduled job: definition, cron description, systemd install state, and recent run history.",
  args: {
    slug: tool.schema.string().describe("Job slug (see list_jobs)"),
  },
  execute: (input, context) =>
    Promise.resolve(showJobOutput(input.slug, context.directory)),
});

const jobDeletionTool = tool({
  description:
    "Delete a scheduled job definition from the current project. If the project is enabled, its systemd units are removed too. Run history and logs are kept.",
  args: {
    slug: tool.schema.string().describe("Job slug to delete"),
  },
  execute: (input, context) =>
    Promise.resolve(removeJobDefinitionOutput(input.slug, context.directory)),
});

const runJobTool = tool({
  description:
    "Run a scheduled job immediately, fire-and-forget, using the exact frozen run script the timer would use. Appends to the same log and run history. The job's project must be enabled.",
  args: {
    slug: tool.schema.string().describe("Job slug to run now"),
  },
  execute: (input, context) =>
    Promise.resolve(
      managementToolResult(runJobNow(input.slug, context.directory)),
    ),
});

const jobLogsTool = tool({
  description:
    "Show the tail of a scheduled job's log file (scheduled and manual runs both append to it).",
  args: {
    slug: tool.schema.string().describe("Job slug"),
    lines: tool.schema
      .number()
      .optional()
      .describe("Number of lines to show (default 100)"),
  },
  execute: (input, context) =>
    Promise.resolve(jobLogsOutput(input.slug, input.lines, context.directory)),
});

const enableProjectTool = tool({
  description:
    "Enable scheduled jobs for the current project: installs a systemd user service+timer per job definition in .opencode/jobs/, registers the project in the global registry (~/.config/opencode/jobs/registry.json), and removes stale units for deleted jobs. Idempotent, so it also re-syncs after job definitions change. Linux only.",
  args: {},
  execute: (_input, context) =>
    Promise.resolve(enableProjectOutput(context.directory)),
});

function enableProjectOutput(directory: string): ToolResult {
  try {
    return ok(enableProject(directory));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

const disableProjectTool = tool({
  description:
    "Disable scheduled jobs for the current project: stops and removes its systemd timers/services and removes the registry entry. Job definitions stay in the repo, and run history/logs are kept.",
  args: {},
  execute: (_input, context) =>
    Promise.resolve(disableProjectOutput(context.directory)),
});

function disableProjectOutput(directory: string): ToolResult {
  try {
    return ok(disableProject(directory));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

const listProjectsTool = tool({
  description:
    "List all projects with enabled scheduled jobs from the global registry (~/.config/opencode/jobs/registry.json).",
  args: {},
  execute: () => Promise.resolve(listProjectsOutput()),
});

export const jobsTools: Record<string, ToolDefinition> = {
  schedule_job: scheduleJobTool,
  list_jobs: listJobsTool,
  get_job: showJobTool,
  delete_job: jobDeletionTool,
  run_job: runJobTool,
  job_logs: jobLogsTool,
  enable_project: enableProjectTool,
  disable_project: disableProjectTool,
  list_projects: listProjectsTool,
};
