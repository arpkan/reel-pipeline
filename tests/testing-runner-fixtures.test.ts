import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFixturePath } from "../test/runner.js";

describe("resolveFixturePath", () => {
  it("falls back to repo test/fixtures when base dir has no fixtures", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-path-"));
    const baseDir = path.join(tmpRoot, "dist", "test");
    const repoFixtureDir = path.join(tmpRoot, "test", "fixtures");
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(repoFixtureDir, { recursive: true });

    const fixturePath = path.join(repoFixtureDir, "tavily-search.json");
    fs.writeFileSync(fixturePath, "{}", "utf8");

    const resolved = resolveFixturePath("tavily-search.json", baseDir, tmpRoot);
    expect(resolved).toBe(fixturePath);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
