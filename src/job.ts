import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseCron } from "./cron.js";
import { atomicWrite, jobsDirectory, nowIso } from "./paths.js";
import { errorMessage } from "./json.js";

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

export interface WorktreeOptions {
  base?: string;
  ref?: string;
  commitMessage?: string;
}

export interface Job {
  slug: string;
  name: string;
  schedule: string;
  run: RunSpec;
  session?: SessionMode;
  guard?: string;
  worktree?: WorktreeOptions;
  timeoutSeconds?: number;
  stallTimeoutSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export type JobResult = { ok: true; job: Job } | { ok: false; error: string };

const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string");

const runSpecSchema = z
  .strictObject({
    prompt: nonEmptyStringSchema.optional(),
    command: nonEmptyStringSchema.optional(),
    arguments: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
  })
  .superRefine((run, context) => {
    if ((run.prompt === undefined) === (run.command === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          'must set exactly one of "prompt" (natural language) or "command" (custom command name)',
      });
    }
    if (run.prompt !== undefined && run.arguments !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["arguments"],
        message: "only applies to command jobs",
      });
    }
  })
  .transform((run): RunSpec => {
    if (run.command !== undefined) {
      return {
        command: run.command,
        ...(run.arguments !== undefined && { arguments: run.arguments }),
        ...(run.agent !== undefined && { agent: run.agent }),
        ...(run.model !== undefined && { model: run.model }),
      };
    }
    return {
      prompt: run.prompt ?? "",
      ...(run.agent !== undefined && { agent: run.agent }),
      ...(run.model !== undefined && { model: run.model }),
    };
  });

const sessionSchema = z.enum(SESSION_MODES, {
  error: `must be one of ${SESSION_MODES.map((mode) => `"${mode}"`).join(", ")}`,
});

const guardSchema = z
  .string()
  .refine(
    (value) => value.trim().length > 0,
    "must be a non-empty shell command string",
  );

const worktreeSchema = z
  .union([
    z.literal(true),
    z.strictObject({
      base: nonEmptyStringSchema.optional(),
      ref: nonEmptyStringSchema.optional(),
      commitMessage: nonEmptyStringSchema.optional(),
    }),
  ])
  .transform((value): WorktreeOptions => {
    if (value === true) return {};
    return {
      ...(value.base !== undefined && { base: value.base }),
      ...(value.ref !== undefined && { ref: value.ref }),
      ...(value.commitMessage !== undefined && {
        commitMessage: value.commitMessage,
      }),
    };
  });

const timeoutSchema = z
  .number()
  .int()
  .nonnegative("must be a non-negative integer");

const cronSchema = z.string().superRefine((schedule, context) => {
  try {
    parseCron(schedule);
  } catch (error) {
    context.addIssue({ code: "custom", message: errorMessage(error) });
  }
});

const jobFileSchema = z
  .strictObject({
    slug: z.string().optional(),
    name: nonEmptyStringSchema,
    schedule: cronSchema,
    run: runSpecSchema,
    session: sessionSchema.default("new"),
    guard: guardSchema.optional(),
    worktree: worktreeSchema.optional(),
    timeoutSeconds: timeoutSchema.optional(),
    stallTimeoutSeconds: timeoutSchema.optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .superRefine((definition, context) => {
    if (
      definition.stallTimeoutSeconds !== undefined &&
      definition.session === "new"
    ) {
      context.addIssue({
        code: "custom",
        path: ["stallTimeoutSeconds"],
        message:
          'requires a tracked session: set session to "persist", "compact", or "compact+last"',
      });
    }
  });

function formatValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "invalid job definition";
  const field = issue.path.join(".");
  return field.length === 0 ? issue.message : `"${field}": ${issue.message}`;
}

function parseWithContext<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${context}: ${formatValidationError(result.error)}`);
  }
  return result.data;
}

export function validateRunSpec(run: unknown, context: string): RunSpec {
  return parseWithContext(runSpecSchema, run, context);
}

export function validateSession(value: unknown, context: string): SessionMode {
  if (value === undefined) return "new";
  return parseWithContext(sessionSchema, value, context);
}

export function validateTimeout(
  value: unknown,
  context: string,
): number | undefined {
  if (value === undefined) return undefined;
  return parseWithContext(timeoutSchema, value, context);
}

export function validateGuard(
  value: unknown,
  context: string,
): string | undefined {
  if (value === undefined) return undefined;
  return parseWithContext(guardSchema, value, context);
}

export function validateWorktree(
  value: unknown,
  context: string,
): WorktreeOptions | undefined {
  if (value === undefined) return undefined;
  return parseWithContext(worktreeSchema, value, context);
}

export function loadJobFile(file: string, expectedSlug?: string): JobResult {
  const stem = path.basename(file, ".json");
  try {
    const object: unknown = JSON.parse(readFileSync(file, "utf8"));
    const result = jobFileSchema.safeParse(object);
    if (!result.success) {
      return {
        ok: false,
        error: `${stem}.json: ${formatValidationError(result.error)}`,
      };
    }
    const definition = result.data;
    const slug = definition.slug ?? stem;
    if (slug !== stem)
      return {
        ok: false,
        error: `${stem}.json: "slug" ("${slug}") must match filename`,
      };
    if (expectedSlug !== undefined && slug !== expectedSlug)
      return { ok: false, error: `${stem}.json: unexpected slug` };
    const timestamp = nowIso();
    return {
      ok: true,
      job: {
        slug,
        name: definition.name,
        schedule: definition.schedule,
        run: definition.run,
        ...(definition.session !== "new" && { session: definition.session }),
        ...(definition.guard !== undefined && { guard: definition.guard }),
        ...(definition.worktree !== undefined && {
          worktree: definition.worktree,
        }),
        ...(definition.timeoutSeconds !== undefined && {
          timeoutSeconds: definition.timeoutSeconds,
        }),
        ...(definition.stallTimeoutSeconds !== undefined && {
          stallTimeoutSeconds: definition.stallTimeoutSeconds,
        }),
        createdAt: definition.createdAt ?? timestamp,
        updatedAt: definition.updatedAt ?? timestamp,
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
