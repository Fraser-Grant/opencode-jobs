#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installProject, uninstallProject } from "./install.js";
import { errorMessage } from "./json.js";
import { migrateStorage } from "./migration.js";
import { listJobs, runJobNow, type ManagementResult } from "./management.js";
import { disableProject, enableProject } from "./project.js";

const USAGE = `Usage: opencode-jobs <command> [projectDir]

Commands:
  install [projectDir]            Add the plugin and bundled skill to a project (default: current directory)
  uninstall [projectDir] [--purge]  Remove the plugin entry, skill, and systemd units from a project;
                                  --purge also deletes job definitions and job data
  list [projectDir]               List jobs and their enabled, next-run, and last-run state
  enable [projectDir]             Enable or re-sync all jobs in a project
  disable [projectDir]            Disable all jobs in a project while keeping definitions and history
  run <slug> [projectDir]         Run one enabled job immediately
  help                            Show this help`;

function packageDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function printError(message: string): void {
  console.log(
    JSON.stringify({ ok: false, output: `Error: ${message}` }, undefined, 2),
  );
  console.error(USAGE);
  process.exitCode = 1;
}

function projectArgument(command: string, arguments_: string[]): string {
  if (arguments_.some((argument) => argument.startsWith("--"))) {
    throw new Error(`${command} does not accept options`);
  }
  if (arguments_.length > 1) {
    throw new Error(`${command} accepts at most one project directory`);
  }
  return arguments_[0] ?? process.cwd();
}

function runArguments(arguments_: string[]): {
  slug: string;
  project: string;
} {
  if (arguments_.some((argument) => argument.startsWith("--"))) {
    throw new Error("run does not accept options");
  }
  if (arguments_.length === 0 || arguments_.length > 2) {
    throw new Error(
      "run requires a job slug and accepts one project directory",
    );
  }
  return {
    slug: arguments_[0] ?? "",
    project: arguments_[1] ?? process.cwd(),
  };
}

function printManagementResult(result: ManagementResult): void {
  console.log(JSON.stringify(result, undefined, 2));
  if (!result.ok) process.exitCode = 1;
}

interface ParsedArguments {
  project: string | undefined;
  purge: boolean;
}

function parseUninstallArguments(arguments_: string[]): ParsedArguments {
  let project: string | undefined;
  let shouldPurge = false;
  for (const argument of arguments_) {
    if (argument === "--purge") {
      shouldPurge = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (project === undefined) {
      project = argument;
    } else {
      throw new Error("uninstall accepts at most one project directory");
    }
  }
  return { project, purge: shouldPurge };
}

const [command, ...rest] = process.argv.slice(2);

if ([undefined, "help", "--help"].includes(command)) {
  console.log(USAGE);
} else if (command === "install") {
  if (rest.length > 1) {
    printError("install accepts at most one project directory");
  } else {
    try {
      const result = installProject(
        rest[0] ?? process.cwd(),
        packageDirectory(),
      );
      console.log(JSON.stringify(result, undefined, 2));
      if (result.plugin.status === "manual") {
        console.error(
          `Add "opencode-jobs" to the "plugin" array in ${result.plugin.configPath}; the installer did not rewrite that file.`,
        );
        process.exitCode = 1;
      }
    } catch (error) {
      printError(errorMessage(error));
    }
  }
} else if (command === "uninstall") {
  try {
    const { project, purge: shouldPurge } = parseUninstallArguments(rest);
    const result = uninstallProject(
      project ?? process.cwd(),
      packageDirectory(),
      shouldPurge,
    );
    console.log(JSON.stringify(result, undefined, 2));
    if (result.plugin.status === "manual") {
      console.error(
        `Remove "opencode-jobs" from the "plugin" array in ${result.plugin.configPath}; the uninstaller did not rewrite that file.`,
      );
      process.exitCode = 1;
    }
    if (result.skill.status === "kept-modified") {
      console.error(
        `Skill kept at ${result.skill.skillPath} (modified locally); delete it manually if unwanted.`,
      );
    }
  } catch (error) {
    printError(errorMessage(error));
  }
} else if (
  command !== undefined &&
  ["list", "enable", "disable", "run"].includes(command)
) {
  try {
    let slug: string | undefined;
    let project: string;
    if (command === "run") {
      ({ slug, project } = runArguments(rest));
    } else {
      project = projectArgument(command, rest);
    }
    const migration = migrateStorage(project, true);
    for (const warning of migration.warnings) {
      console.error(`storage migration warning: ${warning}`);
    }
    switch (command) {
      case "list": {
        printManagementResult(listJobs(project));
        break;
      }
      case "enable": {
        printManagementResult({ ok: true, output: enableProject(project) });
        break;
      }
      case "disable": {
        printManagementResult({ ok: true, output: disableProject(project) });
        break;
      }
      case "run": {
        printManagementResult(runJobNow(slug ?? "", project));
        break;
      }
      default: {
        throw new Error(`unknown management command: ${command}`);
      }
    }
  } catch (error) {
    printError(errorMessage(error));
  }
} else {
  printError(`unknown command: ${command ?? "(missing)"}`);
}
