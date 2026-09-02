import { existsSync, mkdirSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import {
  configRoot,
  jobsDirectory,
  jobsStateDirectory,
  stateRoot,
} from "./paths.js";
import { enableProject } from "./project.js";
import { readRegistryFile } from "./registry.js";

export interface StorageMigration {
  moved: { from: string; to: string }[];
  resyncedProjects: string[];
  warnings: string[];
}

interface Move {
  from: string;
  to: string;
}

function legacyJobsStateDirectory(): string {
  return path.join(configRoot(), "opencode", "scheduler");
}

function legacyRegistryPath(): string {
  return path.join(legacyJobsStateDirectory(), "registry.json");
}

function legacyDefinitionsDirectory(workdir: string): string {
  return path.join(workdir, ".opencode", "scheduler", "jobs");
}

function migrationMoves(projects: Set<string>): Move[] {
  return [
    {
      from: legacyJobsStateDirectory(),
      to: jobsStateDirectory(),
    },
    {
      from: path.join(configRoot(), "opencode", "logs", "scheduler"),
      to: path.join(configRoot(), "opencode", "logs", "jobs"),
    },
    {
      from: path.join(stateRoot(), "opencode", "scheduler", "worktrees"),
      to: path.join(stateRoot(), "opencode", "jobs", "worktrees"),
    },
    ...[...projects].map((workdir) => ({
      from: legacyDefinitionsDirectory(workdir),
      to: jobsDirectory(workdir),
    })),
  ];
}

function removeLegacyProjectDirectory(workdir: string): void {
  try {
    rmdirSync(path.join(workdir, ".opencode", "scheduler"));
  } catch {
    // Keep unrelated or concurrently created files in place.
  }
}

export function migrateStorage(
  projectDirectory: string,
  shouldResync: boolean,
): StorageMigration {
  const project = path.resolve(projectDirectory);
  const legacyRegistry = legacyRegistryPath();
  const canonicalRegistry = path.join(jobsStateDirectory(), "registry.json");
  const registryFile = existsSync(legacyRegistry)
    ? legacyRegistry
    : canonicalRegistry;
  const registry = existsSync(registryFile)
    ? readRegistryFile(registryFile)
    : { version: 1 as const, projects: {} };
  const registeredProjects = new Set(Object.keys(registry.projects));
  const projects = new Set([project, ...registeredProjects]);
  const moves = migrationMoves(projects).filter(({ from }) => existsSync(from));

  for (const { from, to } of moves) {
    if (existsSync(to)) {
      throw new Error(
        `Cannot migrate legacy job storage because both paths exist: ${from} and ${to}. Reconcile or back up one path, then retry; neither path was changed.`,
      );
    }
  }

  for (const { from, to } of moves) {
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(from, to);
  }
  for (const workdir of projects) removeLegacyProjectDirectory(workdir);

  const result: StorageMigration = {
    moved: moves,
    resyncedProjects: [],
    warnings: [],
  };
  if (!shouldResync || moves.length === 0) return result;

  for (const workdir of registeredProjects) {
    try {
      enableProject(workdir);
      result.resyncedProjects.push(workdir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`${workdir}: ${message}`);
    }
  }
  return result;
}
