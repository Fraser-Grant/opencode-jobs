#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installProject, uninstallProject } from "./install.js";
import { errorMessage } from "./json.js";

const USAGE = `Usage: opencode-jobs <command> [projectDir]

Commands:
  install [projectDir]            Add the plugin and bundled skill to a project (default: current directory)
  uninstall [projectDir] [--purge]  Remove the plugin entry, skill, and systemd units from a project;
                                  --purge also deletes job definitions and job data
  help                            Show this help`;

function packageDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function printError(message: string): void {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exitCode = 1;
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
} else {
  printError(`unknown command: ${command ?? "(missing)"}`);
}
