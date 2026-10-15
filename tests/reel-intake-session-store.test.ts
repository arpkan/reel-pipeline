import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "fs";

const TEST_DB_PATH = `/tmp/test-reel-intake-${process.pid}-${Date.now()}.db`;
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
process.env.PIPELINE_DB_PATH = TEST_DB_PATH;

const q = await import("../src/db/queries.js");
const { clearExpiredReelIntakeSessions, upsertReelIntakeSession } = q;
const sessionStore = await import("../src/pipeline/reel-intake-session-store.js");
const { clearReelIntakeSession, getReelIntakeSession, setReelIntakeSession } = sessionStore;

describe("reel intake session store", () => {
  beforeEach(() => {
    clearReelIntakeSession("ds", "chat-1");
  });

  afterAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it("creates and reads session by brand/chat", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const row = getReelIntakeSession("ds", "chat-1");
    expect(row?.mode).toBe("text");
    expect(row?.step).toBe("awaiting_source");
  });

  it("round-trips stage5 overrides", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const row = getReelIntakeSession("ds", "chat-1");
    expect(row?.stage5Renderer).toBe("hyperframes");
    expect(row?.stage5Template).toBe("enhanced-default");
  });

  it("maps legacy ffmpeg renderer to undefined on read", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      stage5Renderer: "ffmpeg",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const row = getReelIntakeSession("ds", "chat-1");
    expect(row?.stage5Renderer).toBeUndefined();
  });

  it("returns null for expired session", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "hint",
      step: "awaiting_content",
      sourceInput: "internal memo",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    expect(getReelIntakeSession("ds", "chat-1")).toBeNull();
  });

  it("clears expired sessions in bulk", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    const deleted = clearExpiredReelIntakeSessions();
    expect(deleted).toBeGreaterThanOrEqual(1);
  });

  it("persists stage5 overrides via setReelIntakeSession public API", () => {
    setReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      sourceInput: "manual source",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    });

    const row = getReelIntakeSession("ds", "chat-1");
    expect(row?.mode).toBe("text");
    expect(row?.step).toBe("awaiting_source");
    expect(row?.sourceInput).toBe("manual source");
    expect(row?.stage5Renderer).toBe("hyperframes");
    expect(row?.stage5Template).toBe("enhanced-default");
  });
});
