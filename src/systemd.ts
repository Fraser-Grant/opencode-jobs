import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { homedir } from "node:os";
import { type Job } from "./job.js";
import { cronToOnCalendar, parseCron } from "./cron.js";
import {
  atomicWrite,
  atomicWriteExecutable,
  escapeUnitText,
  logDirectory,
  logFile,
  runScriptPath,
  runsDirectory,
  scopeDirectory,
  serviceUnit,
  shQuote,
  systemdUserDirectory,
  timerUnit,
  unitBase,
  unitQuote,
} from "./paths.js";

export function findOpencode(): string {
  const override = process.env.OPENCODE_SCHEDULER_OPENCODE_PATH;
  if (override !== undefined && override.length > 0) return override;
  const which = spawnSync("sh", ["-c", "command -v opencode"], {
    encoding: "utf8",
  });
  const onPath = which.stdout.trim();
  if (which.status === 0 && onPath.length > 0) return onPath;
  const candidates = [
    path.join(homedir(), ".opencode/bin/opencode"),
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "opencode";
}

export function buildOpencodeArguments(job: Job, sessionId?: string): string[] {
  const cliArguments = ["run"];
  if (job.run.agent !== undefined) cliArguments.push("--agent", job.run.agent);
  if (job.run.model !== undefined) cliArguments.push("--model", job.run.model);
  if (sessionId !== undefined && sessionId.length > 0) {
    cliArguments.push("--session", sessionId);
  }
  if ("prompt" in job.run) {
    cliArguments.push("--", job.run.prompt);
  } else {
    cliArguments.push(
      "--command",
      job.run.command,
      "--",
      job.run.arguments ?? "",
    );
  }
  return cliArguments;
}

function guardScriptLines(guard: string): string[] {
  return [
    `guard=${shQuote(guard)}`,
    'sh -c "$guard"',
    "guard_code=$?",
    'if [ "$guard_code" -ne 0 ]; then',
    '  echo "guard exited $guard_code, skipping run"',
    '  finish skipped "$guard_code"',
    "  exit 0",
    "fi",
  ];
}

const SESSION_ID_SED = String.raw`s/.*"sessionID":"\([^"]*\)".*/\1/p`;
const DEFAULT_PROVIDER_SED = String.raw`s/.*"default"[[:space:]]*:[[:space:]]*{[^}]*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`;
const DEFAULT_MODEL_SED = String.raw`s/.*"default"[[:space:]]*:[[:space:]]*{[^}]*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p`;

function extractSessionIdLines(target: string, indent = ""): string[] {
  return [
    `${indent}${target}="$(sed -n '${SESSION_ID_SED}' "$json_out" | head -n 1)"`,
  ];
}

function compactSessionLines(): string[] {
  return [
    "compact_session() {",
    '  csid="$1"',
    "  if ! command -v curl >/dev/null 2>&1; then",
    '    echo "scheduler: curl not available, skipping compaction"',
    "    return 0",
    "  fi",
    '  serve_out="$(mktemp)"',
    '  serve_err="$(mktemp)"',
    '  OPENCODE_CONFIG_CONTENT=\'{"compaction":{"tail_turns":0}}\' "$oc_bin" serve --port 0 >"$serve_out" 2>"$serve_err" &',
    "  serve_pid=$!",
    '  serve_port=""',
    "  tries=0",
    '  while [ "$tries" -lt 100 ]; do',
    String.raw`    serve_port="$(sed -n 's/.*listening on http:\/\/127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' "$serve_out" | head -n 1)"`,
    '    if [ -n "$serve_port" ]; then break; fi',
    '    if ! kill -0 "$serve_pid" 2>/dev/null; then break; fi',
    "    sleep 0.1",
    "    tries=$((tries + 1))",
    "  done",
    '  if [ -z "$serve_port" ]; then',
    '    echo "scheduler: compaction server failed to start"',
    '    sed -n "1,10p" "$serve_err" >&2',
    '    kill "$serve_pid" 2>/dev/null',
    '    wait "$serve_pid" 2>/dev/null',
    '    rm -f "$serve_out" "$serve_err"',
    "    return 0",
    "  fi",
    "  healthy=0",
    "  tries=0",
    '  while [ "$tries" -lt 50 ]; do',
    '    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$serve_port/global/health"; then',
    "      healthy=1",
    "      break",
    "    fi",
    '    if ! kill -0 "$serve_pid" 2>/dev/null; then break; fi',
    "    sleep 0.2",
    "    tries=$((tries + 1))",
    "  done",
    '  if [ "$healthy" -ne 1 ]; then',
    '    echo "scheduler: compaction server never became healthy"',
    '    kill "$serve_pid" 2>/dev/null',
    '    wait "$serve_pid" 2>/dev/null',
    '    rm -f "$serve_out" "$serve_err"',
    "    return 0",
    "  fi",
    '  cs_provider=""',
    '  cs_model=""',
    '  case "$oc_model" in',
    "    */*)",
    '      cs_provider="${oc_model%%/*}"',
    '      cs_model="${oc_model#*/}"',
    "      ;;",
    "  esac",
    '  if [ -z "$cs_provider" ]; then',
    '    defaults="$(curl -s --max-time 10 "http://127.0.0.1:$serve_port/config/providers")"',
    String.raw`    cs_provider="$(printf '%s\n' "$defaults" | sed -n '${DEFAULT_PROVIDER_SED}' | head -n 1)"`,
    String.raw`    cs_model="$(printf '%s\n' "$defaults" | sed -n '${DEFAULT_MODEL_SED}' | head -n 1)"`,
    "  fi",
    '  if [ -z "$cs_provider" ] || [ -z "$cs_model" ]; then',
    '    echo "scheduler: could not resolve a model for compaction, skipping"',
    '    kill "$serve_pid" 2>/dev/null',
    '    wait "$serve_pid" 2>/dev/null',
    '    rm -f "$serve_out" "$serve_err"',
    "    return 0",
    "  fi",
    '  echo "scheduler: compacting session $csid (mode: $session_mode)"',
    String.raw`  result="$(curl -s --max-time 900 -X POST -H 'content-type: application/json' -d "{\"providerID\":\"$cs_provider\",\"modelID\":\"$cs_model\"}" "http://127.0.0.1:$serve_port/session/$csid/summarize")"`,
    '  if [ "$result" != "true" ]; then',
    '    echo "scheduler: compaction failed: $result"',
    "  fi",
    '  if [ "$result" = "true" ] && [ "$oc_keep_last" -eq 1 ] && [ -n "$cs_text" ]; then',
    String.raw`    inject_body="{\"noReply\":true,\"parts\":[{\"type\":\"text\",\"text\":\"$cs_text\"}]}"`,
    '    http="$(curl -s -o /dev/null -w \'%{http_code}\' --max-time 120 -X POST -H \'content-type: application/json\' -d "$inject_body" "http://127.0.0.1:$serve_port/session/$csid/message")"',
    '    if [ "$http" != "200" ]; then',
    '      echo "scheduler: keeping last result failed (HTTP $http)"',
    "    fi",
    "  fi",
    '  kill "$serve_pid" 2>/dev/null',
    '  wait "$serve_pid" 2>/dev/null',
    '  rm -f "$serve_out" "$serve_err"',
    "}",
  ];
}

export function runScriptContent(
  job: Job,
  scopeId: string,
  opencodeBin: string,
): string {
  const mode = job.session ?? "new";
  const isTracked = mode !== "new";
  const isCompact = mode === "compact" || mode === "compact+last";
  const isKeepLast = mode === "compact+last";
  return [
    "#!/bin/sh",
    "set -u",
    `slug=${shQuote(job.slug)}`,
    `scope=${shQuote(scopeId)}`,
    `oc_bin=${shQuote(opencodeBin)}`,
    'config_root="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'runs="$config_root/opencode/scheduler/runs/$scope"',
    'mkdir -p "$runs"',
    'record_file="$runs/$slug.jsonl"',
    ...(isTracked
      ? [
          'sessions="$config_root/opencode/scheduler/sessions/$scope"',
          'mkdir -p "$sessions"',
          'state_file="$sessions/$slug.txt"',
          `session_mode=${shQuote(mode)}`,
          'prev_session=""',
          'if [ -f "$state_file" ]; then prev_session=$(cat "$state_file"); fi',
        ]
      : []),
    'started_by="${OPENCODE_SCHEDULER_STARTED_BY:-scheduled}"',
    'run_id="$(date +%s%N)-$$"',
    "started=$(date +%s)",
    'new_session=""',
    'export OPENCODE_PERMISSION=\'{"question":"deny"}\'',
    'export OPENCODE_SCHEDULER_RUN_ID="$run_id"',
    "finish() {",
    '  status="$1"',
    '  code="$2"',
    "  ended=$(date +%s)",
    String.raw`  printf '{"runId":"%s","slug":"%s","scopeId":"%s","startedAt":%s,"finishedAt":%s,"durationMs":%s,"status":"%s","exitCode":%s,"sessionId":"%s","startedBy":"%s"}\n' "$run_id" "$slug" "$scope" "$started" "$ended" "$((ended - started))" "$status" "$code" "$new_session" "$started_by" >> "$record_file"`,
    "}",
    "trap 'finish timeout 124; exit 124' TERM INT",
    ...(job.guard === undefined ? [] : guardScriptLines(job.guard)),
    String.raw`printf '{"runId":"%s","slug":"%s","scopeId":"%s","startedAt":%s,"startedBy":"%s","status":"running"}\n' "$run_id" "$slug" "$scope" "$started" "$started_by" >> "$record_file"`,
    `oc_agent=${shQuote(job.run.agent ?? "")}`,
    `oc_model=${shQuote(job.run.model ?? "")}`,
    "prompt" in job.run ? "oc_command_mode=0" : "oc_command_mode=1",
    `oc_command=${shQuote("command" in job.run ? job.run.command : "")}`,
    `oc_args=${shQuote("command" in job.run ? (job.run.arguments ?? "") : "")}`,
    `oc_prompt=${shQuote("prompt" in job.run ? job.run.prompt : "")}`,
    `oc_keep_last=${String(isKeepLast ? 1 : 0)}`,
    "run_opencode() {",
    '  sess="$1"',
    '  use_json="$2"',
    "  set -- run",
    '  if [ -n "$oc_agent" ]; then set -- "$@" --agent "$oc_agent"; fi',
    '  if [ -n "$oc_model" ]; then set -- "$@" --model "$oc_model"; fi',
    '  if [ -n "$sess" ]; then set -- "$@" --session "$sess"; fi',
    '  if [ "$use_json" -eq 1 ]; then set -- "$@" --format json; fi',
    '  if [ "$oc_command_mode" -eq 1 ]; then',
    '    set -- "$@" --command "$oc_command" -- "$oc_args"',
    "  else",
    '    set -- "$@" -- "$oc_prompt"',
    "  fi",
    '  "$oc_bin" "$@"',
    "}",
    ...(isCompact ? compactSessionLines() : []),
    ...(isTracked
      ? [
          'json_out="$(mktemp)"',
          'run_opencode "$prev_session" 1 >"$json_out" 2>&1',
          "code=$?",
          'cat "$json_out"',
          ...extractSessionIdLines("new_session"),
          'if [ "$code" -ne 0 ] && [ -n "$prev_session" ] && [ -z "$new_session" ] && grep -qi "session not found" "$json_out"; then',
          '  echo "scheduler: session $prev_session not found, retrying with a fresh session"',
          '  rm -f "$json_out"',
          '  json_out="$(mktemp)"',
          '  run_opencode "" 1 >"$json_out" 2>&1',
          "  code=$?",
          '  cat "$json_out"',
          ...extractSessionIdLines("new_session", "  "),
          "fi",
          'cs_text=""',
          'if [ "$oc_keep_last" -eq 1 ]; then',
          "  cs_text=\"$(awk '",
          '    /"type":"text"/ {',
          "      line = $0",
          String.raw`      i = index(line, "\042text\042:\042")`,
          "      if (i == 0) next",
          "      i = i + 8",
          '      out = ""',
          "      len = length(line)",
          "      while (i <= len) {",
          "        c = substr(line, i, 1)",
          String.raw`        if (c == "\\") {`,
          "          out = out substr(line, i, 2)",
          "          i = i + 2",
          "          continue",
          "        }",
          String.raw`        if (c == "\042") break`,
          "        out = out c",
          "        i = i + 1",
          "      }",
          "      result = out",
          "      n = n + 1",
          "    }",
          "    END {",
          "      if (n > 0) {",
          "        if (length(result) > 16000) {",
          "          result = substr(result, 1, 16000)",
          String.raw`          if (substr(result, 16000, 1) == "\\") result = substr(result, 1, 15999)`,
          "        }",
          "        print result",
          "      }",
          "    }",
          '  \' "$json_out")"',
          "fi",
          'rm -f "$json_out"',
          'if [ -n "$new_session" ]; then',
          String.raw`  printf '%s\n' "$new_session" >"$state_file"`,
          "fi",
        ]
      : ['run_opencode "" 0', "code=$?"]),
    "trap - TERM INT",
    'if [ "$code" -ne 0 ]; then finish failed "$code"; exit "$code"; fi',
    ...(isCompact
      ? ['if [ -n "$new_session" ]; then compact_session "$new_session"; fi']
      : []),
    "finish success 0",
    "exit 0",
    "",
  ].join("\n");
}

export function serviceContent(
  job: Job,
  options: {
    workdir: string;
    runScript: string;
    log: string;
    pathEnvironment: string;
  },
): string {
  const timeout =
    job.timeoutSeconds !== undefined && job.timeoutSeconds > 0
      ? `TimeoutStartSec=${String(job.timeoutSeconds)}s`
      : "TimeoutStartSec=infinity";
  const lines = [
    "[Unit]",
    `Description=OpenCode job: ${escapeUnitText(job.name)} (${job.slug})`,
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${unitQuote(options.workdir)}`,
    `Environment=${unitQuote(`PATH=${options.pathEnvironment}`)}`,
    `ExecStart=/bin/sh ${unitQuote(options.runScript)}`,
    timeout,
    `StandardOutput=append:${unitQuote(options.log)}`,
    `StandardError=append:${unitQuote(options.log)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function timerContent(job: Job, onCalendars: string[]): string {
  return [
    "[Unit]",
    `Description=OpenCode job timer: ${escapeUnitText(job.name)} (${job.slug})`,
    "",
    "[Timer]",
    ...onCalendars.map((calendar) => `OnCalendar=${calendar}`),
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export interface SystemctlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function systemctl(systemctlArguments: string[]): SystemctlResult {
  const result = spawnSync("systemctl", ["--user", ...systemctlArguments], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function systemdHint(stderr: string): string {
  if (/failed to connect|not connected|dbus/i.test(stderr)) {
    return `\nHint: no systemd user session is reachable. Over SSH try enabling lingering: loginctl enable-linger $USER`;
  }
  return "";
}

export interface TimerStatus {
  next: string | undefined;
  last: string | undefined;
}

export function timerStatus(base: string): TimerStatus {
  const result = systemctl([
    "show",
    timerUnit(base),
    "-p",
    "NextElapseUSecRealtime",
    "-p",
    "LastTriggerUSec",
    "--value",
  ]);
  if (!result.ok) return { next: undefined, last: undefined };
  const [next = "n/a", last = "n/a"] = result.stdout.split("\n", 2);
  return {
    next: next === "n/a" ? undefined : next,
    last: last === "n/a" ? undefined : last,
  };
}

export function writeJobUnits(
  job: Job,
  workdir: string,
  scopeId: string,
  opencodeBin: string,
  pathEnvironment: string,
): string {
  const script = runScriptPath(scopeId, job.slug);
  const base = unitBase(scopeId, job.slug);
  mkdirSync(logDirectory(scopeId), { recursive: true });
  mkdirSync(runsDirectory(scopeId), { recursive: true });
  atomicWriteExecutable(script, runScriptContent(job, scopeId, opencodeBin));
  const onCalendars = cronToOnCalendar(parseCron(job.schedule));
  atomicWrite(
    path.join(systemdUserDirectory(), timerUnit(base)),
    timerContent(job, onCalendars),
  );
  atomicWrite(
    path.join(systemdUserDirectory(), serviceUnit(base)),
    serviceContent(job, {
      workdir: path.resolve(workdir),
      runScript: script,
      log: logFile(scopeId, job.slug),
      pathEnvironment,
    }),
  );
  return base;
}

export function removeJobUnits(scopeId: string, slug: string): void {
  const base = unitBase(scopeId, slug);
  systemctl(["disable", "--now", timerUnit(base)]);
  for (const file of [
    path.join(systemdUserDirectory(), timerUnit(base)),
    path.join(systemdUserDirectory(), serviceUnit(base)),
  ]) {
    if (existsSync(file)) rmSync(file);
  }
  const script = runScriptPath(scopeId, slug);
  if (existsSync(script)) rmSync(script);
}

export function removeStaleUnits(
  scopeId: string,
  expectedSlugs: Set<string>,
): string[] {
  const prefix = `opencode-sched-${scopeId}-`;
  const removed: string[] = [];
  if (existsSync(systemdUserDirectory())) {
    for (const entry of readdirSync(systemdUserDirectory())) {
      if (!entry.startsWith(prefix)) continue;
      if (!entry.endsWith(".service") && !entry.endsWith(".timer")) continue;
      const slug = entry
        .slice(prefix.length)
        .replaceAll(/\.(service|timer)$/g, "");
      if (!expectedSlugs.has(slug)) {
        rmSync(path.join(systemdUserDirectory(), entry));
        removed.push(slug);
      }
    }
  }
  if (existsSync(scopeDirectory(scopeId))) {
    const entries = readdirSync(scopeDirectory(scopeId));
    for (const entry of entries) {
      const match = /^run-(.+)\.sh$/.exec(entry);
      if (match === null) continue;
      const [, slug = ""] = match;
      if (!expectedSlugs.has(slug))
        rmSync(path.join(scopeDirectory(scopeId), entry));
    }
  }
  return removed;
}
