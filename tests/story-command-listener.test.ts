import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  sendSpy: vi.fn(async () => {}),
  downloadVideoFile: vi.fn(async () => {}),
  upsertStoryProfile: vi.fn(),
  upsertStorySetupRequest: vi.fn(),
  deleteStorySetupRequest: vi.fn(),
  markStorySetupRequestRejected: vi.fn(),
  profile: null as null | Record<string, unknown>,
  setupRequests: [] as Array<Record<string, unknown>>,
  intakeSession: null as null | {
    clips: Array<Record<string, unknown>>;
    totalSizeMb: number;
    totalDurationSec: number;
    pendingMusicOverride?: string | null;
    expiresAt: string;
  },
  storyRun: vi.fn(),
  storyTweak: vi.fn(),
  storyResume: vi.fn(),
  storyRebuild: vi.fn(),
  removeStoryIntakeFiles: vi.fn(),
  removeStoryIntakeFile: vi.fn(),
  probedMetadata: {
    path: "/work/stories/intake/chat-1/clip-1.mp4",
    sizeMb: 12,
    durationSec: 45,
    orientation: "vertical",
    width: 1080,
    height: 1920,
  } as Record<string, unknown>,
  isStoryRunning: false,
  recentGeneratingCount: 0,
  latestStoryRun: null as null | Record<string, unknown>,
  sendMessageWithButtons: vi.fn(async () => ({ messageId: 100 })),
  answerCallbackQuery: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
  editMessageWithButtons: vi.fn(async () => {}),
}));

vi.mock("../src/config.js", () => ({
  isStoryReelEnabled: vi.fn(() => state.enabled),
  getStoryReelBotToken: vi.fn(() => undefined),
  getStoryReelAdminChatId: vi.fn(() => "900000001"),
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn(() => ({
    id: "ds",
    name: "Daily Stories",
    language: "en",
    timezone: "Asia/Bangkok",
    themeWeights: { Lifestyle: 1 },
    channels: { telegram: { enabled: true, chatIdEnvVar: "TELEGRAM_DS_CHAT_ID" } },
    reels: { enabled: true, scheduleEnabled: true, reelTimes: ["09:00"] },
  })),
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
  getStoryProfileByChatId: vi.fn(() => state.profile),
  upsertStoryProfile: state.upsertStoryProfile,
  upsertStorySetupRequest: state.upsertStorySetupRequest,
  deleteStorySetupRequest: state.deleteStorySetupRequest,
  markStorySetupRequestRejected: state.markStorySetupRequestRejected,
  getStorySetupRequestByChatId: vi.fn((chatId: string) => state.setupRequests.find((r) => r.chatId === chatId) ?? null),
  getPendingStorySetupRequests: vi.fn(() => state.setupRequests.filter((r) => r.status === "pending")),
  resolveLatestPendingStorySetupRequest: vi.fn(() => state.setupRequests.filter((r) => r.status === "pending").at(-1) ?? null),
  getCompletedStoryRunCountForProfile: vi.fn(() => 0),
  getStoryIntakeSession: vi.fn(() => state.intakeSession),
  upsertStoryIntakeSession: vi.fn((session) => {
    state.intakeSession = session;
  }),
  clearStoryIntakeSession: vi.fn(() => {
    state.intakeSession = null;
  }),
  getRecentGeneratingStoryCount: vi.fn(() => state.recentGeneratingCount),
  getLatestStoryRunForChat: vi.fn(() => state.latestStoryRun),
}));

vi.mock("../src/pipeline/runner.js", () => ({
  PipelineRunner: { run: vi.fn(), reconstructContext: vi.fn() },
  requestCancelRun: vi.fn(),
  resolveScheduledDatetime: vi.fn(),
}));

vi.mock("../src/pipeline/reel-runner.js", () => ({
  ReelRunner: {
    run: vi.fn(),
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
  acquireAssemblyLock: vi.fn(),
  releaseAssemblyLock: vi.fn(),
}));

vi.mock("../src/pipeline/reel-intake-session-store.js", () => ({
  getReelIntakeSession: vi.fn(() => null),
  clearReelIntakeSession: vi.fn(),
  setReelIntakeSession: vi.fn(),
}));

vi.mock("../src/pipeline/story-runner.js", () => ({
  isStoryRunning: vi.fn(() => state.isStoryRunning),
  requestCancelStory: vi.fn(),
  removeIntakeFiles: vi.fn(),
}));

vi.mock("../src/pipeline/story-runtime.js", () => ({
  createProductionStoryRunner: vi.fn(() => ({
    run: state.storyRun,
    tweak: state.storyTweak,
    resume: state.storyResume,
    rebuild: state.storyRebuild,
  })),
  storyIntakeFilePath: vi.fn((_chatId: string, index: number) => `/work/stories/intake/chat-1/clip-${index + 1}.mp4`),
  probeStoryClipMetadata: vi.fn(() => state.probedMetadata),
  removeStoryIntakeFiles: state.removeStoryIntakeFiles,
  removeStoryIntakeFile: state.removeStoryIntakeFile,
}));

let handleCommand: typeof import("../src/pipeline/command-listener.js")["handleCommand"];
let handleStoryReelCallback: typeof import("../src/pipeline/command-listener.js")["handleStoryReelCallback"];

beforeAll(async () => {
  ({ handleCommand, handleStoryReelCallback } = await import("../src/pipeline/command-listener.js"));
});

describe("StoryReel command listener wiring", () => {
  beforeEach(async () => {
    // Clear all wizard conversation state between tests to prevent cross-test contamination
    const { clearConversationState } = await import("../src/pipeline/story-conversation-state.js");
    for (const chatId of ["chat-1", "chat-2", "chat-3", "chat-new", "chat-setup", "900000001"]) {
      clearConversationState(chatId);
    }
    state.enabled = true;
    state.profile = {
      id: "profile-1",
      profileName: "Dog Walks",
      audienceLanguage: "german",
      audienceDescription: "German dog owners who want practical daily walking advice.",
      preferredVoiceId: null,
      preferredVoiceProvider: null,
    };
    state.intakeSession = null;
    state.isStoryRunning = false;
    state.recentGeneratingCount = 0;
    state.latestStoryRun = null;
    state.setupRequests = [];
    state.probedMetadata = {
      path: "/work/stories/intake/chat-1/clip-1.mp4",
      sizeMb: 12,
      durationSec: 45,
      orientation: "vertical",
      width: 1080,
      height: 1920,
    };
    for (const spy of [state.sendSpy, state.downloadVideoFile, state.upsertStoryProfile, state.upsertStorySetupRequest, state.deleteStorySetupRequest, state.markStorySetupRequestRejected, state.storyRun, state.storyTweak, state.storyResume, state.storyRebuild, state.removeStoryIntakeFiles, state.removeStoryIntakeFile, state.answerCallbackQuery, state.deleteMessage, state.editMessageWithButtons]) {
      spy.mockClear();
      spy.mockResolvedValue(undefined);
    }
    state.sendMessageWithButtons.mockClear();
    state.sendMessageWithButtons.mockResolvedValue({ messageId: 100 });
    state.upsertStoryProfile.mockImplementation((params) => ({ id: "profile-1", ...params }));
    state.upsertStorySetupRequest.mockImplementation((params) => {
      const row = { ...params, status: "pending" };
      state.setupRequests = [...state.setupRequests.filter((r) => r.chatId !== params.chatId), row];
      return row;
    });
    state.deleteStorySetupRequest.mockImplementation((chatId) => {
      state.setupRequests = state.setupRequests.filter((r) => r.chatId !== chatId);
    });
    state.markStorySetupRequestRejected.mockImplementation((chatId) => {
      state.setupRequests = state.setupRequests.map((r) => r.chatId === chatId ? { ...r, status: "rejected" } : r);
    });
  });

  it("starts setup wizard when !setup is sent (even with args)", async () => {
    await handleCommand("ds", "chat-1", "!setup DogWalks german German dog owners who want practical daily walking advice.", {
      sendMessage: state.sendSpy,
      sendMessageWithButtons: state.sendMessageWithButtons,
      answerCallbackQuery: state.answerCallbackQuery,
      deleteMessage: state.deleteMessage,
      editMessageWithButtons: state.editMessageWithButtons,
    });

    // The wizard starts (language buttons shown), profile not created yet
    expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
      "chat-1",
      expect.any(String),
      expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: "setup:lang:english" })]),
      ]),
    );
    expect(state.upsertStoryProfile).not.toHaveBeenCalled();
  });

  it("downloads a Telegram video and stores it in the StoryReel intake buffer", async () => {
    await handleCommand("ds", "chat-1", {
      updateId: 1,
      messageId: 10,
      text: "",
      date: 1,
      video: { fileId: "video-file-1", fileName: "clip.mp4", mimeType: "video/mp4" },
    }, { sendMessage: state.sendSpy, downloadVideoFile: state.downloadVideoFile });

    expect(state.downloadVideoFile).toHaveBeenCalledWith("video-file-1", "/work/stories/intake/chat-1/clip-1.mp4");
    expect(state.intakeSession?.clips).toEqual([expect.objectContaining({ path: "/work/stories/intake/chat-1/clip-1.mp4" })]);
    expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("Clip 1/5"));
  });

  it("removes only the rejected downloaded file when video validation fails", async () => {
    state.intakeSession = {
      clips: [{ path: "/work/stories/intake/chat-1/clip-1.mp4", sizeMb: 12, durationSec: 45 }],
      totalSizeMb: 12,
      totalDurationSec: 45,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    state.probedMetadata = {
      path: "/work/stories/intake/chat-1/clip-2.mp4",
      sizeMb: 72,
      durationSec: 45,
      orientation: "vertical",
      width: 1080,
      height: 1920,
    };

    await handleCommand("ds", "chat-1", {
      updateId: 1,
      messageId: 10,
      text: "",
      date: 1,
      video: { fileId: "video-file-1", fileName: "clip.mp4", mimeType: "video/mp4" },
    }, { sendMessage: state.sendSpy, downloadVideoFile: state.downloadVideoFile });

    expect(state.removeStoryIntakeFile).toHaveBeenCalledWith("/work/stories/intake/chat-1/clip-2.mp4");
    expect(state.removeStoryIntakeFiles).not.toHaveBeenCalled();
    expect(state.intakeSession?.clips).toHaveLength(1);
    expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("72MB"));
  });

  it("stores a one-shot music override from !music", async () => {
    await handleCommand("ds", "chat-1", "!music calm", {
      sendMessage: state.sendSpy,
      sendMessageWithButtons: state.sendMessageWithButtons,
      answerCallbackQuery: state.answerCallbackQuery,
      deleteMessage: state.deleteMessage,
      editMessageWithButtons: state.editMessageWithButtons,
    });

    expect(state.intakeSession?.pendingMusicOverride).toBe("calm");
    expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("calm"));
  });

  it("starts the StoryReel runner from !run with buffered clips and note", async () => {
    state.intakeSession = {
      clips: [{ path: "/work/stories/intake/chat-1/clip-1.mp4" }],
      totalSizeMb: 12,
      totalDurationSec: 45,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const sender = {
      sendMessage: state.sendSpy,
      sendMessageWithButtons: state.sendMessageWithButtons,
      answerCallbackQuery: state.answerCallbackQuery,
      deleteMessage: state.deleteMessage,
      editMessageWithButtons: state.editMessageWithButtons,
    };

    await handleCommand("ds", "chat-1", "!run make it punchy", sender);
    await handleStoryReelCallback("chat-1", "cbq-run-opts", "run-opt:start", sender);
    await handleStoryReelCallback("chat-1", "cbq-skip-note", "run-opt:skip-note", sender);

    expect(state.storyRun).toHaveBeenCalledWith("chat-1", expect.objectContaining({
      profile: state.profile,
      note: "make it punchy",
    }));
  });

  it("ignores StoryReel commands when STORYREEL_ENABLED is false", async () => {
    state.enabled = false;

    await handleCommand("ds", "chat-1", "!setup DogWalks german German dog owners who want practical daily walking advice.", { sendMessage: state.sendSpy });

    expect(state.upsertStoryProfile).not.toHaveBeenCalled();
  });

  it("stores a setup request via wizard confirm callback for a new chat", async () => {
    state.profile = null;
    const { setConversationState } = await import("../src/pipeline/story-conversation-state.js");
    setConversationState("chat-2", {
      wizard: "setup",
      step: 4,
      data: {
        language: "english",
        profileName: "DogWalks",
        audienceDescription: "English dog owners who want practical walking videos.",
        chatTitle: "Dog Walkers Berlin",
        chatType: "supergroup",
        chatUsername: "dogwalkersberlin",
      },
    });

    await handleStoryReelCallback("chat-2", "cbq-confirm", "setup:confirm", {
      sendMessage: state.sendSpy,
      sendMessageWithButtons: state.sendMessageWithButtons,
      answerCallbackQuery: state.answerCallbackQuery,
      deleteMessage: state.deleteMessage,
      editMessageWithButtons: state.editMessageWithButtons,
    });

    expect(state.upsertStoryProfile).not.toHaveBeenCalled();
    expect(state.upsertStorySetupRequest).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat-2",
      chatTitle: "Dog Walkers Berlin",
      profileName: "DogWalks",
      audienceLanguage: "english",
    }));
    expect(state.sendSpy).toHaveBeenCalledWith("900000001", expect.stringContaining("Group: Dog Walkers Berlin"));
    expect(state.sendSpy).toHaveBeenCalledWith("900000001", expect.stringContaining("!admin approve chat-2"));
    expect(state.sendSpy).toHaveBeenCalledWith("chat-2", "StoryReel setup request sent for admin approval.");
  });

  it("approves the latest pending setup request without an explicit chat id", async () => {
    state.setupRequests = [{
      chatId: "chat-2",
      chatTitle: "Dog Walkers Berlin",
      chatType: "supergroup",
      chatUsername: "dogwalkersberlin",
      profileName: "DogWalks",
      audienceLanguage: "english",
      audienceDescription: "English dog owners who want practical walking videos.",
      status: "pending",
    }];

    await handleCommand("ds", "900000001", "!admin approve", { sendMessage: state.sendSpy });

    expect(state.upsertStoryProfile).toHaveBeenCalledWith({
      telegramChatId: "chat-2",
      profileName: "DogWalks",
      audienceLanguage: "english",
      audienceDescription: "English dog owners who want practical walking videos.",
    });
    expect(state.deleteStorySetupRequest).toHaveBeenCalledWith("chat-2");
    expect(state.sendSpy).toHaveBeenCalledWith("chat-2", expect.stringContaining("Profile created"));
  });

  it("requires an explicit chat id when multiple setup requests are pending", async () => {
    state.setupRequests = [
      { chatId: "chat-2", chatTitle: "Dog Walkers Berlin", profileName: "DogWalks", audienceLanguage: "english", audienceDescription: "Audience one", status: "pending" },
      { chatId: "chat-3", chatTitle: "Travel Makers", profileName: "Travel", audienceLanguage: "english", audienceDescription: "Audience two", status: "pending" },
    ];

    await handleCommand("ds", "900000001", "!admin approve", { sendMessage: state.sendSpy });

    expect(state.upsertStoryProfile).not.toHaveBeenCalled();
    expect(state.sendSpy).toHaveBeenCalledWith("900000001", "Multiple pending requests. Use !admin pending and approve with !admin approve <chatId>.");
  });

  it("approves an explicit pending setup request", async () => {
    state.setupRequests = [
      { chatId: "chat-2", chatTitle: "Dog Walkers Berlin", profileName: "DogWalks", audienceLanguage: "english", audienceDescription: "Audience one", status: "pending" },
      { chatId: "chat-3", chatTitle: "Travel Makers", profileName: "Travel", audienceLanguage: "english", audienceDescription: "Audience two", status: "pending" },
    ];

    await handleCommand("ds", "900000001", "!admin approve chat-3", { sendMessage: state.sendSpy });

    expect(state.upsertStoryProfile).toHaveBeenCalledWith(expect.objectContaining({ telegramChatId: "chat-3", profileName: "Travel" }));
    expect(state.deleteStorySetupRequest).toHaveBeenCalledWith("chat-3");
  });

  it("rejects the latest pending setup request without an explicit chat id", async () => {
    state.setupRequests = [{ chatId: "chat-2", chatTitle: "Dog Walkers Berlin", profileName: "DogWalks", audienceLanguage: "english", audienceDescription: "Audience", status: "pending" }];

    await handleCommand("ds", "900000001", "!admin reject", { sendMessage: state.sendSpy });

    expect(state.markStorySetupRequestRejected).toHaveBeenCalledWith("chat-2");
    expect(state.sendSpy).toHaveBeenCalledWith("chat-2", expect.stringContaining("rejected"));
  });

  it("lists pending setup requests for the admin", async () => {
    state.setupRequests = [{ chatId: "chat-2", chatTitle: "Dog Walkers Berlin", profileName: "DogWalks", audienceLanguage: "english", audienceDescription: "Audience", status: "pending" }];

    await handleCommand("ds", "900000001", "!admin pending", { sendMessage: state.sendSpy });

    expect(state.sendSpy).toHaveBeenCalledWith("900000001", expect.stringContaining("Dog Walkers Berlin"));
    expect(state.sendSpy).toHaveBeenCalledWith("900000001", expect.stringContaining("!admin approve chat-2"));
  });

  it("rejects admin commands from non-admin chats", async () => {
    await handleCommand("ds", "chat-2", "!admin pending", { sendMessage: state.sendSpy });

    expect(state.sendSpy).toHaveBeenCalledWith("chat-2", expect.stringContaining("admin"));
  });

  it("blocks uploads before approval", async () => {
    state.profile = null;

    await handleCommand("ds", "chat-2", {
      updateId: 1,
      messageId: 10,
      text: "",
      date: 1,
      video: { fileId: "video-file-1", fileName: "clip.mp4", mimeType: "video/mp4" },
    }, { sendMessage: state.sendSpy, downloadVideoFile: state.downloadVideoFile });

    expect(state.downloadVideoFile).not.toHaveBeenCalled();
    expect(state.sendSpy).toHaveBeenCalledWith("chat-2", "StoryReel is not approved for this chat yet. Run !setup to request access.");
  });

  describe("!setup wizard", () => {
    beforeEach(() => {
      state.profile = null;
      state.setupRequests = [];
    });

    it("step 1: sends language buttons when !setup is sent", async () => {
      await handleCommand("ds", "chat-new", "!setup", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-new",
        expect.any(String),
        expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: "setup:lang:english" })]),
        ]),
      );
    });

    it("step 2: asks for profile name after language callback", async () => {
      // First trigger step 1 to set wizard state
      await handleCommand("ds", "chat-new", "!setup", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      // Now simulate language button tap
      await handleStoryReelCallback("chat-new", "cbq-1", "setup:lang:english", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.answerCallbackQuery).toHaveBeenCalledWith("cbq-1");
      expect(state.sendSpy).toHaveBeenCalledWith("chat-new", expect.stringContaining("profile name"));
    });

    it("step 4: sends confirmation card with confirm/start-over buttons", async () => {
      // Simulate state already at step 3 (awaiting audience)
      const { setConversationState } = await import("../src/pipeline/story-conversation-state.js");
      setConversationState("chat-new", { wizard: "setup", step: 3, data: { language: "english", profileName: "DogWalks" } });

      // User types audience description
      await handleCommand("ds", "chat-new", "Dog owners in Germany", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-new",
        expect.stringContaining("DogWalks"),
        expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: "setup:confirm" })]),
        ]),
      );
    });

    it("confirms setup and creates profile", async () => {
      const { setConversationState } = await import("../src/pipeline/story-conversation-state.js");
      setConversationState("chat-new", {
        wizard: "setup",
        step: 4,
        data: { language: "english", profileName: "DogWalks", audienceDescription: "Dog owners" },
      });
      // For existing profile (re-setup), set state.profile
      state.profile = { id: "profile-1", profileName: "Old", audienceLanguage: "english", audienceDescription: "old desc" };

      await handleStoryReelCallback("chat-new", "cbq-2", "setup:confirm", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.upsertStoryProfile).toHaveBeenCalledWith(expect.objectContaining({
        profileName: "DogWalks",
        audienceLanguage: "english",
        audienceDescription: "Dog owners",
      }));
      expect(state.sendSpy).toHaveBeenCalledWith("chat-new", expect.stringContaining("Profile created"));
    });

    it("shows mid-wizard message when another command is sent during setup", async () => {
      const { setConversationState } = await import("../src/pipeline/story-conversation-state.js");
      setConversationState("chat-setup", { wizard: "setup", step: 2, data: { language: "english" } });

      await handleCommand("ds", "chat-setup", "!run", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendSpy).toHaveBeenCalledWith("chat-setup", expect.stringContaining("middle of a conversation"));
      expect(state.storyRun).not.toHaveBeenCalled();
    });
  });

  describe("!music wizard", () => {
    it("sends genre buttons when !music is sent with no argument", async () => {
      await handleCommand("ds", "chat-1", "!music", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-1",
        expect.any(String),
        expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: "music:upbeat" })]),
        ]),
      );
    });

    it("music callback stores the override", async () => {
      await handleStoryReelCallback("chat-1", "cbq-music", "music:calm", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.intakeSession?.pendingMusicOverride).toBe("calm");
      expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("calm"));
    });
  });

  describe("!story wizard", () => {
    it("sends clip buffer with run/cancel buttons", async () => {
      state.intakeSession = {
        clips: [{ path: "/clip-1.mp4" }, { path: "/clip-2.mp4" }],
        totalSizeMb: 20,
        totalDurationSec: 90,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };

      await handleCommand("ds", "chat-1", "!story", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-1",
        expect.stringContaining("2/5"),
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ callback_data: "story:run" }),
            expect.objectContaining({ callback_data: "story:cancel" }),
          ]),
        ]),
      );
    });
  });

  describe("!run wizard", () => {
    beforeEach(() => {
      state.intakeSession = {
        clips: [{ path: "/clip-1.mp4" }],
        totalSizeMb: 12,
        totalDurationSec: 45,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    });

    it("sends run options wizard with voice/music/captions toggles and start button", async () => {
      await handleCommand("ds", "chat-1", "!run", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-1",
        expect.any(String),
        [
          [
            expect.objectContaining({ callback_data: "run-opt:toggle:voice" }),
            expect.objectContaining({ callback_data: "run-opt:toggle:music" }),
            expect.objectContaining({ callback_data: "run-opt:toggle:captions" }),
          ],
          [expect.objectContaining({ callback_data: "run-opt:start" })],
        ],
      );
    });

    it("run:skip starts the runner immediately", async () => {
      await handleStoryReelCallback("chat-1", "cbq-3", "run:skip", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.storyRun).toHaveBeenCalledWith("chat-1", expect.objectContaining({ note: undefined }));
    });
  });

  describe("!tweak wizard", () => {
    beforeEach(() => {
      state.latestStoryRun = { id: "run-1", status: "completed" };
    });

    it("sends tweak note prompt with skip button", async () => {
      await handleCommand("ds", "chat-1", "!tweak", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-1",
        expect.any(String),
        [[expect.objectContaining({ callback_data: "tweak:skip" })]],
      );
    });
  });

  describe("!story rebuild", () => {
    it("uses the latest story run when rebuild id is omitted", async () => {
      state.latestStoryRun = { id: "run-1", status: "delivered" };

      await handleCommand("ds", "chat-1", "!story rebuild 3", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("run-1"));
      expect(state.storyRebuild).toHaveBeenCalledWith("run-1", 3);
    });
  });

  describe("!help", () => {
    it("sends help text in the profile language", async () => {
      // profile is german from beforeEach
      await handleCommand("ds", "chat-1", "!help", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendSpy).toHaveBeenCalledWith("chat-1", expect.stringContaining("StoryReel Befehle"));
    });

    it("sends english help when no profile exists", async () => {
      state.profile = null;
      await handleCommand("ds", "chat-no-profile", "!help", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendSpy).toHaveBeenCalledWith("chat-no-profile", expect.stringContaining("StoryReel Commands"));
    });
  });

  describe("stale button handling", () => {
    it("silently answers callback when no wizard state exists for run:confirm", async () => {
      // No wizard state set — simulates tapping an old button
      await handleStoryReelCallback("chat-1", "cbq-stale", "run:confirm", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.answerCallbackQuery).toHaveBeenCalledWith("cbq-stale");
      // Should not start a run or send any message
      expect(state.storyRun).not.toHaveBeenCalled();
      expect(state.sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("!cancel wizard", () => {
    it("sends confirmation buttons", async () => {
      await handleCommand("ds", "chat-1", "!cancel", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.sendMessageWithButtons).toHaveBeenCalledWith(
        "chat-1",
        expect.any(String),
        [[
          expect.objectContaining({ callback_data: "cancel:yes" }),
          expect.objectContaining({ callback_data: "cancel:no" }),
        ]],
      );
    });

    it("cancel:yes clears the intake session", async () => {
      state.intakeSession = { clips: [{ path: "/c.mp4" }], totalSizeMb: 5, totalDurationSec: 30, expiresAt: "2099-01-01T00:00:00.000Z" };

      await handleStoryReelCallback("chat-1", "cbq-cancel", "cancel:yes", {
        sendMessage: state.sendSpy,
        sendMessageWithButtons: state.sendMessageWithButtons,
        answerCallbackQuery: state.answerCallbackQuery,
        deleteMessage: state.deleteMessage,
        editMessageWithButtons: state.editMessageWithButtons,
      });

      expect(state.intakeSession).toBeNull();
    });
  });
});
