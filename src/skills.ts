import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { configRoot } from "./paths.js";

export interface ResolvedSkill {
  name: string;
  content: string;
  file: string;
}

function skillCandidates(name: string, workdir: string): string[] {
  return [
    path.join(workdir, ".opencode", "skills", name, "SKILL.md"),
    path.join(workdir, ".opencode", "skill", name, "SKILL.md"),
    path.join(workdir, ".claude", "skills", name, "SKILL.md"),
    path.join(workdir, ".agents", "skills", name, "SKILL.md"),
    path.join(configRoot(), "opencode", "skills", name, "SKILL.md"),
    path.join(configRoot(), "opencode", "skill", name, "SKILL.md"),
    path.join(homedir(), ".claude", "skills", name, "SKILL.md"),
    path.join(homedir(), ".agents", "skills", name, "SKILL.md"),
  ];
}

export function resolveSkills(
  names: readonly string[],
  workdir: string,
): ResolvedSkill[] {
  return names.map((name) => {
    const candidates = skillCandidates(name, workdir);
    const file = candidates.find((candidate) => existsSync(candidate));
    if (file === undefined) {
      throw new Error(
        `Unknown skill "${name}". Expected SKILL.md in a project or global skill directory (searched: ${candidates.join(", ")})`,
      );
    }
    return { name, content: readFileSync(file, "utf8"), file };
  });
}
