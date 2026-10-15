import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync, unlinkSync } from "fs";

// Must set env BEFORE any db module is imported (ESM hoisting requires dynamic imports below)
const TEST_DB_PATH = `/tmp/test-pipeline-${process.pid}-${Date.now()}.db`;
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
process.env.PIPELINE_DB_PATH = TEST_DB_PATH;

// Dynamic imports so env is set first
const q = await import("../../src/db/queries.js");
const { createRun, updateRunStatus, getRunById, getRecentRuns,
  createStageLog, getActiveRunForBrand,
  createReel, updateReel, getStaleGeneratingReels, getBlockingReelCount, acquireReelStartLock, releaseReelStartLock,
  acquireReelScheduleSlot, releaseReelScheduleSlot } = q;

afterAll(() => {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
});

describe("Database integration", () => {
  const runId = `test-run-${Date.now()}`;
  const runDate = new Date().toISOString().slice(0, 10);

  it("creates a run", () => {
    createRun({ id: runId, brand: "ds", runDate });
    const run = getRunById(runId);
    expect(run?.id).toBe(runId);
    expect(run?.status).toBe("running");
    expect(run?.brand).toBe("ds");
  });

  it("updates run status", () => {
    updateRunStatus(runId, "awaiting_approval", { reviewUrl: "https://example.com/review" });
    const run = getRunById(runId);
    expect(run?.status).toBe("awaiting_approval");
    expect(run?.reviewUrl).toBe("https://example.com/review");
  });

  it("creates stage logs", () => {
    createStageLog(runId, { stage: "stage1-discover", status: "ok", durationMs: 1200 });
    createStageLog(runId, { stage: "stage2-captions", status: "ok", durationMs: 800 });
  });

  it("lists recent runs for brand", () => {
    const runs = getRecentRuns("ds", 10);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].brand).toBe("ds");
  });

  it("detects active run for brand", () => {
    updateRunStatus(runId, "running");
    const active = getActiveRunForBrand("ds", runDate);
    expect(active?.id).toBe(runId);
  });

  it("stale reel heartbeat ignores generating rows with unknown stage", () => {
    const runDate = new Date().toISOString().slice(0, 10);

    // Simulates dry-run/early-exit rows: generating, but no current stage set
    createReel({
      id: "reel-unknown-stage",
      brand: "ns",
      runDate,
      headline: "Unknown stage reel",
      sourceUrl: "https://example.com/unknown",
    });

    // Simulates a genuinely stuck stage run: generating with current stage set
    createReel({
      id: "reel-stuck-stage",
      brand: "ns",
      runDate,
      headline: "Stuck stage reel",
      sourceUrl: "https://example.com/stuck",
    });
    updateReel("reel-stuck-stage", { currentStage: "reel-stage3-voice" });

    // staleMinutes=-1 => cutoff is in the future, so all qualifying rows are stale
    const stale = getStaleGeneratingReels(-1).map((r) => r.id);

    expect(stale).toContain("reel-stuck-stage");
    expect(stale).not.toContain("reel-unknown-stage");
  });

  it("allows only one active reel start lock per brand", () => {
    expect(acquireReelStartLock("ns", "lock-run-1", 30)).toBe(true);
    expect(acquireReelStartLock("ns", "lock-run-2", 30)).toBe(false);

    releaseReelStartLock("ns", "lock-run-2");
    expect(acquireReelStartLock("ns", "lock-run-3", 30)).toBe(false);

    releaseReelStartLock("ns", "lock-run-1");
    expect(acquireReelStartLock("ns", "lock-run-3", 30)).toBe(true);
    releaseReelStartLock("ns", "lock-run-3");
  });

  it("does not treat awaiting script confirmation reels as blocking active starts", () => {
    createReel({
      id: "reel-awaiting-script-confirmation",
      brand: "ds",
      runDate,
      headline: "Awaiting confirmation reel",
      sourceUrl: "https://example.com/awaiting-script",
    });
    updateReel("reel-awaiting-script-confirmation", { status: "awaiting_script_confirmation", currentStage: null });

    expect(getBlockingReelCount("ds")).toBe(0);
  });

  it("replaces stale reel start locks", () => {
    expect(acquireReelStartLock("ds", "stale-lock-run-1", 30)).toBe(true);
    expect(acquireReelStartLock("ds", "stale-lock-run-2", -1)).toBe(true);

    releaseReelStartLock("ds", "stale-lock-run-1");
    expect(acquireReelStartLock("ds", "stale-lock-run-3", 30)).toBe(false);

    releaseReelStartLock("ds", "stale-lock-run-2");
  });

  it("allows only one scheduled reel per brand slot", () => {
    expect(acquireReelScheduleSlot("ns", "2026-05-22 12:00", "slot-run-1")).toBe(true);
    expect(acquireReelScheduleSlot("ns", "2026-05-22 12:00", "slot-run-2")).toBe(false);
    expect(acquireReelScheduleSlot("ns", "2026-05-22 16:30", "slot-run-3")).toBe(true);
    expect(acquireReelScheduleSlot("ds", "2026-05-22 12:00", "slot-run-4")).toBe(true);
  });

  it("releases a scheduled reel slot for the matching run", () => {
    expect(acquireReelScheduleSlot("ds", "2026-05-22 18:30", "slot-run-release-1")).toBe(true);
    releaseReelScheduleSlot("ds", "2026-05-22 18:30", "wrong-run");
    expect(acquireReelScheduleSlot("ds", "2026-05-22 18:30", "slot-run-release-2")).toBe(false);

    releaseReelScheduleSlot("ds", "2026-05-22 18:30", "slot-run-release-1");
    expect(acquireReelScheduleSlot("ds", "2026-05-22 18:30", "slot-run-release-2")).toBe(true);
  });
});
