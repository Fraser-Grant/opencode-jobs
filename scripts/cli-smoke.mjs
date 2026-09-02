#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repo, "dist", "cli.js");
const work = "/tmp/opencode/opencode-jobs-cli-smoke";
const demoFixture = join(repo, "scripts", "fixtures", "demo");
const isolatedConfigHome = join(work, "cli-config-home");
const isolatedStateHome = join(work, "cli-state-home");

function runCli(arguments_, options = {}) {
  const { env, ...rest } = options;
  return execFileSync(process.execPath, [cli, ...arguments_], {
    encoding: "utf8",
    ...rest,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedConfigHome,
      XDG_STATE_HOME: isolatedStateHome,
      ...env,
    },
  });
}

function runCliFailure(arguments_, options = {}) {
  try {
    runCli(arguments_, { ...options, stdio: "pipe" });
    assert.fail("expected CLI command to fail");
  } catch (error) {
    assert.equal(error.status, 1);
    return JSON.parse(error.stdout);
  }
}

function runInstall(project, options = {}) {
  return runCli(["install", project], options);
}

function runUninstall(project, extraArguments = [], options = {}) {
  return runCli(["uninstall", project, ...extraArguments], options);
}

function scopeIdFor(project) {
  const hash = createHash("sha256").update(project).digest("hex").slice(0, 12);
  return `${project.split("/").pop()}-${hash}`;
}

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(join(directory, entry.name), relative)
      : [relative];
  });
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(isolatedConfigHome, { recursive: true });
mkdirSync(isolatedStateHome, { recursive: true });

const demoProject = join(work, "demo");
cpSync(demoFixture, demoProject, { recursive: true });
const demoBefore = JSON.parse(
  readFileSync(join(demoProject, "opencode.json"), "utf8"),
);
const demoInstall = JSON.parse(runInstall(demoProject));
assert.equal(demoInstall.plugin.status, "added");
assert.equal(demoInstall.skill.status, "written");
assert.deepEqual(listFiles(demoProject).toSorted(), [
  ".opencode/skills/opencode-jobs/SKILL.md",
  "README.md",
  "opencode.json",
]);
assert.deepEqual(
  JSON.parse(readFileSync(join(demoProject, "opencode.json"), "utf8")),
  {
    $schema: "https://opencode.ai/config.json",
    model: "provider/model",
    plugin: ["existing-plugin", "opencode-jobs"],
  },
);
assert.equal(
  readFileSync(
    join(demoProject, ".opencode/skills/opencode-jobs/SKILL.md"),
    "utf8",
  ),
  readFileSync(join(repo, "skill/opencode-jobs/SKILL.md"), "utf8"),
);
const demoRepeat = JSON.parse(runInstall(demoProject));
assert.equal(demoRepeat.plugin.status, "present");
assert.equal(demoRepeat.skill.status, "unchanged");
runUninstall(demoProject);
assert.deepEqual(listFiles(demoProject).toSorted(), [
  "README.md",
  "opencode.json",
]);
assert.deepEqual(
  JSON.parse(readFileSync(join(demoProject, "opencode.json"), "utf8")),
  demoBefore,
);

const first = JSON.parse(runInstall(work));
assert.equal(first.plugin.status, "added");
assert.equal(first.skill.status, "written");
assert.deepEqual(
  JSON.parse(readFileSync(join(work, "opencode.json"), "utf8")),
  {
    $schema: "https://opencode.ai/config.json",
    plugin: ["opencode-jobs"],
  },
);
assert.equal(
  readFileSync(join(work, ".opencode/skills/opencode-jobs/SKILL.md"), "utf8"),
  readFileSync(join(repo, "skill/opencode-jobs/SKILL.md"), "utf8"),
);

const second = JSON.parse(runInstall(work));
assert.equal(second.plugin.status, "present");
assert.equal(second.skill.status, "unchanged");

const mergeProject = join(work, "merge");
mkdirSync(mergeProject);
writeFileSync(
  join(mergeProject, "opencode.json"),
  `${JSON.stringify({ model: "provider/model", plugin: [["other-plugin", { enabled: true }]] })}\n`,
);
runInstall(mergeProject);
assert.deepEqual(
  JSON.parse(readFileSync(join(mergeProject, "opencode.json"), "utf8")),
  {
    model: "provider/model",
    plugin: [["other-plugin", { enabled: true }], "opencode-jobs"],
  },
);

const nestedConfigProject = join(work, "nested-config");
mkdirSync(join(nestedConfigProject, ".opencode"), { recursive: true });
writeFileSync(
  join(nestedConfigProject, ".opencode/opencode.json"),
  '{"plugin":[]}\n',
);
runInstall(nestedConfigProject);
assert.deepEqual(
  JSON.parse(
    readFileSync(join(nestedConfigProject, ".opencode/opencode.json"), "utf8"),
  ).plugin,
  ["opencode-jobs"],
);

const jsoncProject = join(work, "jsonc");
mkdirSync(jsoncProject);
const jsonc = '{\n  // keep this comment\n  "plugin": []\n}\n';
writeFileSync(join(jsoncProject, "opencode.jsonc"), jsonc);
assert.throws(() => runInstall(jsoncProject, { stdio: "pipe" }));
assert.equal(readFileSync(join(jsoncProject, "opencode.jsonc"), "utf8"), jsonc);
assert.equal(
  readFileSync(
    join(jsoncProject, ".opencode/skills/opencode-jobs/SKILL.md"),
    "utf8",
  ),
  readFileSync(join(repo, "skill/opencode-jobs/SKILL.md"), "utf8"),
);

// uninstall: manual config exits non-zero, file untouched, skill still removed
assert.throws(() => runUninstall(jsoncProject, [], { stdio: "pipe" }));
assert.equal(readFileSync(join(jsoncProject, "opencode.jsonc"), "utf8"), jsonc);
assert.equal(
  existsSync(join(jsoncProject, ".opencode/skills/opencode-jobs/SKILL.md")),
  false,
);
assert.equal(existsSync(join(jsoncProject, ".opencode")), false);

// uninstall: installer-created config is deleted, .opencode cleaned up
const mainUninstall = JSON.parse(runUninstall(work));
assert.equal(mainUninstall.disabled, false);
assert.equal(mainUninstall.plugin.status, "removed");
assert.equal(mainUninstall.skill.status, "removed");
assert.equal(existsSync(join(work, "opencode.json")), false);
assert.equal(existsSync(join(work, ".opencode")), false);

// uninstall is idempotent
const repeatUninstall = JSON.parse(runUninstall(work));
assert.equal(repeatUninstall.plugin.status, "absent");
assert.equal(repeatUninstall.skill.status, "absent");

// uninstall: unknown options are rejected
assert.throws(() => runUninstall(work, ["--nope"], { stdio: "pipe" }));

// uninstall: array entry form removed, other plugins kept, modified skill kept
const mergeSkill = join(
  mergeProject,
  ".opencode/skills/opencode-jobs/SKILL.md",
);
writeFileSync(mergeSkill, "locally modified\n");
const mergeUninstall = JSON.parse(runUninstall(mergeProject));
assert.equal(mergeUninstall.plugin.status, "removed");
assert.equal(mergeUninstall.skill.status, "kept-modified");
assert.deepEqual(
  JSON.parse(readFileSync(join(mergeProject, "opencode.json"), "utf8")),
  { model: "provider/model", plugin: [["other-plugin", { enabled: true }]] },
);
assert.equal(readFileSync(mergeSkill, "utf8"), "locally modified\n");

// uninstall: empty plugin array collapses to an empty object, file kept
const nestedUninstall = JSON.parse(runUninstall(nestedConfigProject));
assert.equal(nestedUninstall.plugin.status, "removed");
assert.deepEqual(
  JSON.parse(
    readFileSync(join(nestedConfigProject, ".opencode/opencode.json"), "utf8"),
  ),
  {},
);

// version-qualified entries are recognized: no duplicate on install,
// removed on uninstall (string and tuple forms)
const versionedProject = join(work, "versioned");
mkdirSync(versionedProject);
writeFileSync(
  join(versionedProject, "opencode.json"),
  `${JSON.stringify({ plugin: ["opencode-jobs@1.2.3"] })}\n`,
);
const versionedInstall = JSON.parse(runInstall(versionedProject));
assert.equal(versionedInstall.plugin.status, "present");
assert.deepEqual(
  JSON.parse(readFileSync(join(versionedProject, "opencode.json"), "utf8")),
  { plugin: ["opencode-jobs@1.2.3"] },
);
writeFileSync(
  join(versionedProject, "opencode.json"),
  `${JSON.stringify({ plugin: [["opencode-jobs@1.2.3", { enabled: false }]] })}\n`,
);
const tupleInstall = JSON.parse(runInstall(versionedProject));
assert.equal(tupleInstall.plugin.status, "present");
const versionedUninstall = JSON.parse(runUninstall(versionedProject));
assert.equal(versionedUninstall.plugin.status, "removed");
assert.deepEqual(
  JSON.parse(readFileSync(join(versionedProject, "opencode.json"), "utf8")),
  {},
);

// Management commands share the plugin operations and emit machine-readable
// results while using the requested project rather than the CLI process cwd.
const managementProject = join(work, "management-project");
const managementBin = join(work, "management-bin");
mkdirSync(join(managementProject, ".opencode", "jobs"), { recursive: true });
mkdirSync(managementBin);
writeFileSync(
  join(managementProject, ".opencode", "jobs", "demo.json"),
  `${JSON.stringify({
    slug: "demo",
    name: "CLI Demo",
    schedule: "0 9 * * *",
    run: { prompt: "Run from the CLI" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })}\n`,
);
writeFileSync(
  join(managementBin, "systemctl"),
  '#!/bin/sh\nfor arg do\n  if [ "${FAIL_SYSTEMCTL_ACTION:-}" = "$arg" ]; then\n    echo "forced $arg failure" >&2\n    exit 1\n  fi\ndone\nexit 0\n',
);
writeFileSync(
  join(managementBin, "opencode"),
  "#!/bin/sh\nprintf '%s\\n' '{\"sessionID\":\"ses_cli\"}'\n",
);
chmodSync(join(managementBin, "systemctl"), 0o755);
chmodSync(join(managementBin, "opencode"), 0o755);
const managementEnvironment = {
  PATH: `${managementBin}:${process.env.PATH ?? ""}`,
};
const listedDisabled = JSON.parse(
  runCli(["list", managementProject], { env: managementEnvironment }),
);
assert.equal(listedDisabled.ok, true);
assert.match(listedDisabled.output, /Project not enabled/);
assert.match(listedDisabled.output, /demo: 0 9 \* \* \*/);
const failedEnable = runCliFailure(["enable", managementProject], {
  env: { ...managementEnvironment, FAIL_SYSTEMCTL_ACTION: "enable" },
});
assert.equal(failedEnable.ok, false);
assert.match(failedEnable.output, /Timer activation failures/);
const listedAfterFailedEnable = JSON.parse(
  runCli(["list", managementProject], { env: managementEnvironment }),
);
assert.match(listedAfterFailedEnable.output, /Project enabled/);
const enabled = JSON.parse(
  runCli(["enable", managementProject], { env: managementEnvironment }),
);
assert.equal(enabled.ok, true);
assert.match(enabled.output, /Enabled 1 job/);
const listedEnabled = JSON.parse(
  runCli(["list", managementProject], { env: managementEnvironment }),
);
assert.match(listedEnabled.output, /Project enabled/);
const started = JSON.parse(
  runCli(["run", "demo", managementProject], {
    env: managementEnvironment,
  }),
);
assert.equal(started.ok, true);
assert.match(started.output, /Started "demo" manually/);
const failedDisable = runCliFailure(["disable", managementProject], {
  env: { ...managementEnvironment, FAIL_SYSTEMCTL_ACTION: "disable" },
});
assert.equal(failedDisable.ok, false);
assert.match(failedDisable.output, /Timer removal failures/);
const listedAfterFailedDisable = JSON.parse(
  runCli(["list", managementProject], { env: managementEnvironment }),
);
assert.match(listedAfterFailedDisable.output, /Project enabled/);
const failedReload = runCliFailure(["disable", managementProject], {
  env: { ...managementEnvironment, FAIL_SYSTEMCTL_ACTION: "daemon-reload" },
});
assert.equal(failedReload.ok, false);
assert.match(failedReload.output, /daemon-reload failed/);
const listedAfterFailedReload = JSON.parse(
  runCli(["list", managementProject], { env: managementEnvironment }),
);
assert.match(listedAfterFailedReload.output, /Project enabled/);
const disabled = JSON.parse(
  runCli(["disable", managementProject], { env: managementEnvironment }),
);
assert.equal(disabled.ok, true);
assert.match(disabled.output, /Disabled 1 job/);
const failedRun = runCliFailure(["run", "demo", managementProject], {
  env: managementEnvironment,
});
assert.equal(failedRun.ok, false);
assert.match(failedRun.output, /Project is not enabled/);
const invalidArguments = runCliFailure(["list", managementProject, "extra"]);
assert.equal(invalidArguments.ok, false);
assert.match(invalidArguments.output, /at most one project directory/);

// A 0.1.x install migrates definitions and global state, then re-syncs the
// registered project so existing unit names point at the new paths.
const migrationProject = join(work, "migration-project");
const migrationHome = join(work, "migration-home");
const migrationState = join(work, "migration-state");
const migrationBin = join(work, "migration-bin");
const migrationSystemctlLog = join(work, "migration-systemctl.log");
const migrationScope = scopeIdFor(migrationProject);
mkdirSync(join(migrationProject, ".opencode", "scheduler", "jobs"), {
  recursive: true,
});
writeFileSync(
  join(migrationProject, ".opencode", "scheduler", "jobs", "demo.json"),
  `${JSON.stringify({
    slug: "demo",
    name: "Migrated Demo",
    schedule: "0 9 * * *",
    run: { prompt: "Continue the existing job" },
    session: "persist",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })}\n`,
);
const legacyJobsState = join(migrationHome, "opencode", "scheduler");
mkdirSync(join(legacyJobsState, "runs", migrationScope), { recursive: true });
mkdirSync(join(legacyJobsState, "sessions", migrationScope), {
  recursive: true,
});
writeFileSync(
  join(legacyJobsState, "runs", migrationScope, "demo.jsonl"),
  '{"status":"success"}\n',
);
writeFileSync(
  join(legacyJobsState, "sessions", migrationScope, "demo.txt"),
  "ses_preserved\n",
);
writeFileSync(
  join(legacyJobsState, "registry.json"),
  `${JSON.stringify({
    version: 1,
    projects: {
      [migrationProject]: {
        scopeId: migrationScope,
        workdir: migrationProject,
        enabledAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        jobs: ["demo"],
      },
    },
  })}\n`,
);
mkdirSync(
  join(migrationHome, "opencode", "logs", "scheduler", migrationScope),
  {
    recursive: true,
  },
);
writeFileSync(
  join(
    migrationHome,
    "opencode",
    "logs",
    "scheduler",
    migrationScope,
    "demo.log",
  ),
  "preserved log\n",
);
mkdirSync(
  join(migrationState, "opencode", "scheduler", "worktrees", migrationScope),
  { recursive: true },
);
writeFileSync(
  join(
    migrationState,
    "opencode",
    "scheduler",
    "worktrees",
    migrationScope,
    "preserved.txt",
  ),
  "preserved worktree state\n",
);
mkdirSync(migrationBin, { recursive: true });
writeFileSync(
  join(migrationBin, "systemctl"),
  '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$SYSTEMCTL_LOG"\nexit 0\n',
);
chmodSync(join(migrationBin, "systemctl"), 0o755);
const migrationEnvironment = {
  ...process.env,
  OPENCODE_JOBS_OPENCODE_PATH: "/bin/true",
  PATH: `${migrationBin}:${process.env.PATH ?? ""}`,
  SYSTEMCTL_LOG: migrationSystemctlLog,
  XDG_CONFIG_HOME: migrationHome,
  XDG_STATE_HOME: migrationState,
};
const migratedInstall = JSON.parse(
  runInstall(migrationProject, { env: migrationEnvironment }),
);
assert.equal(migratedInstall.migration.moved.length, 4);
assert.deepEqual(migratedInstall.migration.resyncedProjects, [
  migrationProject,
]);
assert.equal(
  existsSync(join(migrationProject, ".opencode", "jobs", "demo.json")),
  true,
);
assert.equal(
  readFileSync(
    join(
      migrationHome,
      "opencode",
      "jobs",
      "runs",
      migrationScope,
      "demo.jsonl",
    ),
    "utf8",
  ),
  '{"status":"success"}\n',
);
assert.equal(
  readFileSync(
    join(
      migrationHome,
      "opencode",
      "jobs",
      "sessions",
      migrationScope,
      "demo.txt",
    ),
    "utf8",
  ),
  "ses_preserved\n",
);
assert.equal(
  readFileSync(
    join(migrationHome, "opencode", "logs", "jobs", migrationScope, "demo.log"),
    "utf8",
  ),
  "preserved log\n",
);
assert.equal(
  existsSync(
    join(
      migrationState,
      "opencode",
      "jobs",
      "worktrees",
      migrationScope,
      "preserved.txt",
    ),
  ),
  true,
);
assert.equal(existsSync(legacyJobsState), false);
assert.equal(
  existsSync(join(migrationProject, ".opencode", "scheduler")),
  false,
);
const migratedScript = readFileSync(
  join(
    migrationHome,
    "opencode",
    "jobs",
    "scopes",
    migrationScope,
    "run-demo.sh",
  ),
  "utf8",
);
assert.match(migratedScript, /opencode\/jobs\/runs/);
assert.doesNotMatch(migratedScript, /opencode\/scheduler\//);
assert.match(readFileSync(migrationSystemctlLog, "utf8"), /enable --now/);
const repeatedMigration = JSON.parse(
  runInstall(migrationProject, { env: migrationEnvironment }),
);
assert.equal(repeatedMigration.migration, undefined);

const conflictProject = join(work, "migration-conflict");
mkdirSync(join(conflictProject, ".opencode", "scheduler", "jobs"), {
  recursive: true,
});
mkdirSync(join(conflictProject, ".opencode", "jobs"), { recursive: true });
const legacyConflict = join(
  conflictProject,
  ".opencode",
  "scheduler",
  "jobs",
  "demo.json",
);
const canonicalConflict = join(
  conflictProject,
  ".opencode",
  "jobs",
  "demo.json",
);
writeFileSync(legacyConflict, "legacy\n");
writeFileSync(canonicalConflict, "canonical\n");
assert.throws(() =>
  runInstall(conflictProject, {
    env: migrationEnvironment,
    stdio: "pipe",
  }),
);
assert.equal(readFileSync(legacyConflict, "utf8"), "legacy\n");
assert.equal(readFileSync(canonicalConflict, "utf8"), "canonical\n");

// uninstall --purge: job data under XDG_CONFIG_HOME and job
// definitions are removed; registry lookups stay inside the fake home
const purgeProject = join(work, "purge-project");
mkdirSync(join(purgeProject, ".opencode", "jobs"), {
  recursive: true,
});
writeFileSync(join(purgeProject, ".opencode", "jobs", "demo.json"), "{}\n");
const fakeHome = join(work, "fake-home");
const fakeState = join(work, "fake-state");
const scopeId = scopeIdFor(purgeProject);
for (const part of [
  join("opencode", "jobs", "scopes", scopeId),
  join("opencode", "jobs", "runs", scopeId),
  join("opencode", "jobs", "sessions", scopeId),
  join("opencode", "jobs", "locks", scopeId),
  join("opencode", "logs", "jobs", scopeId),
]) {
  mkdirSync(join(fakeHome, part), { recursive: true });
}
mkdirSync(join(fakeState, "opencode", "jobs", "worktrees", scopeId), {
  recursive: true,
});
const purgeUninstall = JSON.parse(
  runUninstall(purgeProject, ["--purge"], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: fakeHome,
      XDG_STATE_HOME: fakeState,
    },
  }),
);
assert.equal(purgeUninstall.disabled, false);
assert.equal(purgeUninstall.purge.paths.length, 7);
assert.equal(
  existsSync(join(fakeHome, "opencode", "jobs", "runs", scopeId)),
  false,
);
assert.equal(
  existsSync(join(fakeHome, "opencode", "logs", "jobs", scopeId)),
  false,
);
assert.equal(
  existsSync(join(fakeState, "opencode", "jobs", "worktrees", scopeId)),
  false,
  "purge must remove job worktrees from XDG state",
);
assert.equal(existsSync(join(purgeProject, ".opencode", "jobs")), false);
assert.equal(existsSync(join(purgeProject, ".opencode")), false);

const pack = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repo,
    encoding: "utf8",
  }),
);
const files = pack[0].files.map((file) => file.path);
assert.ok(files.includes("dist/cli.js"));
assert.ok(files.includes("skill/opencode-jobs/SKILL.md"));

console.log("CLI_SMOKE_OK");
