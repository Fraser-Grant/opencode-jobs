import { existsSync, readFileSync } from "node:fs";
import { runsFile } from "./paths.js";
import { isRecord, numberProperty, stringProperty } from "./json.js";

export interface RunRecord {
  runId?: string;
  slug?: string;
  scopeId?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  status?: string;
  exitCode?: number;
  sessionId?: string;
  startedBy?: string;
}

function parseRunRecord(value: Record<string, unknown>): RunRecord {
  const runId = stringProperty(value, "runId");
  const slug = stringProperty(value, "slug");
  const scopeId = stringProperty(value, "scopeId");
  const startedAt = numberProperty(value, "startedAt");
  const finishedAt = numberProperty(value, "finishedAt");
  const durationMs = numberProperty(value, "durationMs");
  const status = stringProperty(value, "status");
  const exitCode = numberProperty(value, "exitCode");
  const sessionId = stringProperty(value, "sessionId");
  const startedBy = stringProperty(value, "startedBy");
  return {
    ...(runId !== undefined && { runId }),
    ...(slug !== undefined && { slug }),
    ...(scopeId !== undefined && { scopeId }),
    ...(startedAt !== undefined && { startedAt }),
    ...(finishedAt !== undefined && { finishedAt }),
    ...(durationMs !== undefined && { durationMs }),
    ...(status !== undefined && { status }),
    ...(exitCode !== undefined && { exitCode }),
    ...(sessionId !== undefined && { sessionId }),
    ...(startedBy !== undefined && { startedBy }),
  };
}

export function readRunRecords(
  scopeId: string,
  slug: string,
  limit: number,
): RunRecord[] {
  const file = runsFile(scopeId, slug);
  if (!existsSync(file)) return [];
  const records: RunRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) records.push(parseRunRecord(value));
    } catch {
      // Malformed JSONL line: skip it.
    }
  }
  return records.slice(-limit);
}

export function lastFinishedRun(records: RunRecord[]): RunRecord | undefined {
  for (const record of records.toReversed()) {
    if (record.status !== undefined && record.status !== "running")
      return record;
  }
  return undefined;
}

function timestampOf(record: RunRecord): string {
  if (record.finishedAt !== undefined)
    return new Date(record.finishedAt * 1000).toISOString();
  if (record.startedAt !== undefined)
    return new Date(record.startedAt * 1000).toISOString();
  return "?";
}

export function formatRunLine(record: RunRecord): string {
  const duration =
    record.durationMs === undefined
      ? ""
      : ` (${String(Math.round(record.durationMs / 1000))}s)`;
  const code =
    record.exitCode === undefined ? "" : ` exit ${String(record.exitCode)}`;
  const session =
    record.sessionId === undefined || record.sessionId.length === 0
      ? ""
      : ` session ${record.sessionId}`;
  return `${timestampOf(record)} ${record.status ?? "?"}${code}${duration}${session} via ${record.startedBy ?? "?"}`;
}

export function tailFile(
  file: string,
  lines: number,
  maxChars: number,
): string | undefined {
  if (!existsSync(file)) return undefined;
  const content = readFileSync(file, "utf8").trimEnd();
  if (content.length === 0) return "";
  const tail = content.split("\n").slice(-lines).join("\n");
  return tail.length > maxChars ? `...${tail.slice(-maxChars)}` : tail;
}
