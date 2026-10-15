import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");

// Read by code but deliberately left out of .env.example: features that are
// switched off in production, optional overrides, and test-only switches.
const INTENTIONALLY_UNDOCUMENTED = new Set([
  "AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_API_VERSION", "AZURE_FOUNDRY_DEPLOYMENT", "AZURE_FOUNDRY_ENDPOINT", "AZURE_IMAGE_QUALITY",
  "REEL_ASSEMBLY_OFFLOAD_ENABLED", "REEL_ASSEMBLY_QUEUE_URL", "REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID",
  "WORKER_API_TOKEN", "WORKER_WORK_DIR",
  "DS_TIKTOK_ACCESS_TOKEN", "TS_TIKTOK_ACCESS_TOKEN",
  "DS_REEL_VOICE_ID", "NS_REEL_VOICE_ID",
  "PUBLIC_BASE_URL",
  "TEST_ELEVENLABS_MODEL",
]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

function envVarsReadByCode(): Set<string> {
  const vars = new Set<string>();
  for (const dir of ["src", "bin", "api"]) {
    for (const file of tsFiles(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) vars.add(m[1]);
    }
  }
  return vars;
}

function envVarsInExample(): Set<string> {
  const text = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  // Commented-out entries ("# NAME=") count as documented.
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

describe(".env.example", () => {
  it("lists every env var the code reads, unless intentionally undocumented", () => {
    const documented = envVarsInExample();
    const missing = [...envVarsReadByCode()].filter((v) => !documented.has(v) && !INTENTIONALLY_UNDOCUMENTED.has(v));
    expect(missing).toEqual([]);
  });

  it("has no stale entries in the intentionally-undocumented list", () => {
    const read = envVarsReadByCode();
    expect([...INTENTIONALLY_UNDOCUMENTED].filter((v) => !read.has(v))).toEqual([]);
  });
});
