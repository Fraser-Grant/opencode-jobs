import path from "node:path";
import { type Job, loadJobs } from "./job.js";
import {
  type RegistryEntry,
  loadRegistry,
  registryEntry,
  saveRegistry,
} from "./registry.js";
import { describeCron, parseCron } from "./cron.js";
import {
  deriveScopeId,
  jobsDirectory,
  logDirectory,
  nowIso,
  runsDirectory,
  timerUnit,
  unitBase,
} from "./paths.js";
import {
  findOpencode,
  removeJobUnits,
  removeStaleUnits,
  systemdHint,
  systemctl,
  timerStatus,
  writeJobUnits,
} from "./systemd.js";

export function enableProject(workdir: string): string {
  if (process.platform !== "linux")
    throw new Error(
      "Scheduled jobs are only supported on Linux (systemd user units)",
    );
  const { jobs, errors } = loadJobs(workdir);
  if (errors.length > 0)
    throw new Error(`Invalid job definitions:\n${errors.join("\n")}`);
  if (jobs.length === 0) {
    throw new Error(
      `No job definitions found in ${jobsDirectory(workdir)}. Create one with schedule_job first.`,
    );
  }
  const abs = path.resolve(workdir);
  const scopeId = deriveScopeId(abs);
  const opencodeBin = findOpencode();
  const pathEnvironment = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const bases = jobs.map((job) =>
    writeJobUnits(job, abs, scopeId, opencodeBin, pathEnvironment),
  );
  const removed = removeStaleUnits(
    scopeId,
    new Set(jobs.map((job) => job.slug)),
  );
  const reload = systemctl(["daemon-reload"]);
  if (!reload.ok)
    throw new Error(
      `systemctl --user daemon-reload failed: ${reload.stderr}${systemdHint(reload.stderr)}`,
    );
  const failures: string[] = [];
  for (const base of bases) {
    const enable = systemctl(["enable", "--now", timerUnit(base)]);
    if (!enable.ok)
      failures.push(
        `${timerUnit(base)}: ${enable.stderr}${systemdHint(enable.stderr)}`,
      );
  }
  const registry = loadRegistry();
  const previous = registry.projects[abs];
  registry.projects[abs] = {
    scopeId,
    workdir: abs,
    enabledAt: previous?.enabledAt ?? nowIso(),
    updatedAt: nowIso(),
    jobs: jobs.map((job) => job.slug),
  };
  saveRegistry(registry);
  const lines = [
    `Enabled ${String(jobs.length)} job(s) for ${abs} (scope ${scopeId})`,
  ];
  if (removed.length > 0)
    lines.push(`Removed stale units for deleted jobs: ${removed.join(", ")}`);
  lines.push(...describeJobSchedules(jobs, scopeId));
  if (failures.length > 0)
    lines.push(`Timer activation failures:\n${failures.join("\n")}`);
  return lines.join("\n");
}

function describeJobSchedules(jobs: Job[], scopeId: string): string[] {
  const lines: string[] = [];
  for (const job of jobs) {
    const sets = parseCron(job.schedule);
    const next = timerStatus(unitBase(scopeId, job.slug)).next;
    const nextDesc = next === undefined ? "" : `, next: ${next}`;
    lines.push(
      `- ${job.slug}: ${job.schedule} (${describeCron(sets)})${nextDesc}`,
    );
  }
  return lines;
}

export function disableProject(workdir: string): string {
  const abs = path.resolve(workdir);
  const entry: RegistryEntry | undefined = registryEntry(abs);
  if (entry === undefined) return `Project is not enabled: ${abs}`;
  for (const slug of entry.jobs) removeJobUnits(entry.scopeId, slug);
  systemctl(["daemon-reload"]);
  const registry = loadRegistry();
  const { [abs]: _omitted, ...remainingProjects } = registry.projects;
  registry.projects = remainingProjects;
  saveRegistry(registry);
  return [
    `Disabled ${String(entry.jobs.length)} job(s) for ${abs}`,
    `Run history kept at ${runsDirectory(entry.scopeId)}`,
    `Logs kept at ${logDirectory(entry.scopeId)}`,
  ].join("\n");
}
