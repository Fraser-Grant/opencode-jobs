#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repo, "dist", "cli.js");
const work = "/tmp/opencode/opencode-jobs-cli-smoke";

function runCli(arguments_, options = {}) {
  return execFileSync(process.execPath, [cli, ...arguments_], {
    encoding: "utf8",
    ...options,
  });
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

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

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

// uninstall --purge: scheduler data under XDG_CONFIG_HOME and job
// definitions are removed; registry lookups stay inside the fake home
const purgeProject = join(work, "purge-project");
mkdirSync(join(purgeProject, ".opencode", "scheduler", "jobs"), {
  recursive: true,
});
writeFileSync(
  join(purgeProject, ".opencode", "scheduler", "jobs", "demo.json"),
  "{}\n",
);
const fakeHome = join(work, "fake-home");
const scopeId = scopeIdFor(purgeProject);
for (const part of [
  join("opencode", "scheduler", "scopes", scopeId),
  join("opencode", "scheduler", "runs", scopeId),
  join("opencode", "scheduler", "sessions", scopeId),
  join("opencode", "logs", "scheduler", scopeId),
]) {
  mkdirSync(join(fakeHome, part), { recursive: true });
}
const purgeUninstall = JSON.parse(
  runUninstall(purgeProject, ["--purge"], {
    env: { ...process.env, XDG_CONFIG_HOME: fakeHome },
  }),
);
assert.equal(purgeUninstall.disabled, false);
assert.equal(purgeUninstall.purge.paths.length, 5);
assert.equal(
  existsSync(join(fakeHome, "opencode", "scheduler", "runs", scopeId)),
  false,
);
assert.equal(
  existsSync(join(fakeHome, "opencode", "logs", "scheduler", scopeId)),
  false,
);
assert.equal(existsSync(join(purgeProject, ".opencode", "scheduler")), false);
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
