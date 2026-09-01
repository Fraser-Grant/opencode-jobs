// Pure functions exposed for the smoke-test harness (scripts/scheduler-smoke.mjs).
// Not imported by the plugin entry point.
import { deriveScopeId, shQuote, slugify } from "./paths.js";
import { cronToOnCalendar, describeCron, parseCron } from "./cron.js";
import {
  validateGuard,
  validateRunSpec,
  validateSession,
  validateWorktree,
} from "./job.js";
import {
  buildOpencodeArguments,
  runScriptContent,
  serviceContent,
  timerContent,
} from "./systemd.js";

export const internals = {
  slugify,
  shQuote,
  deriveScopeId,
  parseCron,
  cronToOnCalendar,
  describeCron,
  validateRunSpec,
  validateGuard,
  validateSession,
  validateWorktree,
  buildOpencodeArguments,
  runScriptContent,
  serviceContent,
  timerContent,
};
