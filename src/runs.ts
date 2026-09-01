import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { runsFile } from "./paths.js";

const optionalString = z.string().optional().catch(undefined);
const optionalNumber = z.number().optional().catch(undefined);
const runRecordSchema = z.object({
  runId: optionalString,
  slug: optionalString,
  scopeId: optionalString,
  startedAt: optionalNumber,
  finishedAt: optionalNumber,
  durationMs: optionalNumber,
  status: optionalString,
  exitCode: optionalNumber,
  sessionId: optionalString,
  startedBy: optionalString,
  worktreeBranch: optionalString,
  worktreeCommit: optionalString,
});

export type RunRecord = z.infer<typeof runRecordSchema>;

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
      const result = runRecordSchema.safeParse(value);
      if (result.success) records.push(result.data);
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
  const worktree =
    record.worktreeBranch === undefined || record.worktreeBranch.length === 0
      ? ""
      : ` worktree ${record.worktreeBranch}` +
        (record.worktreeCommit === undefined ||
        record.worktreeCommit.length === 0
          ? ""
          : `@${record.worktreeCommit.slice(0, 7)}`);
  return `${timestampOf(record)} ${record.status ?? "?"}${code}${duration}${session}${worktree} via ${record.startedBy ?? "?"}`;
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
