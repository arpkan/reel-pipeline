import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { mode: "text" | "hint"; step: "awaiting_source" | "awaiting_content"; sourceInput?: string; stage5Renderer?: "ffmpeg" | "hyperframes"; stage5Template?: "enhanced-default" },
  runSpy: vi.fn(),
  sendSpy: vi.fn(async () => {}),
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn(() => ({
    id: "ds",
    name: "Daily Stories",
    language: "en",
    timezone: "Asia/Bangkok",
    themeWeights: { business: 1 },
    channels: { telegram: { enabled: true, chatIdEnvVar: "TELEGRAM_DS_CHAT_ID" } },
    reels: { enabled: true, scheduleEnabled: true, reelTimes: ["09:00"] },
  })),
  ds: { id: "ds", channels: {} },
  ns: { id: "ns", channels: {} },
  ts: { id: "ts", channels: {} },
}));

vi.mock("../src/db/queries.js", () => ({
  getLineEventsAfter: vi.fn(),
  getLatestLineEventId: vi.fn(() => 0),
  getActiveRunForBrand: vi.fn(),
  getThemeWeights: vi.fn(() => ({})),
  setThemeWeight: vi.fn(),
  getRunById: vi.fn(),
  getRecentRuns: vi.fn(() => []),
  getPostsByRun: vi.fn(() => []),
  getLatestPendingRunForBrand: vi.fn(),
  getDuePostsForPublishing: vi.fn(() => []),
  getRecentReels: vi.fn(() => []),
  getReelById: vi.fn(),
  getReelByShortId: vi.fn(),
  updateReel: vi.fn(),
}));

vi.mock("../src/pipeline/runner.js", () => ({
  PipelineRunner: { run: vi.fn(), reconstructContext: vi.fn() },
  requestCancelRun: vi.fn(),
  resolveScheduledDatetime: vi.fn(),
}));

vi.mock("../src/pipeline/reel-runner.js", () => ({
  ReelRunner: {
    run: state.runSpy,
    confirm: vi.fn(),
    resume: vi.fn(),
    rebuild: vi.fn(),
    rerescript: vi.fn(),
    rebuildPart: vi.fn(),
  },
  isReelRunning: vi.fn(() => false),
  setSkipNextReel: vi.fn(),
  cancelSkipNextReel: vi.fn(),
  isSkipNextReel: vi.fn(() => 0),
  requestCancelReel: vi.fn(),
}));

vi.mock("../src/pipeline/reel-intake-session-store.js", () => ({
  getReelIntakeSession: vi.fn(() => state.session),
  clearReelIntakeSession: vi.fn(() => {
    state.session = null;
  }),
  setReelIntakeSession: vi.fn((params: { mode: "text" | "hint"; step: "awaiting_source" | "awaiting_content"; sourceInput?: string; stage5Renderer?: "ffmpeg" | "hyperframes"; stage5Template?: "enhanced-default" }) => {
    state.session = { mode: params.mode, step: params.step, sourceInput: params.sourceInput, stage5Renderer: params.stage5Renderer, stage5Template: params.stage5Template };
  }),
}));

let handleCommand: typeof import("../src/pipeline/command-listener.js")["handleCommand"];

beforeAll(async () => {
  ({ handleCommand } = await import("../src/pipeline/command-listener.js"));
});

describe("reel manual intake command flow", () => {
  beforeEach(() => {
    state.session = null;
    state.runSpy.mockReset();
    state.runSpy.mockResolvedValue(undefined);
    state.sendSpy.mockClear();
  });

  it("starts !reel text intake and consumes source + content", async () => {
    const sender = { sendMessage: state.sendSpy };

    await handleCommand("ds", "chat-1", "!reel text", sender);
    expect(state.session?.step).toBe("awaiting_source");

    await handleCommand("ds", "chat-1", "internal memo", sender);
    expect(state.session?.step).toBe("awaiting_content");
    expect(state.session?.sourceInput).toBe("internal memo");

    await handleCommand("ds", "chat-1", "This is the operator supplied text", sender);
    expect(state.runSpy).toHaveBeenCalledWith("ds", expect.objectContaining({
      manualSourceMode: "text",
      manualSourceInput: "internal memo",
      manualSourceText: "This is the operator supplied text",
    }));
    expect(state.session).toBeNull();
  });

  it("carries stage5 flags from !reel text intake into the final run", async () => {
    const sender = { sendMessage: state.sendSpy };

    await handleCommand("ds", "chat-1", "!reel text -hf -template enhanced-default", sender);
    expect(state.session).toEqual(expect.objectContaining({
      step: "awaiting_source",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    }));

    await handleCommand("ds", "chat-1", "internal memo", sender);
    expect(state.session).toEqual(expect.objectContaining({
      step: "awaiting_content",
      sourceInput: "internal memo",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    }));

    await handleCommand("ds", "chat-1", "This is the operator supplied text", sender);
    expect(state.runSpy).toHaveBeenCalledWith("ds", expect.objectContaining({
      manualSourceMode: "text",
      manualSourceInput: "internal memo",
      manualSourceText: "This is the operator supplied text",
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    }));
    expect(state.session).toBeNull();
  });

  it("accepts !reel text with trailing punctuation", async () => {
    const sender = { sendMessage: state.sendSpy };

    await handleCommand("ds", "chat-1", "!reel text.", sender);

    expect(state.session?.mode).toBe("text");
    expect(state.session?.step).toBe("awaiting_source");
    expect(state.sendSpy).toHaveBeenCalledWith("chat-1", "📝 Send source now (URL or free-text label).");
  });
});
