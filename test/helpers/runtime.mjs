import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export function writeExecutable(file, content) {
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

export function readJsonLines(file) {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf8").trim();
  if (content.length === 0) return [];
  return content.split("\n").map((line) => JSON.parse(line));
}

export async function waitFor(check, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
