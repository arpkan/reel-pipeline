import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseStoryCommand } from "../src/pipeline/story-intake.js";

function createHandler(deps: {
  isStoryRunning: (chatId: string) => boolean;
  getRecentGeneratingStoryCount: (chatId: string, withinMinutes: number) => number;
  getStoryIntakeSession: (chatId: string) => { clips: { path: string }[]; totalSizeMb: number; totalDurationSec: number } | null;
  getStoryProfileByChatId: (chatId: string) => Record<string, unknown> | null;
  getLatestStoryRunForChat: (chatId: string) => Record<string, unknown> | null;
  getCompletedStoryRunCountForProfile: (profileId: string) => number;
  clearStoryIntakeSession: (chatId: string) => void;
  removeIntakeFiles: (chatId: string) => void;
  storyRunnerRun: (chatId: string, options: Record<string, unknown>) => Promise<unknown>;
  storyRunnerRebuild: (storyId: string, fromStage: number) => Promise<unknown>;
  storyRunnerResume: (storyId: string) => Promise<unknown>;
  storyRunnerTweak: (chatId: string, note: string) => Promise<unknown>;
  sendMessage: (chatId: string, text: string) => void;
}) {
  return async function handleStoryCommand(chatId: string, text: string): Promise<void> {
    const cmd = parseStoryCommand(text);

    if (cmd.type === "run") {
      if (deps.isStoryRunning(chatId)) {
        deps.sendMessage(chatId, "A story is already running. Use !cancel to stop it first.");
        return;
      }
      if (deps.getRecentGeneratingStoryCount(chatId, 5) > 0) {
        deps.sendMessage(chatId, "A story is already being generated for this channel. Wait for it to finish or check its status.");
        return;
      }
      const session = deps.getStoryIntakeSession(chatId);
      if (!session || session.clips.length === 0) {
        deps.sendMessage(chatId, "No clips in buffer. Send clips before using !run.");
        return;
      }
      const profile = deps.getStoryProfileByChatId(chatId);
      if (!profile) {
        deps.sendMessage(chatId, "Welcome! This channel has no profile yet. Run !setup to configure it before sending clips.");
        return;
      }
      await deps.storyRunnerRun(chatId, { profile, note: cmd.note });
      return;
    }

    if (cmd.type === "cancel") {
      deps.clearStoryIntakeSession(chatId);
      deps.removeIntakeFiles(chatId);
      deps.sendMessage(chatId, "Intake cleared. Send clips to start a new story.");
      return;
    }

    if (cmd.type === "tweak") {
      const prev = deps.getLatestStoryRunForChat(chatId);
      if (!prev) {
        deps.sendMessage(chatId, "No previous story found for this channel. Send clips and use !run to start one.");
        return;
      }
      await deps.storyRunnerTweak(chatId, cmd.note ?? "");
      return;
    }

    if (cmd.type === "story") {
      const session = deps.getStoryIntakeSession(chatId);
      if (!session || session.clips.length === 0) {
        deps.sendMessage(chatId, "No clips in buffer. Send clips first.");
        return;
      }
      const count = session.clips.length;
      deps.sendMessage(chatId, `${count}/5 clips (${session.totalSizeMb}MB, ${session.totalDurationSec}s). Send more or !run to start.`);
      return;
    }

    if (cmd.type === "profile") {
      const profile = deps.getStoryProfileByChatId(chatId);
      if (!profile) {
        deps.sendMessage(chatId, "No profile set. Run !setup to create one.");
        return;
      }
      const runCount = deps.getCompletedStoryRunCountForProfile(profile.id as string);
      deps.sendMessage(chatId, `Profile: ${profile.profileName}\nLanguage: ${profile.audienceLanguage}\nAudience: ${profile.audienceDescription}\nPreferred voice: ${profile.preferredVoiceProvider ?? "auto"}/${profile.preferredVoiceId ?? "auto"}\nRuns completed: ${runCount}`);
      return;
    }

    if (cmd.type === "music") {
      const profile = deps.getStoryProfileByChatId(chatId);
      if (!profile) {
        deps.sendMessage(chatId, "No profile set. Run !setup to create one.");
        return;
      }
      const validGenres = ["upbeat", "calm", "neutral", "playful", "dramatic", "inspirational"];
      if (!validGenres.includes(cmd.genre.toLowerCase())) {
        deps.sendMessage(chatId, `Valid genres: ${validGenres.join(", ")}`);
        return;
      }
      deps.sendMessage(chatId, `Music set to ${cmd.genre}. Will apply on next !run.`);
      return;
    }

    if (cmd.type === "rebuild") {
      await deps.storyRunnerRebuild(cmd.id, cmd.stage);
      return;
    }

    if (cmd.type === "resume") {
      await deps.storyRunnerResume(cmd.id);
      return;
    }

    if (cmd.type === "video-upload") {
      const profile = deps.getStoryProfileByChatId(chatId);
      if (!profile) {
        deps.sendMessage(chatId, "Welcome! This channel has no profile yet. Run !setup to configure it before sending clips.");
        return;
      }
      return;
    }
  };
}

describe("StoryReel command routing", () => {
  const sendMessage = vi.fn();
  const clearStoryIntakeSession = vi.fn();
  const removeIntakeFiles = vi.fn();
  const storyRunnerRun = vi.fn().mockResolvedValue({ storyId: "test-id" });
  const storyRunnerRebuild = vi.fn().mockResolvedValue({});
  const storyRunnerResume = vi.fn().mockResolvedValue({});
  const storyRunnerTweak = vi.fn().mockResolvedValue({});

  let isStoryRunning: ReturnType<typeof vi.fn>;
  let getRecentGeneratingStoryCount: ReturnType<typeof vi.fn>;
  let getStoryIntakeSession: ReturnType<typeof vi.fn>;
  let getStoryProfileByChatId: ReturnType<typeof vi.fn>;
  let getLatestStoryRunForChat: ReturnType<typeof vi.fn>;
  let getCompletedStoryRunCountForProfile: ReturnType<typeof vi.fn>;

  let handler: ReturnType<typeof createHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    isStoryRunning = vi.fn().mockReturnValue(false);
    getRecentGeneratingStoryCount = vi.fn().mockReturnValue(0);
    getStoryIntakeSession = vi.fn().mockReturnValue(null);
    getStoryProfileByChatId = vi.fn().mockReturnValue({
      id: "prof-1",
      profileName: "Dog Walking",
      audienceLanguage: "german",
      audienceDescription: "Dog owners in Berlin",
      preferredVoiceId: "voice-1",
      preferredVoiceProvider: "elevenlabs",
    });
    getLatestStoryRunForChat = vi.fn().mockReturnValue(null);
    getCompletedStoryRunCountForProfile = vi.fn().mockReturnValue(3);

    handler = createHandler({
      isStoryRunning,
      getRecentGeneratingStoryCount,
      getStoryIntakeSession,
      getStoryProfileByChatId,
      getLatestStoryRunForChat,
      getCompletedStoryRunCountForProfile,
      clearStoryIntakeSession,
      removeIntakeFiles,
      storyRunnerRun,
      storyRunnerRebuild,
      storyRunnerResume,
      storyRunnerTweak,
      sendMessage,
    });
  });

  it("!run blocked when a story is active (in-memory guard)", async () => {
    isStoryRunning.mockReturnValue(true);
    getStoryIntakeSession.mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 });
    await handler("chat-1", "!run");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "A story is already running. Use !cancel to stop it first.");
    expect(storyRunnerRun).not.toHaveBeenCalled();
  });

  it("!run blocked by the DB recent-generating guard", async () => {
    getRecentGeneratingStoryCount.mockReturnValue(1);
    getStoryIntakeSession.mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 });
    await handler("chat-1", "!run");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "A story is already being generated for this channel. Wait for it to finish or check its status.");
    expect(storyRunnerRun).not.toHaveBeenCalled();
  });

  it("!run blocked when intake session is empty", async () => {
    getStoryIntakeSession.mockReturnValue(null);
    await handler("chat-1", "!run");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "No clips in buffer. Send clips before using !run.");
    expect(storyRunnerRun).not.toHaveBeenCalled();
  });

  it("!run blocked when intake session has zero clips", async () => {
    getStoryIntakeSession.mockReturnValue({ clips: [], totalSizeMb: 0, totalDurationSec: 0 });
    await handler("chat-1", "!run");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "No clips in buffer. Send clips before using !run.");
    expect(storyRunnerRun).not.toHaveBeenCalled();
  });

  it("!run succeeds with clips and profile", async () => {
    getStoryIntakeSession.mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 });
    await handler("chat-1", "!run");
    expect(storyRunnerRun).toHaveBeenCalledWith("chat-1", expect.objectContaining({ note: undefined }));
  });

  it("!run passes note to runner", async () => {
    getStoryIntakeSession.mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 });
    await handler("chat-1", "!run make it punchy");
    expect(storyRunnerRun).toHaveBeenCalledWith("chat-1", expect.objectContaining({ note: "make it punchy" }));
  });

  it("!cancel clears session and removes files", async () => {
    await handler("chat-1", "!cancel");
    expect(clearStoryIntakeSession).toHaveBeenCalledWith("chat-1");
    expect(removeIntakeFiles).toHaveBeenCalledWith("chat-1");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "Intake cleared. Send clips to start a new story.");
  });

  it("!tweak no-previous-run error", async () => {
    getLatestStoryRunForChat.mockReturnValue(null);
    await handler("chat-1", "!tweak make it better");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "No previous story found for this channel. Send clips and use !run to start one.");
    expect(storyRunnerTweak).not.toHaveBeenCalled();
  });

  it("!tweak succeeds with previous run", async () => {
    getLatestStoryRunForChat.mockReturnValue({ id: "prev-1" });
    await handler("chat-1", "!tweak make it better");
    expect(storyRunnerTweak).toHaveBeenCalledWith("chat-1", "make it better");
  });

  it("!story shows buffer with clip count, total size, duration", async () => {
    getStoryIntakeSession.mockReturnValue({
      clips: [{ path: "/tmp/a.mp4" }, { path: "/tmp/b.mp4" }],
      totalSizeMb: 46,
      totalDurationSec: 184,
    });
    await handler("chat-1", "!story");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("2/5 clips"));
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("46MB"));
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("184s"));
  });

  it("!profile shows profile details and run count", async () => {
    await handler("chat-1", "!profile");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Profile: Dog Walking"));
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Language: german"));
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Preferred voice: elevenlabs/voice-1"));
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Runs completed: 3"));
  });

  it("!music sets genre for next run", async () => {
    await handler("chat-1", "!music calm");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("calm"));
  });

  it("!music rejects invalid genre", async () => {
    await handler("chat-1", "!music ambient");
    expect(sendMessage).toHaveBeenCalledWith("chat-1", "Valid genres: upbeat, calm, neutral, playful, dramatic, inspirational");
  });

  it("!run without profile sends welcome message", async () => {
    vi.clearAllMocks();
    getStoryProfileByChatId.mockReturnValue(null);
    getStoryIntakeSession.mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 });
    const noProfileHandler = createHandler({
      isStoryRunning: vi.fn().mockReturnValue(false),
      getRecentGeneratingStoryCount: vi.fn().mockReturnValue(0),
      getStoryIntakeSession: vi.fn().mockReturnValue({ clips: [{ path: "/tmp/a.mp4" }], totalSizeMb: 10, totalDurationSec: 30 }),
      getStoryProfileByChatId: vi.fn().mockReturnValue(null),
      getLatestStoryRunForChat,
      getCompletedStoryRunCountForProfile,
      clearStoryIntakeSession,
      removeIntakeFiles,
      storyRunnerRun,
      storyRunnerRebuild,
      storyRunnerResume,
      storyRunnerTweak,
      sendMessage,
    });
    await noProfileHandler("chat-2", "!run");
    expect(sendMessage).toHaveBeenCalledWith("chat-2", "Welcome! This channel has no profile yet. Run !setup to configure it before sending clips.");
  });

  it("!story resume delegates to runner", async () => {
    await handler("chat-1", "!story resume abc123");
    expect(storyRunnerResume).toHaveBeenCalledWith("abc123");
  });

  it("!story rebuild delegates to runner", async () => {
    await handler("chat-1", "!story rebuild abc123 3");
    expect(storyRunnerRebuild).toHaveBeenCalledWith("abc123", 3);
  });
});
