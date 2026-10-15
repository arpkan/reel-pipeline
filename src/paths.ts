import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Repo root: the nearest directory above this module that has a package.json.
// Works from src/ (tsx) and dist/src/ (node) alike.
function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("package.json not found above " + fileURLToPath(import.meta.url));
    dir = parent;
  }
  return dir;
}

export const PROJECT_ROOT = findProjectRoot();

/** Absolute path to a file under assets/, e.g. assetPath("music", "open-1.mp3"). */
export function assetPath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, "assets", ...parts);
}
