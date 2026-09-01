#!/usr/bin/env node
// Smoke test for opencode-jobs: compiles the pure modules, verifies cron
// parsing/quoting/unit generation against real systemd-analyze, and executes a
// generated run script against a fake opencode binary to check run records.
// Not part of `npm run check` (needs systemd-analyze + dash); run via `npm run smoke`.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(repo, "node_modules", ".cache", "smoke");
const work = "/tmp/opencode/opencode-jobs-smoke";

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
process.env.XDG_CONFIG_HOME = join(buildDir, "config");
execSync(
  "npx tsc src/index.ts src/internals.ts --outDir node_modules/.cache/smoke --module es2022 --moduleResolution bundler --target es2022 --lib es2023 --skipLibCheck --strict --types node",
  { cwd: repo, stdio: "inherit" },
);
writeFileSync(join(buildDir, "package.json"), '{"type":"module"}');
const { internals } = await import(join(buildDir, "internals.js"));
const { loadJobFile } = await import(join(buildDir, "job.js"));
const { registryPath, runsFile } = await import(join(buildDir, "paths.js"));
const { loadRegistry } = await import(join(buildDir, "registry.js"));
const { readRunRecords } = await import(join(buildDir, "runs.js"));

const {
  parseCron,
  cronToOnCalendar,
  describeCron,
  shQuote,
  slugify,
  deriveScopeId,
  buildOpencodeArguments,
  runScriptContent,
  serviceContent,
  timerContent,
  validateRunSpec,
  validateGuard,
  validateSession,
  validateWorktree,
} = internals;

for (const [expr, expected] of [
  ["0 9 * * *", { minute: [0], hour: [9] }],
  ["0 */6 * * *", { hour: [0, 6, 12, 18] }],
  ["30 8 * * 1-5", { dow: [1, 2, 3, 4, 5] }],
  ["0 9 * * 7", { dow: [0] }],
  ["0 9 * * sun", { dow: [0] }],
  ["15 9 1,15 * *", { dom: [1, 15] }],
]) {
  const sets = parseCron(expr);
  for (const [field, values] of Object.entries(expected)) {
    assert.deepEqual(sets[field], values, `${expr} ${field}`);
  }
}
for (const bad of [
  "61 9 * * *",
  "0 9 * *",
  "0 9 * * 8",
  "*/0 * * * *",
  "5-2 * * * *",
]) {
  assert.throws(() => parseCron(bad), `expected throw: ${bad}`);
}
assert.deepEqual(cronToOnCalendar(parseCron("0 9 * * *")), ["*-*-* 09:00:00"]);
assert.deepEqual(cronToOnCalendar(parseCron("0 */6 * * *")), [
  "*-*-* 00,06,12,18:00:00",
]);
assert.deepEqual(cronToOnCalendar(parseCron("30 8 * * 1-5")), [
  "Mon,Tue,Wed,Thu,Fri *-*-* 08:30:00",
]);
assert.deepEqual(cronToOnCalendar(parseCron("0 9 1 * mon")), [
  "Mon *-*-* 09:00:00",
  "*-*-01 09:00:00",
]);
assert.equal(shQuote("it's"), "'it'\\''s'");
assert.equal(slugify("My Cool Job!"), "my-cool-job");
assert.match(deriveScopeId("/tmp/proj"), /^proj-[0-9a-f]{12}$/);
assert.deepEqual(
  buildOpencodeArguments({
    slug: "s",
    name: "n",
    schedule: "0 9 * * *",
    run: { prompt: "hi", agent: "build" },
    createdAt: "t",
    updatedAt: "t",
  }),
  ["run", "--agent", "build", "--", "hi"],
);
assert.deepEqual(
  buildOpencodeArguments({
    slug: "s",
    name: "n",
    schedule: "0 9 * * *",
    run: { command: "deploy", arguments: "staging" },
    createdAt: "t",
    updatedAt: "t",
  }),
  ["run", "--command", "deploy", "--", "staging"],
);
assert.throws(() => validateRunSpec({}, "x"));
assert.throws(() => validateRunSpec({ prompt: "a", command: "b" }, "x"));
assert.deepEqual(validateRunSpec({ command: "b", arguments: "c" }, "x"), {
  command: "b",
  arguments: "c",
});
assert.deepEqual(validateRunSpec({ prompt: "a" }, "x"), { prompt: "a" });
assert.throws(() => validateRunSpec({ prompt: "a", arguments: "z" }, "x"));
assert.equal(validateGuard(undefined, "x"), undefined);
assert.equal(validateGuard("! git diff --quiet", "x"), "! git diff --quiet");
assert.throws(() => validateGuard("", "x"));
assert.throws(() => validateGuard(7, "x"));
assert.equal(validateSession(undefined, "x"), "new");
assert.equal(validateSession("persist", "x"), "persist");
assert.equal(validateSession("compact", "x"), "compact");
assert.equal(validateSession("compact+last", "x"), "compact+last");
assert.throws(() => validateSession("sometimes", "x"));
assert.throws(() => validateSession(7, "x"));
assert.equal(validateWorktree(undefined, "x"), undefined);
assert.deepEqual(validateWorktree(true, "x"), {});
assert.deepEqual(validateWorktree({ base: "/tmp/wt" }, "x"), {
  base: "/tmp/wt",
});
assert.deepEqual(
  validateWorktree({ ref: "origin/main", commitMessage: "save" }, "x"),
  { ref: "origin/main", commitMessage: "save" },
);
assert.throws(() => validateWorktree(false, "x"));
assert.throws(() => validateWorktree({ base: "" }, "x"));
assert.throws(() => validateWorktree({ baseX: 1 }, "x"));

const jobFile = join(buildDir, "validated-job.json");
const validJobDefinition = {
  name: "Validated Job",
  schedule: "0 9 * * *",
  run: { prompt: "Review the project" },
};
writeFileSync(jobFile, JSON.stringify(validJobDefinition));
const validJobResult = loadJobFile(jobFile);
assert.equal(validJobResult.ok, true);
assert.equal(validJobResult.job.slug, "validated-job");
assert.equal(validJobResult.job.session, undefined);
assert.equal(validJobResult.job.createdAt, validJobResult.job.updatedAt);

writeFileSync(jobFile, JSON.stringify({ ...validJobDefinition, slug: 7 }));
const invalidSlugResult = loadJobFile(jobFile);
assert.equal(invalidSlugResult.ok, false);
assert.match(invalidSlugResult.error, /"slug"/);

writeFileSync(
  jobFile,
  JSON.stringify({ ...validJobDefinition, timeoutSecond: 60 }),
);
const unknownFieldResult = loadJobFile(jobFile);
assert.equal(unknownFieldResult.ok, false);
assert.match(unknownFieldResult.error, /timeoutSecond/);

writeFileSync(
  jobFile,
  JSON.stringify({
    ...validJobDefinition,
    run: { prompt: "Review the project", arguments: "unexpected" },
  }),
);
const invalidRunResult = loadJobFile(jobFile);
assert.equal(invalidRunResult.ok, false);
assert.match(invalidRunResult.error, /run\.arguments/);

writeFileSync(
  jobFile,
  JSON.stringify({ ...validJobDefinition, worktree: true }),
);
const worktreeJobResult = loadJobFile(jobFile);
assert.equal(worktreeJobResult.ok, true);
assert.deepEqual(worktreeJobResult.job.worktree, {});

writeFileSync(
  jobFile,
  JSON.stringify({ ...validJobDefinition, worktree: { baseX: 1 } }),
);
const invalidWorktreeResult = loadJobFile(jobFile);
assert.equal(invalidWorktreeResult.ok, false);
assert.match(invalidWorktreeResult.error, /worktree/);

const registryFile = registryPath();
mkdirSync(dirname(registryFile), { recursive: true });
writeFileSync(
  registryFile,
  JSON.stringify({
    version: 1,
    projects: {
      valid: {
        scopeId: "scope",
        workdir: "/project",
        enabledAt: "created",
        updatedAt: "updated",
        jobs: ["job"],
      },
      invalid: { scopeId: 7 },
    },
  }),
);
assert.deepEqual(Object.keys(loadRegistry().projects), ["valid"]);

const tolerantRunsFile = runsFile("schema", "history");
mkdirSync(dirname(tolerantRunsFile), { recursive: true });
writeFileSync(
  tolerantRunsFile,
  [
    JSON.stringify({ status: "success", durationMs: 1000 }),
    "malformed",
    JSON.stringify({ status: 7, startedBy: "manual" }),
    JSON.stringify([]),
  ].join("\n"),
);
assert.deepEqual(readRunRecords("schema", "history", 10), [
  { status: "success", durationMs: 1000 },
  { status: undefined, startedBy: "manual" },
]);

assert.deepEqual(
  buildOpencodeArguments(
    {
      slug: "s",
      name: "n",
      schedule: "0 9 * * *",
      run: { prompt: "hi", agent: "build" },
      createdAt: "t",
      updatedAt: "t",
    },
    "ses_1",
  ),
  ["run", "--agent", "build", "--session", "ses_1", "--", "hi"],
);
assert.match(describeCron(parseCron("0 9 * * 1-5")), /^at 09:00 on Mon/);

const job = {
  slug: "smoke",
  name: "Smoke Job",
  schedule: "30 8 * * 1-5",
  run: { prompt: "say hi -- it's fine" },
  timeoutSeconds: 600,
  createdAt: "t",
  updatedAt: "t",
};
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "bin"), { recursive: true });
writeFileSync(
  join(work, "bin", "opencode"),
  '#!/bin/sh\necho "fake opencode: $*"\nexit ${FAKE_EXIT:-0}\n',
);
chmodSync(join(work, "bin", "opencode"), 0o755);

const scriptPath = join(work, "run-smoke.sh");
writeFileSync(
  scriptPath,
  runScriptContent(job, "smoke-scope", join(work, "bin", "opencode")),
);
chmodSync(scriptPath, 0o755);
execSync(`sh -n ${scriptPath}`);
execSync(`dash -n ${scriptPath}`);

const svcPath = join(work, "opencode-sched-smoke.service");
const timerPath = join(work, "opencode-sched-smoke.timer");
writeFileSync(
  svcPath,
  serviceContent(job, {
    workdir: work,
    runScript: scriptPath,
    log: join(work, "smoke.log"),
    pathEnv: process.env.PATH ?? "",
  }),
);
writeFileSync(
  timerPath,
  timerContent(job, cronToOnCalendar(parseCron(job.schedule))),
);
execSync(`systemd-analyze verify ${svcPath} ${timerPath}`);

const records = join(
  work,
  "xdg",
  "opencode",
  "jobs",
  "runs",
  "smoke-scope",
  "smoke.jsonl",
);
function runScript(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", [scriptPath], {
      env: { ...process.env, XDG_CONFIG_HOME: join(work, "xdg"), ...env },
    });
    child.on("exit", (code) => resolve(code));
  });
}
assert.equal(await runScript(), 0);
assert.equal(await runScript({ FAKE_EXIT: "3" }), 3);

const lines = execSync(`cat ${records}`)
  .toString()
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const finished = lines.filter((line) => line.status !== "running");
assert.equal(finished.at(-2).status, "success");
assert.equal(finished.at(-1).status, "failed");
assert.equal(finished.at(-1).exitCode, 3);

const guardJob = {
  slug: "gsmoke",
  name: "Guard Job",
  schedule: "0 9 * * *",
  run: { prompt: "hi" },
  guard: 'test "${GUARD_BLOCK:-0}" != "1"',
  createdAt: "t",
  updatedAt: "t",
};
writeFileSync(
  join(work, "bin", "opencode-mark"),
  '#!/bin/sh\necho ran >> "$MARK_FILE"\nexit 0\n',
);
chmodSync(join(work, "bin", "opencode-mark"), 0o755);
const guardScriptPath = join(work, "run-gsmoke.sh");
writeFileSync(
  guardScriptPath,
  runScriptContent(guardJob, "guard-scope", join(work, "bin", "opencode-mark")),
);
chmodSync(guardScriptPath, 0o755);
execSync(`sh -n ${guardScriptPath}`);
execSync(`dash -n ${guardScriptPath}`);

const mark = join(work, "gsmoke.marks");
const guardRecords = join(
  work,
  "xdg",
  "opencode",
  "jobs",
  "runs",
  "guard-scope",
  "gsmoke.jsonl",
);
function runGuardScript(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", [guardScriptPath], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(work, "xdg"),
        MARK_FILE: mark,
        ...env,
      },
    });
    child.on("exit", (code) => resolve(code));
  });
}
assert.equal(await runGuardScript(), 0);
assert.equal(await runGuardScript({ GUARD_BLOCK: "1" }), 0);
assert.equal(
  execSync(`cat ${mark}`).toString().trim().split("\n").length,
  1,
  "opencode must run once despite a second guarded invocation",
);
const guardLines = execSync(`cat ${guardRecords}`)
  .toString()
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert.equal(guardLines.length, 3, "blocked run must not emit a running line");
assert.equal(guardLines.at(-2).status, "success");
assert.equal(guardLines.at(-1).status, "skipped");
assert.equal(guardLines.at(-1).exitCode, 1);

// Session modes: persist / compact / compact+last run scripts against a fake
// opencode (run + serve) and a fake curl, checking continuation, state files,
// compaction env, and summarize calls. Recovery from a stale session id too.
const sessionWork = "/tmp/opencode/opencode-jobs-smoke-session";
rmSync(sessionWork, { recursive: true, force: true });
mkdirSync(join(sessionWork, "bin"), { recursive: true });
writeFileSync(
  join(sessionWork, "bin", "opencode"),
  [
    "#!/bin/sh",
    'if [ "$1" = "serve" ]; then',
    '  echo "serve env=$OPENCODE_CONFIG_CONTENT" >> "$MARK"',
    '  echo "opencode server listening on http://127.0.0.1:41299"',
    "  sleep 30",
    "  exit 0",
    "fi",
    'echo "run args=$*" >> "$MARK"',
    'sess=""',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "--session" ]; then sess="$a"; fi',
    '  prev="$a"',
    "done",
    'echo "session used=${sess:-none}" >> "$MARK"',
    'if [ "$FAKE_FAIL" = "auth" ]; then',
    '  echo "Error: authentication required" >&2',
    "  exit 1",
    "fi",
    'if [ -n "$FAKE_FAIL" ]; then',
    '  echo "Error: Session not found" >&2',
    "  exit 1",
    "fi",
    'printf \'{"type":"text","sessionID":"ses_FAKE123","part":{"type":"text","text":"intermediate"}}\\n\'',
    'printf \'{"type":"text","sessionID":"ses_FAKE123","part":{"type":"text","text":"ok"}}\\n\'',
    "exit 0",
    "",
  ].join("\n"),
);
chmodSync(join(sessionWork, "bin", "opencode"), 0o755);
writeFileSync(
  join(sessionWork, "bin", "curl"),
  [
    "#!/bin/sh",
    'echo "curl $*" >> "$MARK"',
    'eval "url=\\${$#}"',
    'case "$url" in',
    "  */config/providers)",
    '    printf \'%s\\n\' \'{"providers":[],"default":{"prov-x":"model-y"}}\'',
    "    ;;",
    "  */summarize)",
    "    printf '%s\\n' true",
    "    ;;",
    "  */message)",
    "    printf '%s\\n' 200",
    "    ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"),
);
chmodSync(join(sessionWork, "bin", "curl"), 0o755);

function sessionCase(slug, job) {
  const dir = join(sessionWork, slug);
  const mark = join(dir, "mark.log");
  const xdg = join(dir, "xdg");
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, `run-${slug}.sh`);
  writeFileSync(
    scriptPath,
    runScriptContent(job, `sess-${slug}`, join(sessionWork, "bin", "opencode")),
  );
  chmodSync(scriptPath, 0o755);
  execSync(`sh -n ${scriptPath}`);
  execSync(`dash -n ${scriptPath}`);
  const records = join(
    xdg,
    "opencode",
    "jobs",
    "runs",
    `sess-${slug}`,
    `${slug}.jsonl`,
  );
  const state = join(
    xdg,
    "opencode",
    "jobs",
    "sessions",
    `sess-${slug}`,
    `${slug}.txt`,
  );
  const runOnce = (env = {}) =>
    new Promise((resolve) => {
      let output = "";
      const child = spawn("/bin/sh", [scriptPath], {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: xdg,
          MARK: mark,
          PATH: `${join(sessionWork, "bin")}:${process.env.PATH ?? ""}`,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.on("exit", (code) => resolve({ code, output }));
    });
  return { mark, records, state, runOnce };
}

const persistJob = {
  slug: "spersist",
  name: "Persist Job",
  schedule: "0 9 * * *",
  run: { prompt: "hi" },
  session: "persist",
  createdAt: "t",
  updatedAt: "t",
};
{
  const { mark, records, state, runOnce } = sessionCase(
    persistJob.slug,
    persistJob,
  );
  assert.equal((await runOnce()).code, 0);
  assert.equal((await runOnce()).code, 0);
  const markText = execSync(`cat ${mark}`).toString();
  const runLines = markText
    .split("\n")
    .filter((l) => l.startsWith("run args="));
  assert.equal(runLines.length, 2);
  assert.ok(!runLines[0].includes("--session"), "first run starts fresh");
  assert.ok(
    runLines[1].includes("--session ses_FAKE123"),
    "second run continues",
  );
  assert.ok(
    runLines[0].includes("--format json"),
    "tracked runs use json events",
  );
  assert.ok(!markText.includes("serve env="), "persist must not compact");
  assert.equal(execSync(`cat ${state}`).toString().trim(), "ses_FAKE123");
  const finished = execSync(`cat ${records}`)
    .toString()
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((l) => l.status !== "running");
  assert.equal(finished.at(-1).status, "success");
  assert.equal(finished.at(-1).sessionId, "ses_FAKE123");
}

const compactJob = {
  slug: "scompact",
  name: "Compact Job",
  schedule: "0 9 * * *",
  run: { prompt: "hi" },
  session: "compact",
  createdAt: "t",
  updatedAt: "t",
};
{
  const { mark, runOnce } = sessionCase(compactJob.slug, compactJob);
  assert.equal((await runOnce()).code, 0);
  const markText = execSync(`cat ${mark}`).toString();
  assert.ok(
    markText.includes('serve env={"compaction":{"tail_turns":0}}'),
    "compact uses summary-only compaction",
  );
  assert.ok(
    markText.includes("/config/providers"),
    "model resolved from server default",
  );
  assert.ok(
    markText.includes('"providerID":"prov-x"') &&
      markText.includes('"modelID":"model-y"'),
    "summarize posted with the resolved default model",
  );
  assert.ok(markText.includes("/session/ses_FAKE123/summarize"));
}

const compactLastJob = {
  slug: "scompactlast",
  name: "Compact Last Job",
  schedule: "0 9 * * *",
  run: { prompt: "hi", model: "prov-a/model-b" },
  session: "compact+last",
  createdAt: "t",
  updatedAt: "t",
};
{
  const { mark, runOnce } = sessionCase(compactLastJob.slug, compactLastJob);
  assert.equal((await runOnce()).code, 0);
  const markText = execSync(`cat ${mark}`).toString();
  assert.ok(
    markText.includes('serve env={"compaction":{"tail_turns":0}}'),
    "compact+last compacts summary-only",
  );
  assert.ok(!markText.includes("/config/providers"), "job model used directly");
  assert.ok(
    markText.includes('"providerID":"prov-a"') &&
      markText.includes('"modelID":"model-b"'),
    "summarize posted with the job model",
  );
  assert.ok(
    markText.includes("/session/ses_FAKE123/message"),
    "compact+last injects the last result into the session",
  );
  assert.ok(
    markText.includes("noReply") && markText.includes('"text":"ok"'),
    "injection carries the run result as context-only text",
  );
  assert.ok(
    !markText.includes("intermediate"),
    "only the final text event is reinjected",
  );
}

{
  const { mark, records, state, runOnce } = sessionCase("srecover", {
    ...persistJob,
    slug: "srecover",
  });
  mkdirSync(join(state, ".."), { recursive: true });
  writeFileSync(state, "ses_GONE\n");
  const recovery = await runOnce({ FAKE_FAIL: "1" });
  assert.equal(recovery.code, 1);
  const markText = execSync(`cat ${mark}`).toString();
  const runLines = markText
    .split("\n")
    .filter((l) => l.startsWith("run args="));
  assert.equal(runLines.length, 2, "stale session must retry once");
  assert.ok(runLines[0].includes("--session ses_GONE"));
  assert.ok(!runLines[1].includes("--session"), "retry runs fresh");
  assert.ok(
    recovery.output.includes("retrying with a fresh session"),
    "recovery is logged",
  );
  const finished = execSync(`cat ${records}`)
    .toString()
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((l) => l.status !== "running");
  assert.equal(finished.at(-1).status, "failed");
  assert.equal(finished.at(-1).exitCode, 1);
}

{
  const { mark, records, state, runOnce } = sessionCase("sno_retry", {
    ...persistJob,
    slug: "sno_retry",
  });
  mkdirSync(join(state, ".."), { recursive: true });
  writeFileSync(state, "ses_GONE\n");
  const failure = await runOnce({ FAKE_FAIL: "auth" });
  assert.equal(failure.code, 1);
  const markText = execSync(`cat ${mark}`).toString();
  const runLines = markText
    .split("\n")
    .filter((l) => l.startsWith("run args="));
  assert.equal(runLines.length, 1, "unrelated failures must not retry");
  assert.ok(runLines[0].includes("--session ses_GONE"));
  assert.ok(
    !failure.output.includes("retrying with a fresh session"),
    "no stale-session recovery is logged",
  );
  assert.equal(
    execSync(`cat ${state}`).toString().trim(),
    "ses_GONE",
    "state file is untouched",
  );
  const finished = execSync(`cat ${records}`)
    .toString()
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((l) => l.status !== "running");
  assert.equal(finished.at(-1).status, "failed");
  assert.equal(finished.at(-1).exitCode, 1);
}

// Worktree jobs: each run gets a fresh git worktree, commits all changes to a
// per-run branch opencode-jobs/<slug>/…, and removes the worktree. Covers
// changes, no-changes, failed runs, stale-worktree recovery, custom base and
// commit message, and the non-repo failure path.
const wtWork = "/tmp/opencode/opencode-jobs-smoke-worktree";
rmSync(wtWork, { recursive: true, force: true });
const wtRepo = join(wtWork, "repo");
mkdirSync(wtRepo, { recursive: true });
mkdirSync(join(wtWork, "bin"), { recursive: true });
execSync("git init -q", { cwd: wtRepo });
execSync("git config user.email test@example.com", { cwd: wtRepo });
execSync('git config user.name "Smoke Test"', { cwd: wtRepo });
writeFileSync(join(wtRepo, "README.md"), "base\n");
execSync("git add README.md", { cwd: wtRepo });
execSync("git commit -qm init", { cwd: wtRepo });
const initSha = execSync("git rev-parse HEAD", { cwd: wtRepo })
  .toString()
  .trim();
writeFileSync(
  join(wtWork, "bin", "opencode"),
  [
    "#!/bin/sh",
    'echo "fake opencode: $*"',
    'case "${WT_MODE:-}" in',
    "  idle) ;;",
    '  fail) echo "produced by job" > wt-artifact.txt; pwd > pwd-artifact.txt; exit 3 ;;',
    '  *) echo "produced by job" > wt-artifact.txt; pwd > pwd-artifact.txt ;;',
    "esac",
    "exit 0",
    "",
  ].join("\n"),
);
chmodSync(join(wtWork, "bin", "opencode"), 0o755);

const wtState = join(wtWork, "state");
const wtXdg = join(wtWork, "xdg");
const wtOcBin = join(wtWork, "bin", "opencode");

function worktreeCase(slug, jobOverrides = {}) {
  const job = {
    slug,
    name: "Worktree Job",
    schedule: "0 9 * * *",
    run: { prompt: "hi" },
    worktree: {},
    createdAt: "t",
    updatedAt: "t",
    ...jobOverrides,
  };
  const scriptPath = join(wtWork, `run-${slug}.sh`);
  writeFileSync(scriptPath, runScriptContent(job, "wt-scope", wtOcBin));
  chmodSync(scriptPath, 0o755);
  execSync(`sh -n ${scriptPath}`);
  execSync(`dash -n ${scriptPath}`);
  const recordFile = join(
    wtXdg,
    "opencode",
    "jobs",
    "runs",
    "wt-scope",
    `${slug}.jsonl`,
  );
  const defaultPath = join(
    wtState,
    "opencode",
    "jobs",
    "worktrees",
    "wt-scope",
    slug,
  );
  const runOnce = (env = {}, cwd = wtRepo) =>
    new Promise((resolve) => {
      const child = spawn("/bin/sh", [scriptPath], {
        cwd,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: wtXdg,
          XDG_STATE_HOME: wtState,
          ...env,
        },
      });
      child.on("exit", (code) => resolve(code));
    });
  const branches = () =>
    execSync(
      `git -C ${wtRepo} for-each-ref --format='%(refname:short)' refs/heads/opencode-jobs/${slug}/`,
    )
      .toString()
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  const readRecords = () =>
    execSync(`cat ${recordFile}`)
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((line) => line.status !== "running");
  return { runOnce, branches, readRecords, defaultPath };
}

{
  const { runOnce, branches, readRecords, defaultPath } =
    worktreeCase("wtchange");
  assert.equal(await runOnce(), 0);
  assert.ok(!existsSync(defaultPath), "worktree must be removed after the run");
  assert.equal(branches().length, 1);
  const [branch] = branches();
  assert.match(branch, /^opencode-jobs\/wtchange\/[\d-]+-\d+$/);
  execSync(`git -C ${wtRepo} cat-file -e ${branch}:wt-artifact.txt`);
  const records = readRecords();
  assert.equal(records.at(-1).status, "success");
  assert.equal(records.at(-1).worktreeBranch, branch);
  assert.equal(
    records.at(-1).worktreeCommit,
    execSync(`git -C ${wtRepo} rev-parse ${branch}`).toString().trim(),
  );
  assert.equal(execSync(`git -C ${wtRepo} status --porcelain`).toString(), "");
  assert.ok(
    !existsSync(join(wtRepo, "${XDG_STATE_HOME:-$HOME")),
    "worktree base must expand XDG_STATE_HOME, not a literal name",
  );
  assert.ok(
    existsSync(join(wtState, "opencode", "jobs", "worktrees", "wt-scope")),
    "worktree base must live under XDG_STATE_HOME",
  );
}

{
  const { runOnce, branches, readRecords, defaultPath } =
    worktreeCase("wtidle");
  assert.equal(await runOnce({ WT_MODE: "idle" }), 0);
  assert.ok(!existsSync(defaultPath), "worktree must be removed");
  const [branch] = branches();
  assert.equal(
    execSync(`git -C ${wtRepo} rev-list --count ${branch}`).toString().trim(),
    "1",
    "no changes must mean no extra commit",
  );
  const records = readRecords();
  assert.equal(records.at(-1).status, "success");
  assert.equal(records.at(-1).worktreeCommit, initSha);
}

{
  const { runOnce, branches, readRecords, defaultPath } =
    worktreeCase("wtfail");
  assert.equal(await runOnce({ WT_MODE: "fail" }), 3);
  assert.ok(!existsSync(defaultPath), "failed run must still clean up");
  const [branch] = branches();
  execSync(`git -C ${wtRepo} cat-file -e ${branch}:wt-artifact.txt`);
  const records = readRecords();
  assert.equal(records.at(-1).status, "failed");
  assert.equal(records.at(-1).exitCode, 3);
  assert.equal(records.at(-1).worktreeBranch, branch);
}

{
  const { runOnce, branches, readRecords, defaultPath } =
    worktreeCase("wtstale");
  execSync(
    `git -C ${wtRepo} worktree add -b opencode-jobs/wtstale/stale ${defaultPath}`,
  );
  writeFileSync(join(defaultPath, "abandoned.txt"), "salvage me\n");
  assert.equal(await runOnce({ WT_MODE: "idle" }), 0);
  assert.ok(!existsSync(defaultPath), "stale worktree must be cleaned");
  const recovery = execSync(
    `git -C ${wtRepo} show --format=%s --name-only opencode-jobs/wtstale/stale`,
  ).toString();
  assert.match(recovery, /recovery/);
  assert.match(recovery, /abandoned\.txt/);
  assert.equal(branches().length, 2, "stale branch kept plus new run branch");
  assert.equal(readRecords().at(-1).status, "success");
}

{
  const base = join(wtWork, "custom-base");
  const { runOnce, branches, readRecords } = worktreeCase("wtbase", {
    worktree: { base, commitMessage: "custom save" },
  });
  assert.equal(await runOnce(), 0);
  assert.ok(!existsSync(join(base, "wtbase")), "custom base cleaned");
  const [branch] = branches();
  assert.equal(
    execSync(`git -C ${wtRepo} log -1 --format=%s ${branch}`).toString().trim(),
    "custom save",
  );
  assert.equal(readRecords().at(-1).status, "success");
}

{
  const { runOnce, readRecords } = worktreeCase("wtnogit");
  const notRepo = join(wtWork, "notrepo");
  mkdirSync(notRepo, { recursive: true });
  assert.equal(await runOnce({}, notRepo), 1);
  const records = readRecords();
  assert.equal(records.at(-1).status, "failed");
  assert.equal(records.at(-1).worktreeBranch, "");
}

{
  const { runOnce, readRecords } = worktreeCase("wtlock");
  const lockDir = join(wtXdg, "opencode", "jobs", "locks", "wt-scope");
  mkdirSync(lockDir, { recursive: true });
  const holder = spawn("flock", [join(lockDir, "wtlock.lock"), "sleep", "2"]);
  await sleep(300);
  assert.equal(await runOnce(), 0, "locked-out run must exit 0");
  const locked = readRecords();
  assert.equal(locked.at(-1).status, "skipped");
  await new Promise((resolve) => {
    holder.on("exit", resolve);
  });
  assert.equal(await runOnce(), 0, "run must succeed after the lock releases");
  assert.equal(readRecords().at(-1).status, "success");
}

const monoRepo = join(wtWork, "monorepo");
mkdirSync(join(monoRepo, "packages", "app"), { recursive: true });
execSync("git init -q", { cwd: monoRepo });
execSync("git config user.email test@example.com", { cwd: monoRepo });
execSync('git config user.name "Smoke Test"', { cwd: monoRepo });
writeFileSync(join(monoRepo, "packages", "app", "hello.txt"), "hi\n");
execSync("git add .", { cwd: monoRepo });
execSync("git commit -qm init", { cwd: monoRepo });
{
  const { runOnce, defaultPath } = worktreeCase("wtsub");
  assert.equal(
    await runOnce({}, join(monoRepo, "packages", "app")),
    0,
    "subdir project must run in its worktree subdirectory",
  );
  assert.ok(!existsSync(defaultPath), "worktree removed");
  const branch = execSync(
    `git -C ${monoRepo} for-each-ref --format='%(refname:short)' refs/heads/opencode-jobs/wtsub/`,
  )
    .toString()
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .at(0);
  assert.ok(branch, "subdir run must leave a branch");
  assert.equal(
    execSync(`git -C ${monoRepo} show ${branch}:packages/app/pwd-artifact.txt`)
      .toString()
      .trim(),
    join(defaultPath, "packages", "app"),
    "the job must run inside the matching project subdirectory",
  );
}

{
  const { runOnce, readRecords, defaultPath } = worktreeCase("wtfailrecover");
  execSync(
    `git -C ${wtRepo} worktree add -b opencode-jobs/wtfailrecover/stale ${defaultPath}`,
  );
  writeFileSync(join(defaultPath, "abandoned.txt"), "keep me\n");
  const preCommit = join(wtRepo, ".git", "hooks", "pre-commit");
  writeFileSync(preCommit, "#!/bin/sh\nexit 1\n");
  chmodSync(preCommit, 0o755);
  assert.equal(await runOnce({ WT_MODE: "idle" }), 1);
  assert.ok(
    existsSync(join(defaultPath, "abandoned.txt")),
    "unsavable stale worktree must be kept",
  );
  const blocked = readRecords();
  assert.equal(blocked.at(-1).status, "failed");
  assert.equal(blocked.at(-1).worktreeBranch, "");
  rmSync(preCommit);
  assert.equal(
    await runOnce({ WT_MODE: "idle" }),
    0,
    "run must recover once the hook allows the recovery commit",
  );
  assert.ok(!existsSync(defaultPath), "stale worktree cleaned after recovery");
  assert.equal(readRecords().at(-1).status, "success");
}

console.log(
  `cron ok, quoting ok, units verified, run records ok (${lines.length} lines), guard ok, session modes ok, worktrees ok`,
);
console.log("SMOKE_OK");
