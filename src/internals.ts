// Pure functions exposed for the smoke-test harness (scripts/smoke.mjs).
// Not imported by the plugin entry point.
import { deriveScopeId, shQuote, slugify } from "./paths.js";
import { cronToOnCalendar, describeCron, parseCron } from "./cron.js";
import {
  validateGuard,
  validateRunSpec,
  validateSession,
  validateTimeout,
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
  validateTimeout,
  buildOpencodeArguments,
  runScriptContent,
  serviceContent,
  timerContent,
};
