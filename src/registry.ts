import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite, registryPath } from "./paths.js";
import { isRecord, stringProperty } from "./json.js";

export interface RegistryEntry {
  scopeId: string;
  workdir: string;
  enabledAt: string;
  updatedAt: string;
  jobs: string[];
}

export interface Registry {
  version: 1;
  projects: Record<string, RegistryEntry>;
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  if (!isRecord(value)) return false;
  return (
    stringProperty(value, "scopeId") !== undefined &&
    stringProperty(value, "workdir") !== undefined &&
    stringProperty(value, "enabledAt") !== undefined &&
    stringProperty(value, "updatedAt") !== undefined &&
    Array.isArray(value.jobs) &&
    value.jobs.every((job) => typeof job === "string")
  );
}

export function loadRegistry(): Registry {
  try {
    const parsed: unknown = JSON.parse(readFileSync(registryPath(), "utf8"));
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isRecord(parsed.projects)
    ) {
      return { version: 1, projects: {} };
    }
    const projects: Record<string, RegistryEntry> = {};
    for (const [key, value] of Object.entries(parsed.projects)) {
      if (isRegistryEntry(value)) projects[key] = value;
    }
    return { version: 1, projects };
  } catch {
    // Missing or unreadable registry: start fresh.
    return { version: 1, projects: {} };
  }
}

export function saveRegistry(registry: Registry): void {
  atomicWrite(registryPath(), `${JSON.stringify(registry, undefined, 2)}\n`);
}

export function registryEntry(workdir: string): RegistryEntry | undefined {
  return loadRegistry().projects[path.resolve(workdir)];
}
