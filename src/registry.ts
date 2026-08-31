import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, registryPath } from "./paths.js";

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

const registryEntrySchema = z.looseObject({
  scopeId: z.string(),
  workdir: z.string(),
  enabledAt: z.string(),
  updatedAt: z.string(),
  jobs: z.array(z.string()),
});

const registryFileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.unknown()),
});

export function loadRegistry(): Registry {
  try {
    const parsed: unknown = JSON.parse(readFileSync(registryPath(), "utf8"));
    const result = registryFileSchema.safeParse(parsed);
    if (!result.success) return { version: 1, projects: {} };
    const projects: Record<string, RegistryEntry> = {};
    for (const [key, value] of Object.entries(result.data.projects)) {
      const entry = registryEntrySchema.safeParse(value);
      if (entry.success) projects[key] = entry.data;
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
