import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { jobsTools } from "./tools.js";
import { migrateStorage } from "./migration.js";

export default ((input): Promise<Hooks> => {
  if (typeof input.directory === "string") {
    try {
      const migration = migrateStorage(input.directory, true);
      if (migration.moved.length > 0) {
        console.error(
          `[opencode-jobs] migrated ${String(migration.moved.length)} legacy storage location(s) to jobs paths`,
        );
      }
      for (const warning of migration.warnings) {
        console.error(`[opencode-jobs] migration warning: ${warning}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[opencode-jobs] storage migration failed: ${message}`);
    }
  }
  if (process.platform !== "linux") {
    console.error(
      "[opencode-jobs] warning: this is not a Linux host, systemd user timers are unavailable — scheduling tools will not work here",
    );
  }
  return Promise.resolve({ tool: jobsTools });
}) satisfies Plugin;
