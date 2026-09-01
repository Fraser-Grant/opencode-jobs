import { existsSync, readFileSync, rmSync, rmdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import {
  atomicWrite,
  deriveScopeId,
  locksDirectory,
  logDirectory,
  runsDirectory,
  scopeDirectory,
  sessionStateDirectory,
  worktreesDirectory,
} from "./paths.js";
import { disableProject } from "./project.js";
import { registryEntry } from "./registry.js";
import { migrateStorage, type StorageMigration } from "./migration.js";

export const PACKAGE_NAME = "opencode-jobs";
export const SKILL_NAME = "opencode-jobs";
const CONFIG_SCHEMA = "https://opencode.ai/config.json";
const configSchema = z.looseObject({
  plugin: z.array(z.unknown()).optional(),
});
type Config = z.infer<typeof configSchema>;

export type ConfigInstall =
  | { status: "added" | "present"; configPath: string }
  | { status: "manual"; configPath: string };

export interface SkillInstall {
  status: "written" | "unchanged";
  skillPath: string;
}

export interface ProjectInstall {
  projectDirectory: string;
  plugin: ConfigInstall;
  skill: SkillInstall;
  migration?: StorageMigration;
}

const CONFIG_LOCATIONS = [
  "opencode.json",
  "opencode.jsonc",
  path.join(".opencode", "opencode.json"),
  path.join(".opencode", "opencode.jsonc"),
];

function existingConfigPath(projectDirectory: string): string | undefined {
  for (const relativePath of CONFIG_LOCATIONS) {
    const configPath = path.join(projectDirectory, relativePath);
    if (existsSync(configPath)) return configPath;
  }
  return undefined;
}

function readConfig(configPath: string): Config | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    const result = configSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    // JSONC comments and malformed JSON must be handled by the user.
    return undefined;
  }
}

function isPackageSpecifier(value: unknown): boolean {
  return (
    value === PACKAGE_NAME ||
    (typeof value === "string" && value.startsWith(`${PACKAGE_NAME}@`))
  );
}

function isPackageReference(entry: unknown): boolean {
  if (typeof entry === "string") return isPackageSpecifier(entry);
  return Array.isArray(entry) && isPackageSpecifier(entry[0]);
}

export function installPluginConfig(projectDirectory: string): ConfigInstall {
  const existingPath = existingConfigPath(projectDirectory);
  const configPath =
    existingPath ?? path.join(projectDirectory, "opencode.json");

  if (existingPath === undefined) {
    atomicWrite(
      configPath,
      `${JSON.stringify(
        {
          $schema: CONFIG_SCHEMA,
          plugin: [PACKAGE_NAME],
        },
        undefined,
        2,
      )}\n`,
    );
    return { status: "added", configPath };
  }

  const config = readConfig(configPath);
  if (config === undefined) return { status: "manual", configPath };
  const entries = config.plugin ?? [];
  if (entries.some((entry) => isPackageReference(entry))) {
    return { status: "present", configPath };
  }
  config.plugin = [...entries, PACKAGE_NAME];
  atomicWrite(configPath, `${JSON.stringify(config, undefined, 2)}\n`);
  return { status: "added", configPath };
}

export function installSkill(
  projectDirectory: string,
  packageDirectory: string,
): SkillInstall {
  const sourcePath = path.join(
    packageDirectory,
    "skill",
    SKILL_NAME,
    "SKILL.md",
  );
  const skillPath = path.join(
    projectDirectory,
    ".opencode",
    "skills",
    SKILL_NAME,
    "SKILL.md",
  );
  const content = readFileSync(sourcePath, "utf8");
  if (existsSync(skillPath) && readFileSync(skillPath, "utf8") === content) {
    return { status: "unchanged", skillPath };
  }
  atomicWrite(skillPath, content);
  return { status: "written", skillPath };
}

export function installProject(
  projectDirectory: string,
  packageDirectory: string,
): ProjectInstall {
  const resolvedProject = path.resolve(projectDirectory);
  if (
    !existsSync(resolvedProject) ||
    !statSync(resolvedProject).isDirectory()
  ) {
    throw new Error(`Project directory does not exist: ${resolvedProject}`);
  }
  const migration = migrateStorage(resolvedProject, true);
  return {
    projectDirectory: resolvedProject,
    plugin: installPluginConfig(resolvedProject),
    skill: installSkill(resolvedProject, packageDirectory),
    ...(migration.moved.length > 0 && { migration }),
  };
}

export type ConfigUninstall =
  | { status: "removed" | "absent"; configPath: string }
  | { status: "manual"; configPath: string };

export interface SkillUninstall {
  status: "removed" | "absent" | "kept-modified";
  skillPath: string;
}

export interface PurgeResult {
  paths: string[];
}

export interface ProjectUninstall {
  projectDirectory: string;
  disabled: boolean;
  plugin: ConfigUninstall;
  skill: SkillUninstall;
  purge?: PurgeResult;
  migration?: StorageMigration;
}

function removeDirectoryIfEmpty(directory: string): void {
  try {
    rmdirSync(directory);
  } catch {
    // Missing or non-empty: leave it in place.
  }
}

export function uninstallPluginConfig(
  projectDirectory: string,
): ConfigUninstall {
  const existingPath = existingConfigPath(projectDirectory);
  const configPath =
    existingPath ?? path.join(projectDirectory, "opencode.json");
  if (existingPath === undefined) return { status: "absent", configPath };
  const config = readConfig(configPath);
  if (config === undefined) return { status: "manual", configPath };
  const entries = config.plugin ?? [];
  const remaining = entries.filter((entry) => !isPackageReference(entry));
  if (remaining.length === entries.length) {
    return { status: "absent", configPath };
  }
  delete config.plugin;
  const wasInstallerCreated =
    entries.length === 1 &&
    Object.keys(config).length === 1 &&
    config.$schema === CONFIG_SCHEMA;
  if (wasInstallerCreated) {
    rmSync(configPath);
  } else {
    if (remaining.length > 0) config.plugin = remaining;
    atomicWrite(configPath, `${JSON.stringify(config, undefined, 2)}\n`);
  }
  return { status: "removed", configPath };
}

export function uninstallSkill(
  projectDirectory: string,
  packageDirectory: string,
): SkillUninstall {
  const sourcePath = path.join(
    packageDirectory,
    "skill",
    SKILL_NAME,
    "SKILL.md",
  );
  const skillDirectory = path.join(
    projectDirectory,
    ".opencode",
    "skills",
    SKILL_NAME,
  );
  const skillPath = path.join(skillDirectory, "SKILL.md");
  if (!existsSync(skillPath)) return { status: "absent", skillPath };
  if (readFileSync(skillPath, "utf8") !== readFileSync(sourcePath, "utf8")) {
    return { status: "kept-modified", skillPath };
  }
  rmSync(skillDirectory, { recursive: true, force: true });
  removeDirectoryIfEmpty(path.dirname(skillDirectory));
  removeDirectoryIfEmpty(path.join(projectDirectory, ".opencode"));
  return { status: "removed", skillPath };
}

export function purgeProjectData(projectDirectory: string): PurgeResult {
  const abs = path.resolve(projectDirectory);
  const scopeId = deriveScopeId(abs);
  const targets = [
    scopeDirectory(scopeId),
    runsDirectory(scopeId),
    sessionStateDirectory(scopeId),
    logDirectory(scopeId),
    locksDirectory(scopeId),
    worktreesDirectory(scopeId),
    path.join(abs, ".opencode", "jobs"),
  ];
  const paths: string[] = [];
  for (const target of targets) {
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    paths.push(target);
  }
  if (paths.includes(worktreesDirectory(scopeId))) {
    spawnSync("git", ["-C", abs, "worktree", "prune"], { stdio: "ignore" });
  }
  removeDirectoryIfEmpty(path.join(abs, ".opencode"));
  return { paths };
}

export function uninstallProject(
  projectDirectory: string,
  packageDirectory: string,
  shouldPurge: boolean,
): ProjectUninstall {
  const resolvedProject = path.resolve(projectDirectory);
  if (
    !existsSync(resolvedProject) ||
    !statSync(resolvedProject).isDirectory()
  ) {
    throw new Error(`Project directory does not exist: ${resolvedProject}`);
  }
  const migration = migrateStorage(resolvedProject, false);
  const wasEnabled = registryEntry(resolvedProject) !== undefined;
  if (wasEnabled) disableProject(resolvedProject);
  const uninstall: ProjectUninstall = {
    projectDirectory: resolvedProject,
    disabled: wasEnabled,
    plugin: uninstallPluginConfig(resolvedProject),
    skill: uninstallSkill(resolvedProject, packageDirectory),
    ...(migration.moved.length > 0 && { migration }),
  };
  if (shouldPurge) uninstall.purge = purgeProjectData(resolvedProject);
  return uninstall;
}
