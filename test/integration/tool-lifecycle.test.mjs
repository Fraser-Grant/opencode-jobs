import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  readJsonLines,
  waitFor,
  writeExecutable,
} from "../helpers/runtime.mjs";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function requiredTool(tools, name) {
  const definition = tools?.[name];
  assert.ok(definition, `expected ${name} to be registered`);
  return definition;
}

function restoreEnvironment(original) {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("public tools complete an enabled guarded-job lifecycle", async (context) => {
  const work = mkdtempSync(join(tmpdir(), "opencode-jobs-node-test-"));
  const project = join(work, "demo");
  const config = join(work, "config");
  const bin = join(work, "bin");
  const systemctlLog = join(work, "systemctl.log");
  const opencodeCalls = join(work, "opencode.log");
  const blockFile = join(work, "block-guard");
  const originalEnvironment = {
    BLOCK_FILE: process.env.BLOCK_FILE,
    OPENCODE_CALLS: process.env.OPENCODE_CALLS,
    OPENCODE_JOBS_OPENCODE_PATH: process.env.OPENCODE_JOBS_OPENCODE_PATH,
    PATH: process.env.PATH,
    SYSTEMCTL_LOG: process.env.SYSTEMCTL_LOG,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  context.after(() => {
    restoreEnvironment(originalEnvironment);
    rmSync(work, { recursive: true, force: true });
  });

  mkdirSync(project, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const fakeOpencode = join(bin, "opencode");
  writeExecutable(
    fakeOpencode,
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$OPENCODE_CALLS"',
      'echo "fake opencode: $*"',
      "echo produced > wt-artifact.txt",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeExecutable(
    join(bin, "systemctl"),
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$SYSTEMCTL_LOG"',
      'if [ "$1" = "--user" ]; then shift; fi',
      'if [ "$1" = "show" ]; then',
      "  printf '2030-01-01 09:00:00 UTC\\nn/a\\n'",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );

  process.env.BLOCK_FILE = blockFile;
  process.env.OPENCODE_CALLS = opencodeCalls;
  process.env.OPENCODE_JOBS_OPENCODE_PATH = fakeOpencode;
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  process.env.SYSTEMCTL_LOG = systemctlLog;
  process.env.XDG_CONFIG_HOME = config;

  const pluginUrl = pathToFileURL(join(repo, "dist", "index.js"));
  const { default: plugin } = await import(pluginUrl.href);
  const hooks = await plugin({});
  const tools = hooks.tool;
  assert.deepEqual(Object.keys(tools ?? {}).toSorted(), [
    "delete_job",
    "disable_project",
    "enable_project",
    "get_job",
    "job_logs",
    "list_jobs",
    "list_projects",
    "run_job",
    "schedule_job",
  ]);
  const scheduleJob = requiredTool(tools, "schedule_job");
  const listJobs = requiredTool(tools, "list_jobs");
  const getJob = requiredTool(tools, "get_job");
  const deleteJob = requiredTool(tools, "delete_job");
  const runJob = requiredTool(tools, "run_job");
  const jobLogs = requiredTool(tools, "job_logs");
  const enableProject = requiredTool(tools, "enable_project");
  const disableProject = requiredTool(tools, "disable_project");
  const listProjects = requiredTool(tools, "list_projects");
  const toolContext = { directory: project };

  const invalidCron = await scheduleJob.execute(
    { name: "Invalid", schedule: "not cron", prompt: "Never runs" },
    toolContext,
  );
  assert.equal(invalidCron.metadata?.error, true);
  assert.match(invalidCron.output, /^Error:/);

  const invalidRun = await scheduleJob.execute(
    {
      name: "Invalid",
      schedule: "0 9 * * *",
      prompt: "Choose one",
      command: "not-both",
    },
    toolContext,
  );
  assert.equal(invalidRun.metadata?.error, true);
  assert.match(invalidRun.output, /must set exactly one/);

  const invalidWorktree = await scheduleJob.execute(
    {
      name: "Invalid",
      schedule: "0 9 * * *",
      prompt: "No worktree",
      worktreeBase: "/tmp/somewhere",
    },
    toolContext,
  );
  assert.equal(invalidWorktree.metadata?.error, true);
  assert.match(invalidWorktree.output, /set worktree: true/);

  const guardedJob = await scheduleJob.execute(
    {
      name: "Guarded Review",
      schedule: "0 9 * * *",
      prompt: "Review the project.",
      guard: 'test ! -f "$BLOCK_FILE"',
      slug: "guarded-review",
    },
    toolContext,
  );
  assert.match(guardedJob.output, /Created job "Guarded Review"/);
  assert.match(guardedJob.output, /Project not enabled yet/);

  const cleanupJob = await scheduleJob.execute(
    {
      name: "Cleanup",
      schedule: "30 9 * * *",
      command: "cleanup",
      slug: "cleanup",
    },
    toolContext,
  );
  assert.match(cleanupJob.output, /Created job "Cleanup"/);

  const worktreeBase = join(work, "worktrees");
  const worktreeJob = await scheduleJob.execute(
    {
      name: "Worktree Sweep",
      schedule: "0 6 * * *",
      prompt: "Sweep the repo.",
      worktree: true,
      worktreeBase,
      slug: "worktree-sweep",
    },
    toolContext,
  );
  assert.match(worktreeJob.output, /Created job "Worktree Sweep"/);
  assert.match(worktreeJob.output, /Worktree: yes \(base/);
  const worktreeDefinition = JSON.parse(
    readFileSync(
      join(project, ".opencode", "jobs", "worktree-sweep.json"),
      "utf8",
    ),
  );
  assert.deepEqual(worktreeDefinition.worktree, { base: worktreeBase });

  execSync("git init -q", { cwd: project });
  execSync("git config user.email test@example.com", { cwd: project });
  execSync('git config user.name "Integration Test"', { cwd: project });
  execSync("git commit --allow-empty -qm init", { cwd: project });

  const enabled = await enableProject.execute({}, toolContext);
  assert.match(enabled.output, /Enabled 3 job\(s\)/);
  assert.match(enabled.output, /next: 2030-01-01 09:00:00 UTC/);

  const registryFile = join(config, "opencode", "jobs", "registry.json");
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  const registryEntry = registry.projects[resolve(project)];
  assert.ok(registryEntry);
  assert.deepEqual(registryEntry.jobs, [
    "cleanup",
    "guarded-review",
    "worktree-sweep",
  ]);
  const scope = registryEntry.scopeId;
  const unitPrefix = `opencode-sched-${scope}`;
  const systemdDirectory = join(config, "systemd", "user");
  const guardedScript = join(
    config,
    "opencode",
    "jobs",
    "scopes",
    scope,
    "run-guarded-review.sh",
  );
  const guardedTimer = join(
    systemdDirectory,
    `${unitPrefix}-guarded-review.timer`,
  );
  const guardedService = join(
    systemdDirectory,
    `${unitPrefix}-guarded-review.service`,
  );
  assert.equal(existsSync(guardedScript), true);
  assert.equal(existsSync(guardedTimer), true);
  assert.equal(existsSync(guardedService), true);
  assert.match(
    readFileSync(guardedTimer, "utf8"),
    /OnCalendar=\*-\*-\* 09:00:00/,
  );
  assert.match(readFileSync(guardedService, "utf8"), /Type=oneshot/);

  const projects = await listProjects.execute({}, toolContext);
  assert.match(projects.output, new RegExp(project.replaceAll("/", "\\/")));
  const listed = await listJobs.execute({}, toolContext);
  assert.match(listed.output, /Project enabled/);
  assert.match(listed.output, /guarded-review/);

  const runRecords = join(
    config,
    "opencode",
    "jobs",
    "runs",
    scope,
    "guarded-review.jsonl",
  );
  const started = await runJob.execute({ slug: "guarded-review" }, toolContext);
  assert.match(started.output, /Started "guarded-review" manually/);
  await waitFor(
    () =>
      readJsonLines(runRecords).filter((record) => record.status !== "running")
        .length === 1,
    "successful guarded run",
  );
  assert.deepEqual(
    readJsonLines(runRecords).map((record) => record.status),
    ["running", "success"],
  );
  assert.equal(
    readFileSync(opencodeCalls, "utf8").trim().split("\n").length,
    1,
  );

  writeFileSync(blockFile, "blocked\n");
  await runJob.execute({ slug: "guarded-review" }, toolContext);
  await waitFor(
    () =>
      readJsonLines(runRecords).filter((record) => record.status !== "running")
        .length === 2,
    "skipped guarded run",
  );
  const blockedRecords = readJsonLines(runRecords);
  assert.deepEqual(
    blockedRecords.map((record) => record.status),
    ["running", "success", "skipped"],
  );
  assert.equal(blockedRecords.at(-1).exitCode, 1);
  assert.equal(
    readFileSync(opencodeCalls, "utf8").trim().split("\n").length,
    1,
  );

  const logResult = await jobLogs.execute(
    { slug: "guarded-review", lines: 20 },
    toolContext,
  );
  assert.match(logResult.output, /fake opencode:/);
  assert.match(logResult.output, /guard exited 1, skipping run/);
  const shown = await getJob.execute({ slug: "guarded-review" }, toolContext);
  assert.match(shown.output, /skipped exit 1/);
  const listedAfterSkip = await listJobs.execute({}, toolContext);
  assert.match(listedAfterSkip.output, /last: skipped/);

  const missingGuardUpdate = await scheduleJob.execute(
    {
      name: "Guarded Review",
      schedule: "0 9 * * *",
      prompt: "Review the project.",
      guard: "missing-guard-command",
      slug: "guarded-review",
    },
    toolContext,
  );
  assert.match(missingGuardUpdate.output, /Re-synced systemd units/);
  await runJob.execute({ slug: "guarded-review" }, toolContext);
  await waitFor(
    () =>
      readJsonLines(runRecords).filter((record) => record.status !== "running")
        .length === 3,
    "missing-command guarded run",
  );
  const missingGuardRecords = readJsonLines(runRecords);
  assert.deepEqual(
    missingGuardRecords.map((record) => record.status),
    ["running", "success", "skipped", "skipped"],
  );
  assert.equal(missingGuardRecords.at(-1).exitCode, 127);
  assert.equal(
    readFileSync(opencodeCalls, "utf8").trim().split("\n").length,
    1,
  );

  const shownWorktree = await getJob.execute(
    { slug: "worktree-sweep" },
    toolContext,
  );
  assert.match(shownWorktree.output, /Worktree: fresh per run/);
  const worktreeRecords = join(
    config,
    "opencode",
    "jobs",
    "runs",
    scope,
    "worktree-sweep.jsonl",
  );
  await runJob.execute({ slug: "worktree-sweep" }, toolContext);
  await waitFor(
    () =>
      readJsonLines(worktreeRecords).filter(
        (record) => record.status !== "running",
      ).length === 1,
    "successful worktree run",
  );
  const worktreeRun = readJsonLines(worktreeRecords).at(-1);
  assert.equal(worktreeRun.status, "success");
  assert.match(worktreeRun.worktreeBranch, /^opencode-jobs\/worktree-sweep\//);
  assert.match(worktreeRun.worktreeCommit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(worktreeBase, "worktree-sweep")), false);
  execSync(
    `git -C ${project} cat-file -e ${worktreeRun.worktreeBranch}:wt-artifact.txt`,
  );
  const worktreeLog = await jobLogs.execute(
    { slug: "worktree-sweep", lines: 20 },
    toolContext,
  );
  assert.match(worktreeLog.output, /committed worktree changes to branch/);

  const cleanupTimer = join(systemdDirectory, `${unitPrefix}-cleanup.timer`);
  const cleanupService = join(
    systemdDirectory,
    `${unitPrefix}-cleanup.service`,
  );
  assert.equal(existsSync(cleanupTimer), true);
  const deleted = await deleteJob.execute({ slug: "cleanup" }, toolContext);
  assert.match(deleted.output, /Removed systemd units/);
  assert.equal(existsSync(cleanupTimer), false);
  assert.equal(existsSync(cleanupService), false);
  const registryAfterDelete = JSON.parse(readFileSync(registryFile, "utf8"));
  assert.deepEqual(registryAfterDelete.projects[resolve(project)].jobs, [
    "guarded-review",
    "worktree-sweep",
  ]);

  const disabled = await disableProject.execute({}, toolContext);
  assert.match(disabled.output, /Disabled 2 job\(s\)/);
  assert.equal(existsSync(guardedTimer), false);
  assert.equal(existsSync(guardedService), false);
  assert.equal(existsSync(guardedScript), false);
  assert.equal(
    existsSync(join(project, ".opencode", "jobs", "guarded-review.json")),
    true,
  );
  assert.equal(existsSync(runRecords), true);
  const noProjects = await listProjects.execute({}, toolContext);
  assert.match(noProjects.output, /No projects/);

  const systemctlCalls = readFileSync(systemctlLog, "utf8");
  assert.match(systemctlCalls, /--user daemon-reload/);
  assert.match(systemctlCalls, /--user enable --now/);
  assert.match(systemctlCalls, /--user disable --now/);
});
