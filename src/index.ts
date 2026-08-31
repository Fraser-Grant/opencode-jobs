import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { schedulerTools } from "./tools.js";

export default ((): Promise<Hooks> => {
  if (process.platform !== "linux") {
    console.error(
      "[opencode-jobs] warning: this is not a Linux host, systemd user timers are unavailable — scheduling tools will not work here",
    );
  }
  return Promise.resolve({ tool: schedulerTools });
}) satisfies Plugin;
