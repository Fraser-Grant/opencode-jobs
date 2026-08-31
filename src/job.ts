import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseCron } from "./cron.js";
import { atomicWrite, jobsDirectory, nowIso } from "./paths.js";
import { errorMessage, isRecord, stringProperty } from "./json.js";

interface RunOptions {
  agent?: string;
  model?: string;
}

export interface PromptRun extends RunOptions {
  prompt: string;
}

export interface CommandRun extends RunOptions {
  command: string;
  arguments?: string;
}

export type RunSpec = PromptRun | CommandRun;

export const SESSION_MODES = [
  "new",
  "persist",
  "compact",
  "compact+last",
] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export interface Job {
  slug: string;
  name: string;
  schedule: string;
  run: RunSpec;
  session?: SessionMode;
  guard?: string;
  timeoutSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export type JobResult = { ok: true; job: Job } | { ok: false; error: string };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function validateRunSpec(run: unknown, context: string): RunSpec {
  if (!isRecord(run)) throw new Error(`${context}: "run" must be an object`);
  const prompt = nonEmptyString(run.prompt);
  const command = nonEmptyString(run.command);
  if ((prompt !== undefined) === (command !== undefined)) {
    throw new Error(
      `${context}: "run" must set exactly one of "prompt" (natural language) or "command" (custom command name)`,
    );
  }
  const commandArguments = stringProperty(run, "arguments");
  const agent = stringProperty(run, "agent");
  const model = stringProperty(run, "model");
  if (command !== undefined) {
    return {
      command,
      ...(commandArguments !== undefined && { arguments: commandArguments }),
      ...(agent !== undefined && { agent }),
      ...(model !== undefined && { model }),
    };
  }
  if (commandArguments !== undefined) {
    throw new Error(`${context}: "run.arguments" only applies to command jobs`);
  }
  return {
    prompt: prompt ?? "",
    ...(agent !== undefined && { agent }),
    ...(model !== undefined && { model }),
  };
}

export function validateSession(value: unknown, context: string): SessionMode {
  if (value === undefined) return "new";
  const mode =
    typeof value === "string"
      ? SESSION_MODES.find((candidate) => candidate === value)
      : undefined;
  if (mode === undefined) {
    throw new Error(
      `${context}: "session" must be one of ${SESSION_MODES.map((candidate) => `"${candidate}"`).join(", ")}`,
    );
  }
  return mode;
}

export function validateTimeout(
  value: unknown,
  context: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${context}: "timeoutSeconds" must be a non-negative integer`,
    );
  }
  return value;
}

export function validateGuard(
  value: unknown,
  context: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${context}: "guard" must be a non-empty shell command string`,
    );
  }
  return value;
}

export function loadJobFile(file: string, expectedSlug?: string): JobResult {
  const stem = path.basename(file).replaceAll(/\.json$/g, "");
  try {
    const object: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(object))
      return { ok: false, error: `${stem}.json: not a job object` };
    const slug = stringProperty(object, "slug") ?? stem;
    if (slug !== stem)
      return {
        ok: false,
        error: `${stem}.json: "slug" ("${slug}") must match filename`,
      };
    if (expectedSlug !== undefined && slug !== expectedSlug)
      return { ok: false, error: `${stem}.json: unexpected slug` };
    const name = nonEmptyString(object.name);
    if (name === undefined)
      return { ok: false, error: `${stem}.json: "name" is required` };
    const schedule = stringProperty(object, "schedule") ?? "";
    try {
      parseCron(schedule);
    } catch (error) {
      return { ok: false, error: `${stem}.json: ${errorMessage(error)}` };
    }
    const run = validateRunSpec(object.run, `${stem}.json`);
    const session = validateSession(object.session, `${stem}.json`);
    const guard = validateGuard(object.guard, `${stem}.json`);
    const timeoutSeconds = validateTimeout(
      object.timeoutSeconds,
      `${stem}.json`,
    );
    return {
      ok: true,
      job: {
        slug,
        name,
        schedule,
        run,
        ...(session !== "new" && { session }),
        ...(guard !== undefined && { guard }),
        ...(timeoutSeconds !== undefined && { timeoutSeconds }),
        createdAt: stringProperty(object, "createdAt") ?? nowIso(),
        updatedAt: stringProperty(object, "updatedAt") ?? nowIso(),
      },
    };
  } catch (error) {
    return { ok: false, error: `${stem}.json: ${errorMessage(error)}` };
  }
}

export function loadJobs(workdir: string): { jobs: Job[]; errors: string[] } {
  const directory = jobsDirectory(workdir);
  if (!existsSync(directory)) return { jobs: [], errors: [] };
  const jobs: Job[] = [];
  const errors: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const result = loadJobFile(path.join(directory, entry.name));
    if (result.ok) jobs.push(result.job);
    else errors.push(result.error);
  }
  return {
    jobs: jobs.toSorted((a, b) => a.slug.localeCompare(b.slug)),
    errors,
  };
}

export function saveJob(workdir: string, job: Job): void {
  atomicWrite(
    path.join(jobsDirectory(workdir), `${job.slug}.json`),
    `${JSON.stringify(job, undefined, 2)}\n`,
  );
}
