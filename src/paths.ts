import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { homedir } from "node:os";

export function configRoot(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
}

export function stateRoot(): string {
  return process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state");
}

export function worktreesDirectory(scopeId: string): string {
  return path.join(stateRoot(), "opencode", "scheduler", "worktrees", scopeId);
}

export function locksDirectory(scopeId: string): string {
  return path.join(schedulerDirectory(), "locks", scopeId);
}

export function schedulerDirectory(): string {
  return path.join(configRoot(), "opencode", "scheduler");
}

export function registryPath(): string {
  return path.join(schedulerDirectory(), "registry.json");
}

export function scopeDirectory(scopeId: string): string {
  return path.join(schedulerDirectory(), "scopes", scopeId);
}

export function runsDirectory(scopeId: string): string {
  return path.join(schedulerDirectory(), "runs", scopeId);
}

export function runsFile(scopeId: string, slug: string): string {
  return path.join(runsDirectory(scopeId), `${slug}.jsonl`);
}

export function sessionStateDirectory(scopeId: string): string {
  return path.join(schedulerDirectory(), "sessions", scopeId);
}

export function sessionStateFile(scopeId: string, slug: string): string {
  return path.join(sessionStateDirectory(scopeId), `${slug}.txt`);
}

export function logDirectory(scopeId: string): string {
  return path.join(configRoot(), "opencode", "logs", "scheduler", scopeId);
}

export function logFile(scopeId: string, slug: string): string {
  return path.join(logDirectory(scopeId), `${slug}.log`);
}

export function systemdUserDirectory(): string {
  return path.join(configRoot(), "systemd", "user");
}

export function jobsDirectory(workdir: string): string {
  return path.join(workdir, ".opencode", "scheduler", "jobs");
}

export function unitBase(scopeId: string, slug: string): string {
  return `opencode-sched-${scopeId}-${slug}`;
}

export function timerUnit(base: string): string {
  return `${base}.timer`;
}

export function serviceUnit(base: string): string {
  return `${base}.service`;
}

export function runScriptPath(scopeId: string, slug: string): string {
  return path.join(scopeDirectory(scopeId), `run-${slug}.sh`);
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "job";
}

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function unitQuote(value: string): string {
  if (/^[A-Za-z0-9_@:=./-]*$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`)}"`;
}

export function escapeUnitText(value: string): string {
  return value.replaceAll("%", "%%").replaceAll(/\s+/g, " ").trim();
}

export function atomicWrite(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

export function atomicWriteExecutable(file: string, content: string): void {
  atomicWrite(file, content);
  chmodSync(file, 0o755);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function deriveScopeId(workdir: string): string {
  const abs = path.resolve(workdir);
  const hash = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  return `${slugify(path.basename(abs))}-${hash}`;
}
