import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { describeCron, parseCron, type CronSets } from "./cron.js";
import { loadJobs } from "./job.js";
import {
  deriveScopeId,
  jobsDirectory,
  logDirectory,
  logFile,
  runScriptPath,
  slugify,
  unitBase,
} from "./paths.js";
import { registryEntry } from "./registry.js";
import {
  formatRunLine,
  lastFinishedRun,
  readRunRecords,
  tailFile,
} from "./runs.js";
import { timerStatus } from "./systemd.js";

export type ManagementResult =
  { ok: true; output: string } | { ok: false; output: string };

function tryParseCron(schedule: string): CronSets | undefined {
  try {
    return parseCron(schedule);
  } catch {
    return undefined;
  }
}

export function listJobs(directory: string): ManagementResult {
  const { jobs, errors } = loadJobs(directory);
  const entry = registryEntry(directory);
  const header = entry
    ? `Project enabled (scope ${entry.scopeId}). Job definitions: ${jobsDirectory(directory)}`
    : `Project not enabled. Job definitions: ${jobsDirectory(directory)}`;
  const lines = [header];
  if (jobs.length === 0)
    lines.push("No job definitions. Create one with schedule_job.");
  for (const job of jobs) {
    const scopeId = entry?.scopeId ?? deriveScopeId(directory);
    const sets = tryParseCron(job.schedule);
    if (sets === undefined) {
      lines.push(`- ${job.slug}: INVALID schedule "${job.schedule}"`);
      continue;
    }
    const records = readRunRecords(scopeId, job.slug, 20);
    const last = lastFinishedRun(records);
    const lastDesc =
      last === undefined
        ? ", last: never"
        : `, last: ${last.status ?? "?"} ${formatRunLine(last)}`;
    const next =
      entry === undefined
        ? undefined
        : timerStatus(unitBase(scopeId, job.slug)).next;
    const nextDesc = next === undefined ? "" : `, next: ${next}`;
    lines.push(
      `- ${job.slug}: ${job.schedule} (${describeCron(sets)})${nextDesc}${lastDesc}`,
    );
  }
  lines.push(...errors.map((error) => `! ${error}`));
  return { ok: true, output: lines.join("\n") };
}

export function runJobNow(
  slugInput: string,
  directory: string,
): ManagementResult {
  const slug = slugify(slugInput);
  const file = path.join(jobsDirectory(directory), `${slug}.json`);
  if (!existsSync(file)) {
    return {
      ok: false,
      output: `No job "${slug}" in ${jobsDirectory(directory)}`,
    };
  }
  const entry = registryEntry(directory);
  if (entry === undefined) {
    return {
      ok: false,
      output: `Project is not enabled, so no run script exists for "${slug}". Run enable_project first.`,
    };
  }
  const script = runScriptPath(entry.scopeId, slug);
  if (!existsSync(script)) {
    return {
      ok: false,
      output: `Run script missing for "${slug}". Run enable_project to (re)install units.`,
    };
  }
  const log = logFile(entry.scopeId, slug);
  mkdirSync(logDirectory(entry.scopeId), { recursive: true });
  const fd = openSync(log, "a");
  const child = spawn("/bin/sh", [script], {
    cwd: path.resolve(directory),
    env: { ...process.env, OPENCODE_JOBS_STARTED_BY: "manual" },
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  closeSync(fd);
  const tail = tailFile(log, 5, 2000);
  const parts = [
    `Started "${slug}" manually (pid ${String(child.pid)})`,
    `Log: ${log}`,
  ];
  if (tail?.length) parts.push(`Log tail:\n${tail}`);
  return { ok: true, output: parts.join("\n") };
}
