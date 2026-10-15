import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sendSpy: vi.fn(async () => {}),
  recentReels: [] as Array<{ id: string; status: string; headline: string; reviewUrl?: string; scheduledTime?: string }>,
  shortReel: null as null | { id: string; status: string; headline: string },
  run: vi.fn(),
  confirm: vi.fn(),
  resume: vi.fn(),
  rebuild: vi.fn(),
  rerescript: vi.fn(),
  rebuildPart: vi.fn(),
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn(() => ({
    id: "ns",
    name: "WorldBrief",
    language: "en",
    timezone: "Europe/Berlin",
    themeWeights: { Politics: 1 },
    channels: { telegram: { enabled: true, chatIdEnvVar: "TELEGRAM_NS_CHAT_ID" } },
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
  getRecentReels: vi.fn(() => state.recentReels),
  getReelById: vi.fn(),
  getReelByShortId: vi.fn(() => state.shortReel),
  updateReel: vi.fn(),
}));

vi.mock("../src/pipeline/runner.js", () => ({
  PipelineRunner: { run: vi.fn(), reconstructContext: vi.fn() },
  requestCancelRun: vi.fn(),
  resolveScheduledDatetime: vi.fn(),
}));

vi.mock("../src/pipeline/reel-runner.js", () => ({
  ReelRunner: {
    run: state.run,
    confirm: state.confirm,
    resume: state.resume,
    rebuild: state.rebuild,
    rerescript: state.rerescript,
    rebuildPart: state.rebuildPart,
  },
  isReelRunning: vi.fn(() => false),
  setSkipNextReel: vi.fn(),
  cancelSkipNextReel: vi.fn(),
  isSkipNextReel: vi.fn(() => 0),
  requestCancelReel: vi.fn(),
}));

vi.mock("../src/pipeline/reel-intake-session-store.js", () => ({
  getReelIntakeSession: vi.fn(() => null),
  clearReelIntakeSession: vi.fn(),
  setReelIntakeSession: vi.fn(),
}));

let handleCommand: typeof import("../src/pipeline/command-listener.js")["handleCommand"];

beforeAll(async () => {
  ({ handleCommand } = await import("../src/pipeline/command-listener.js"));
});

describe("Telegram reel stage5 flags", () => {
  beforeEach(() => {
    state.sendSpy.mockClear();
    state.recentReels = [{ id: "abcdef12-0000-4000-9000-000000000000", status: "awaiting_approval", headline: "Test reel" }];
    state.shortReel = { id: "abcdef12-0000-4000-9000-000000000000", status: "awaiting_approval", headline: "Test reel" };
    for (const spy of [state.run, state.confirm, state.resume, state.rebuild, state.rerescript, state.rebuildPart]) {
      spy.mockReset();
      spy.mockResolvedValue(undefined);
    }
  });

  it("passes Hyperframes flags to manual reel generation", async () => {
    await handleCommand("ns", "chat-1", "!reel trending -hf -template enhanced-default", { sendMessage: state.sendSpy });

    expect(state.run).toHaveBeenCalledWith("ns", expect.objectContaining({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    }));
  });

  it("rejects legacy -ffmpeg flag with guidance", async () => {
    await handleCommand("ns", "chat-1", "!reel trending -ffmpeg", { sendMessage: state.sendSpy });

    expect(state.run).not.toHaveBeenCalled();
    expect(state.sendSpy).toHaveBeenCalledWith(
      "chat-1",
      "❌ Stage 5 ffmpeg renderer is retired. Hyperframes is now the default.",
    );
  });

  it.each([
    ["confirm", state.confirm, 3],
    ["resume", state.resume, 3],
    ["rebuild", state.rebuild, 3],
    ["rescript", state.rerescript, 5],
  ] as const)("passes Hyperframes flags to !reel %s", async (command, spy, overrideArgIndex) => {
    await handleCommand("ns", "chat-1", `!reel ${command} abcdef12 -hf -template enhanced-default`, { sendMessage: state.sendSpy });

    expect(spy.mock.calls[0][0]).toBe("abcdef12-0000-4000-9000-000000000000");
    expect(spy.mock.calls[0][1]).toBe("ns");
    expect(spy.mock.calls[0][overrideArgIndex]).toEqual(expect.objectContaining({
      stage5Renderer: "hyperframes",
      stage5Template: "enhanced-default",
    }));
  });

  it.each([
    ["re-voice abcdef12", "voice"],
    ["re-images abcdef12", "images"],
    ["re-music abcdef12", "music"],
    ["re-effect abcdef12 zoom_in", "video"],
  ] as const)("passes Hyperframes flags to !reel %s", async (command, part) => {
    await handleCommand("ns", "chat-1", `!reel ${command} -hf -template enhanced-default`, { sendMessage: state.sendSpy });

    expect(state.rebuildPart).toHaveBeenCalledWith(
      "abcdef12-0000-4000-9000-000000000000",
      "ns",
      part,
      expect.objectContaining({
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
      }),
    );
  });

  it("passes -nostock to !reel re-images after general reel flag parsing", async () => {
    await handleCommand("ns", "chat-1", "!reel re-images abcdef12 -nostock", { sendMessage: state.sendSpy });

    expect(state.rebuildPart).toHaveBeenCalledWith(
      "abcdef12-0000-4000-9000-000000000000",
      "ns",
      "images",
      expect.objectContaining({
        useStockImagesOverride: false,
      }),
    );
  });

  it("re-voices the latest reel when only a voice id is provided", async () => {
    state.recentReels = [
      { id: "latest12-0000-4000-9000-000000000000", status: "published", headline: "Latest reel" },
      { id: "abcdef12-0000-4000-9000-000000000000", status: "awaiting_approval", headline: "Older reel" },
    ];

    await handleCommand("ns", "chat-1", "!reel re-voice JBFqnCBsd6RMkjVDRZzb", { sendMessage: state.sendSpy });

    expect(state.rebuildPart).toHaveBeenCalledWith(
      "latest12-0000-4000-9000-000000000000",
      "ns",
      "voice",
      expect.objectContaining({
        voiceIdOverride: "JBFqnCBsd6RMkjVDRZzb",
      }),
    );
  });

  it.each([
    ["!reel re-images", "images", {}],
    ["!reel re-music breaking-news-2.mp3", "music", { musicTrackSelector: "breaking-news-2.mp3" }],
    ["!reel re-effect zoom_in", "video", { cameraEffectOverride: "zoom_in" }],
    ["!reel re-effect cinematic_drift", "video", { cameraPresetOverride: "cinematic_drift" }],
  ] as const)("targets the latest reel for %s", async (command, part, expectedOptions) => {
    state.recentReels = [
      { id: "latest12-0000-4000-9000-000000000000", status: "published", headline: "Latest reel" },
      { id: "abcdef12-0000-4000-9000-000000000000", status: "awaiting_approval", headline: "Older reel" },
    ];

    await handleCommand("ns", "chat-1", command, { sendMessage: state.sendSpy });

    expect(state.rebuildPart).toHaveBeenCalledWith(
      "latest12-0000-4000-9000-000000000000",
      "ns",
      part,
      expect.objectContaining(expectedOptions),
    );
  });

  it("parses -preset cinematic_drift flag", async () => {
    const { parseReelCommandFlags } = await import("../src/pipeline/command-listener.js");
    const flags = parseReelCommandFlags("breaking -preset cinematic_drift");
    expect(flags.cameraPreset).toBe("cinematic_drift");
    expect(flags.cleaned).toBe("breaking");
  });

  it("ignores unknown -preset values", async () => {
    const { parseReelCommandFlags } = await import("../src/pipeline/command-listener.js");
    const flags = parseReelCommandFlags("breaking -preset unknown_preset");
    expect(flags.cameraPreset).toBeUndefined();
  });
});
