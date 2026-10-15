import type { BrandId, ReelCategory, Theme, ImageSource, ReelScript, CategorySource, CameraEffectType, Stage5RendererType, Stage5TemplateName, HyperframesCameraPreset } from "../types.js";

const REEL_CATEGORIES: ReelCategory[] = ["breaking", "trending", "human_interest", "business", "open"];
const CAMERA_EFFECT_TYPES: CameraEffectType[] = ["zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down", "ken_burns", "none"];
const HYPERFRAMES_CAMERA_PRESETS: HyperframesCameraPreset[] = ["cinematic_drift", "urgent_push", "slow_reveal", "documentary_slide", "portrait_float", "locked_frame"];
import type { TelegramService, TelegramMessage, InlineKeyboardButton } from "../services/telegram.js";
import type { LineService } from "../services/line.js";
import { getBrand } from "../brands/index.js";
import { getLineEventsAfter, getLatestLineEventId } from "../db/queries.js";
import { isStoryReelEnabled, getStoryReelBotToken, getStoryReelAdminChatId } from "../config.js";
import { computeStoryIntakeExpiry, formatClipAcceptedMessage, formatClipLimitError, parseStoryCommand, validateMusicGenreInput, validateStoryProfileSetup } from "./story-intake.js";
import { createProductionStoryRunner, probeStoryClipMetadata, removeStoryIntakeFile, removeStoryIntakeFiles, storyIntakeFilePath } from "./story-runtime.js";
import { isStoryRunning, requestCancelStory } from "./story-runner.js";
import { clearConversationState, getConversationState, setConversationState } from "./story-conversation-state.js";
import { getMessages } from "./story-messages.js";
import type { StoryReelAudienceLanguage } from "../storyreel/types.js";
import { selectBotnoiVoice } from "../services/botnoi.js";
import { selectSharedVoice } from "../storyreel/audio-poc.js";

interface Sender {
  sendMessage(chatId: string, text: string): Promise<unknown>;
  sendMessageWithButtons?(chatId: string, text: string, buttons: InlineKeyboardButton[][]): Promise<{ messageId: number } | null>;
  editMessageWithButtons?(chatId: string, messageId: number, text: string, buttons: InlineKeyboardButton[][]): Promise<void>;
  answerCallbackQuery?(queryId: string, text?: string): Promise<void>;
  deleteMessage?(chatId: string, messageId: number): Promise<void>;
  downloadTextFile?(fileId: string): Promise<string>;
  downloadVideoFile?(fileId: string, destination: string): Promise<void>;
  sendPhoto?(chatId: string, buffer: Buffer, caption: string): Promise<unknown>;
}
import { getRecentReels, getReelById, getReelByShortId, updateReel } from "../db/queries.js";
import * as queries from "../db/queries.js";
import { ReelRunner, isReelRunning, setSkipNextReel, cancelSkipNextReel, isSkipNextReel, requestCancelReel } from "./reel-runner.js";
import { clearReelIntakeSession, getReelIntakeSession, setReelIntakeSession } from "./reel-intake-session-store.js";
import { getUiStrings, type UiLang } from "../i18n/ui-strings.js";
import { escapeHtml } from "../review/utils.js";

type ReelRebuildPart = "voice" | "images" | "music" | "video";

export interface ReelRebuildCommand {
  part: ReelRebuildPart;
  reelShortId?: string;
  useStockImagesOverride?: boolean;
  musicTrackSelector?: string;
  cameraEffectOverride?: CameraEffectType;
  cameraPresetOverride?: HyperframesCameraPreset;
  voiceSpeedOverride?: number;
  voiceIdOverride?: string;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
}

export interface ReelCommandFlags {
  cleaned: string;
  useStockImages?: boolean;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  cameraPreset?: HyperframesCameraPreset;
}

export function parseReelCommandFlags(input: string): ReelCommandFlags {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const cleanedTokens: string[] = [];
  let useStockImages: boolean | undefined;
  let stage5Renderer: Stage5RendererType | undefined;
  let stage5Template: Stage5TemplateName | undefined;
  let cameraPreset: HyperframesCameraPreset | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (lower === "-stock") {
      useStockImages = true;
      continue;
    }
    if (lower === "-hf" || lower === "-hyperframes") {
      stage5Renderer = "hyperframes";
      continue;
    }
    if (lower === "-template") {
      const template = tokens[i + 1]?.toLowerCase();
      if (template === "enhanced-default") {
        stage5Template = "enhanced-default";
        i++;
        continue;
      }
      cleanedTokens.push(token);
      continue;
    }
    if (lower === "-preset") {
      const preset = tokens[i + 1]?.toLowerCase();
      if (preset && HYPERFRAMES_CAMERA_PRESETS.includes(preset as HyperframesCameraPreset)) {
        cameraPreset = preset as HyperframesCameraPreset;
        i++;
        continue;
      }
      cleanedTokens.push(token);
      continue;
    }
    cleanedTokens.push(token);
  }

  return {
    cleaned: cleanedTokens.join(" "),
    useStockImages,
    stage5Renderer,
    stage5Template,
    cameraPreset,
  };
}

function isLikelyReelShortId(token: string): boolean {
  return /^[a-f0-9]{6,}$/i.test(token);
}

export function parseReelRebuildCommand(subCmdRaw: string): ReelRebuildCommand {
  const rawTokens = subCmdRaw.trim().split(/\s+/).filter(Boolean);
  const lowerTokens = rawTokens.map((t) => t.toLowerCase());
  const cmd = lowerTokens[0];
  const hasStock = lowerTokens.includes("-stock");
  const hasNoStock = lowerTokens.includes("-nostock");
  // Preserve original casing for arguments (e.g., voice IDs)
  const args = rawTokens.slice(1).filter((_, i) => lowerTokens[i + 1] !== "-stock" && lowerTokens[i + 1] !== "-nostock");

  if (cmd !== "re-voice" && cmd !== "re-images" && cmd !== "re-music" && cmd !== "re-effect") {
    throw new Error(`Unsupported reel rebuild command: ${subCmdRaw}`);
  }

  if ((hasStock || hasNoStock) && cmd !== "re-images") {
    throw new Error(`${hasNoStock ? "-nostock" : "-stock"} is only supported with re-images`);
  }

  if (cmd === "re-effect") {
    if (args.length === 0) throw new Error("Usage: !reel re-effect [id] <effect|preset>");
    if (args.length === 1) {
      const val = args[0].toLowerCase();
      if (CAMERA_EFFECT_TYPES.includes(val as CameraEffectType)) return { part: "video", cameraEffectOverride: val as CameraEffectType };
      if (HYPERFRAMES_CAMERA_PRESETS.includes(val as HyperframesCameraPreset)) return { part: "video", cameraPresetOverride: val as HyperframesCameraPreset };
      throw new Error(`Unknown effect/preset "${args[0]}". Effects: ${CAMERA_EFFECT_TYPES.join(", ")}. Presets: ${HYPERFRAMES_CAMERA_PRESETS.join(", ")}`);
    }
    if (args.length === 2) {
      const val = args[1].toLowerCase();
      if (CAMERA_EFFECT_TYPES.includes(val as CameraEffectType)) return { part: "video", reelShortId: args[0], cameraEffectOverride: val as CameraEffectType };
      if (HYPERFRAMES_CAMERA_PRESETS.includes(val as HyperframesCameraPreset)) return { part: "video", reelShortId: args[0], cameraPresetOverride: val as HyperframesCameraPreset };
      throw new Error(`Unknown effect/preset "${args[1]}". Effects: ${CAMERA_EFFECT_TYPES.join(", ")}. Presets: ${HYPERFRAMES_CAMERA_PRESETS.join(", ")}`);
    }
    throw new Error("Usage: !reel re-effect [id] <effect|preset>");
  }

  if (cmd === "re-voice") {
    if (args.length > 3) throw new Error("Usage: !reel re-voice [id] [voice-id] [speed]");
    const result: ReelRebuildCommand = { part: "voice" };

    if (args.length >= 1) {
      const maybeSpeed = parseFloat(args[0]);
      if (isLikelyReelShortId(args[0])) {
        result.reelShortId = args[0];
      } else if (!isNaN(maybeSpeed) && maybeSpeed >= 0.5 && maybeSpeed <= 2.0) {
        result.voiceSpeedOverride = maybeSpeed;
      } else {
        result.voiceIdOverride = args[0];
      }
    }

    if (args.length >= 2) {
      // Try to parse as speed first; if not a valid number, treat as voice ID
      const maybeSpeed = parseFloat(args[1]);
      if (!isNaN(maybeSpeed) && maybeSpeed >= 0.5 && maybeSpeed <= 2.0) {
        result.voiceSpeedOverride = maybeSpeed;
      } else if (!isNaN(maybeSpeed)) {
        throw new Error(`Invalid speed "${args[1]}". Must be 0.5-2.0 (e.g. 1.0=normal, 1.2=20% faster)`);
      } else {
        // It's a voice ID — preserve original casing
        result.voiceIdOverride = args[1];
      }
    }

    if (args.length === 3) {
      const speed = parseFloat(args[2]);
      if (isNaN(speed) || speed < 0.5 || speed > 2.0) {
        throw new Error(`Invalid speed "${args[2]}". Must be 0.5-2.0`);
      }
      result.voiceSpeedOverride = speed;
    }

    return result;
  }

  if (cmd === "re-images") {
    if (args.length > 1) throw new Error("Usage: !reel re-images [id] [-stock]");
    return {
      part: "images",
      ...(args[0] ? { reelShortId: args[0] } : {}),
      useStockImagesOverride: hasNoStock ? false : hasStock ? true : undefined,
    };
  }

  if (args.length > 2) throw new Error("Usage: !reel re-music [id] [track]");
  if (args.length === 2) {
    return {
      part: "music",
      reelShortId: args[0],
      musicTrackSelector: args[1],
    };
  }
  if (args.length === 1) {
    if (isLikelyReelShortId(args[0])) {
      return { part: "music", reelShortId: args[0] };
    }
    return { part: "music", musicTrackSelector: args[0] };
  }

  return { part: "music" };
}

function getInboundVideo(inbound: TelegramMessage): { fileId: string; fileName?: string; mimeType?: string; fileSize?: number } | null {
  if (inbound.video) return inbound.video;
  if (inbound.document?.mimeType?.startsWith("video/")) return inbound.document;
  return null;
}

function formatStorySetupRequestMessage(request: {
  chatId: string;
  chatTitle?: string | null;
  chatType?: string | null;
  chatUsername?: string | null;
  profileName: string;
  audienceLanguage: string;
  audienceDescription: string;
}): string {
  return [
    "New StoryReel setup request",
    "",
    `Group: ${request.chatTitle ?? "(unknown)"}`,
    `Chat ID: ${request.chatId}`,
    `Type: ${request.chatType ?? "unknown"}`,
    request.chatUsername ? `Username: @${request.chatUsername}` : null,
    `Profile: ${request.profileName}`,
    `Language: ${request.audienceLanguage}`,
    `Audience: ${request.audienceDescription}`,
    "",
    `Approve: !admin approve ${request.chatId}`,
    `Reject: !admin reject ${request.chatId}`,
  ].filter(Boolean).join("\n");
}

function resolveStorySetupRequest(chatId?: string) {
  return chatId ? queries.getStorySetupRequestByChatId(chatId) : queries.resolveLatestPendingStorySetupRequest();
}

function resolveMessages(chatId: string, wizardLang?: StoryReelAudienceLanguage) {
  const lang = wizardLang
    ?? (queries.getStoryProfileByChatId(chatId)?.audienceLanguage as StoryReelAudienceLanguage | undefined);
  return getMessages(lang ?? "english");
}

async function handleWizardTextInput(
  chatId: string,
  text: string,
  state: import("./story-conversation-state.js").ConversationState,
  telegram: Sender,
): Promise<void> {
  const msgs = resolveMessages(chatId, state.data.language);

  if (state.wizard === "setup") {
    if (state.step === 2) {
      // Received profile name
      const newState = { ...state, step: 3, data: { ...state.data, profileName: text.trim() } };
      setConversationState(chatId, newState);
      const result = await telegram.sendMessageWithButtons?.(chatId, msgs.askAudienceDescription, [
        [{ text: msgs.skipButton, callback_data: "setup:skip_audience" }],
      ]);
      if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
      return;
    }
    if (state.step === 3) {
      // Received audience description
      const newState = { ...state, step: 4, data: { ...state.data, audienceDescription: text.trim() } };
      setConversationState(chatId, newState);
      const summary = msgs.confirmSetup(newState.data.profileName ?? "", newState.data.language ?? "english", text.trim());
      const result = await telegram.sendMessageWithButtons?.(chatId, summary, [
        [
          { text: msgs.confirmButton, callback_data: "setup:confirm" },
          { text: msgs.startOverButton, callback_data: "setup:restart" },
        ],
      ]);
      if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
      return;
    }
  }

  if (state.wizard === "run" && state.step === 1) {
    // Received run note
    const newState = { ...state, step: 2, data: { ...state.data, note: text.trim() } };
    setConversationState(chatId, newState);
    const summary = msgs.confirmRun(text.trim());
    const result = await telegram.sendMessageWithButtons?.(chatId, summary, [
      [
        { text: msgs.confirmRunButton, callback_data: "run:confirm" },
        { text: msgs.cancelButton, callback_data: "run:cancel" },
      ],
    ]);
    if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
    return;
  }

  if (state.wizard === "run-options") {
    if (state.step === 2) {
      const updated = { ...state, data: { ...state.data, note: text.trim() } };
      setConversationState(chatId, updated);
      clearConversationState(chatId);
      await _executeRun(chatId, text.trim(), telegram, msgs, {
        voiceEnabled: updated.data.voiceEnabled ?? true,
        musicEnabled: updated.data.musicEnabled ?? true,
        captionsEnabled: updated.data.captionsEnabled ?? true,
      });
      return;
    }
    const updated = { ...state, data: { ...state.data, note: text.trim() } };
    setConversationState(chatId, updated);
    const kb = buildRunOptionsKeyboard(msgs, updated.data.voiceEnabled ?? true, updated.data.musicEnabled ?? true, updated.data.captionsEnabled ?? true);
    if (updated.promptMessageId) {
      await telegram.editMessageWithButtons?.(chatId, updated.promptMessageId, runOptionsHeaderText(msgs, text.trim()), kb);
    }
    return;
  }

  if (state.wizard === "tweak" && state.step === 1) {
    const newState = { ...state, step: 2, data: { ...state.data, note: text.trim() } };
    setConversationState(chatId, newState);
    const result = await telegram.sendMessageWithButtons?.(chatId, msgs.confirmRun(text.trim()), [
      [
        { text: msgs.confirmTweakButton, callback_data: "tweak:confirm" },
        { text: msgs.cancelButton, callback_data: "tweak:cancel" },
      ],
    ]);
    if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
    return;
  }

  // Wizard is active but this step doesn't expect text input — user should tap a button
  await telegram.sendMessage(chatId, msgs.wizardInProgress);
}

function buildRunOptionsKeyboard(msgs: ReturnType<typeof getMessages>, voice: boolean, music: boolean, captions: boolean) {
  return [
    [
      { text: msgs.voiceLabel(voice), callback_data: "run-opt:toggle:voice" },
      { text: msgs.musicLabel(music), callback_data: "run-opt:toggle:music" },
      { text: msgs.captionsLabel(captions), callback_data: "run-opt:toggle:captions" },
    ],
    [{ text: msgs.startButton, callback_data: "run-opt:start" }],
  ];
}

function runOptionsHeaderText(msgs: ReturnType<typeof getMessages>, note?: string): string {
  return note ? msgs.runOptionsWithNote(note) : msgs.runOptionsHeader;
}
async function _executeRun(chatId: string, note: string | undefined, telegram: Sender, msgs: ReturnType<typeof getMessages>, options?: { voiceEnabled?: boolean; musicEnabled?: boolean; captionsEnabled?: boolean }): Promise<void> {
  if (isStoryRunning(chatId) || queries.getRecentGeneratingStoryCount(chatId, 5) > 0) {
    await telegram.sendMessage(chatId, msgs.alreadyRunning);
    return;
  }
  const session = queries.getStoryIntakeSession(chatId);
  if (!session || session.clips.length === 0) {
    await telegram.sendMessage(chatId, msgs.noClips);
    return;
  }
  const profile = queries.getStoryProfileByChatId(chatId);
  if (!profile) {
    await telegram.sendMessage(chatId, msgs.noProfile);
    return;
  }
  await telegram.sendMessage(chatId, msgs.generatingVideo);
  createProductionStoryRunner(telegram as never).run(chatId, { profile: profile as never, note, ...options })
    .catch((err) => telegram.sendMessage(chatId, `Failed: ${err instanceof Error ? err.message : String(err)}`));
}

async function _executeTweak(chatId: string, note: string, telegram: Sender, msgs: ReturnType<typeof getMessages>): Promise<void> {
  const prev = queries.getLatestStoryRunForChat(chatId);
  if (!prev) {
    await telegram.sendMessage(chatId, msgs.noRecentStory);
    return;
  }
  await telegram.sendMessage(chatId, msgs.generatingTweak);
  createProductionStoryRunner(telegram as never).tweak(chatId, note)
    .catch((err) => telegram.sendMessage(chatId, `Failed: ${err instanceof Error ? err.message : String(err)}`));
}

async function handleStoryReelCommand(
  chatId: string,
  inbound: TelegramMessage,
  telegram: Sender,
): Promise<boolean> {
  if (!isStoryReelEnabled()) return false;

  const rawText = inbound.text.trim();
  const video = getInboundVideo(inbound);

  // Route text to active wizard if one is waiting for free-text input
  const wizardState = getConversationState(chatId);
  if (wizardState && !video && !rawText.startsWith("!")) {
    await handleWizardTextInput(chatId, rawText, wizardState, telegram);
    return true;
  }

  // Interrupt any active wizard when a different ! command arrives
  if (wizardState && !video && rawText.startsWith("!")) {
    const parsed = parseStoryCommand(rawText);
    if (parsed.type === "cancel" || parsed.type === "help") {
      clearConversationState(chatId);
    } else if (parsed.type !== wizardState.wizard) {
      const msgs = resolveMessages(chatId, wizardState.data.language);
      await telegram.sendMessage(chatId, msgs.wizardInProgress);
      return true;
    }
    // Same command = restart wizard, fall through
    clearConversationState(chatId);
  }

  if (!video && !rawText.startsWith("!")) return false;

  const cmd = video ? null : parseStoryCommand(rawText);
  if (cmd?.type === "unknown") return false;

  if (cmd?.type === "admin") {
    const adminChatId = getStoryReelAdminChatId();
    if (!adminChatId || chatId !== adminChatId) {
      const msgs = resolveMessages(chatId);
      await telegram.sendMessage(chatId, msgs.adminOnly);
      return true;
    }

    if (cmd.action === "pending") {
      const pending = queries.getPendingStorySetupRequests();
      if (pending.length === 0) {
        const msgs = resolveMessages(chatId);
        await telegram.sendMessage(chatId, msgs.noPendingRequests);
        return true;
      }
      await telegram.sendMessage(chatId, pending.map(formatStorySetupRequestMessage).join("\n\n---\n\n"));
      return true;
    }

    if (!cmd.chatId) {
      const pending = queries.getPendingStorySetupRequests();
      if (pending.length > 1) {
        await telegram.sendMessage(chatId, "Multiple pending requests. Use !admin pending and approve with !admin approve <chatId>.");
        return true;
      }
    }

    const request = resolveStorySetupRequest(cmd.chatId);
    if (!request || request.status !== "pending") {
      await telegram.sendMessage(chatId, cmd.chatId ? `No pending StoryReel setup request for ${cmd.chatId}.` : "No pending StoryReel setup requests.");
      return true;
    }

    if (cmd.action === "approve") {
      queries.upsertStoryProfile({
        telegramChatId: request.chatId,
        profileName: request.profileName,
        audienceLanguage: request.audienceLanguage as never,
        audienceDescription: request.audienceDescription,
      });
      queries.deleteStorySetupRequest(request.chatId);
      const approvedMsgs = getMessages((request.audienceLanguage ?? "english") as StoryReelAudienceLanguage);
      await telegram.sendMessage(request.chatId, approvedMsgs.setupComplete);
      await telegram.sendMessage(chatId, `Approved StoryReel chat ${request.chatTitle ?? request.chatId}.`);
      return true;
    }

    queries.markStorySetupRequestRejected(request.chatId);
    const rejectedMsgs = getMessages((request.audienceLanguage ?? "english") as StoryReelAudienceLanguage);
    await telegram.sendMessage(request.chatId, rejectedMsgs.setupRejected);
    await telegram.sendMessage(chatId, `Rejected StoryReel chat ${request.chatTitle ?? request.chatId}.`);
    return true;
  }

  if (video) {
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      const msgs = resolveMessages(chatId);
      await telegram.sendMessage(chatId, msgs.notApproved);
      return true;
    }
    if (!telegram.downloadVideoFile) {
      await telegram.sendMessage(chatId, "Video upload intake is only supported on Telegram in this version.");
      return true;
    }

    const msgs = resolveMessages(chatId);
    const session = queries.getStoryIntakeSession(chatId);
    const clips = session?.clips ?? [];
    if (clips.length >= 5) {
      await telegram.sendMessage(chatId, msgs.clipCountError(5));
      return true;
    }

    const fileSizeMb = video.fileSize ? video.fileSize / (1024 * 1024) : 0;
    if (fileSizeMb > 20) {
      await telegram.sendMessage(chatId, msgs.clipSizeError(Math.round(fileSizeMb)));
      return true;
    }

    const destination = storyIntakeFilePath(chatId, clips.length, video.fileName ?? "clip.mp4");
    await telegram.downloadVideoFile(video.fileId, destination);
    const metadata = probeStoryClipMetadata(destination);

    if (metadata.sizeMb > 50) {
      removeStoryIntakeFile(destination);
      await telegram.sendMessage(chatId, msgs.clipSizeError(metadata.sizeMb));
      return true;
    }
    if (metadata.durationSec > 180) {
      const mins = Math.floor(metadata.durationSec / 60);
      const secs = metadata.durationSec % 60;
      removeStoryIntakeFile(destination);
      await telegram.sendMessage(chatId, msgs.clipDurationError(mins, secs));
      return true;
    }

    const nextClips = [...clips, metadata];
    queries.upsertStoryIntakeSession({
      chatId,
      clips: nextClips,
      totalSizeMb: Math.round(nextClips.reduce((sum, clip) => sum + clip.sizeMb, 0) * 10) / 10,
      totalDurationSec: nextClips.reduce((sum, clip) => sum + clip.durationSec, 0),
      pendingMusicOverride: (session?.pendingMusicOverride ?? null) as never,
      expiresAt: session?.expiresAt ?? computeStoryIntakeExpiry(),
    });

    await telegram.sendMessage(chatId, msgs.clipAccepted(nextClips.length, 5, metadata.durationSec, metadata.sizeMb));
    if (metadata.orientation === "horizontal") {
      await telegram.sendMessage(chatId, msgs.clipHorizontalWarning(nextClips.length));
    }
    return true;
  }

  if (!cmd) return false;

  if (cmd.type === "setup") {
    // Start the setup wizard — clear any existing state and begin from step 1
    clearConversationState(chatId);
    const msgs = resolveMessages(chatId);
    const result = await telegram.sendMessageWithButtons?.(chatId, msgs.chooseLanguage, [
      [
        { text: "ภาษาไทย", callback_data: "setup:lang:thai" },
        { text: "English", callback_data: "setup:lang:english" },
        { text: "Deutsch", callback_data: "setup:lang:german" },
      ],
    ]);
    setConversationState(chatId, {
      wizard: "setup",
      step: 1,
      data: {
        // Preserve chat metadata so admin notification has it at confirm time
        chatTitle: inbound.chatTitle ?? undefined,
        chatType: inbound.chatType ?? undefined,
        chatUsername: inbound.chatUsername ?? undefined,
      },
      promptMessageId: result?.messageId,
    });
    return true;
  }

  if (cmd.type === "profile") {
    const msgs = resolveMessages(chatId);
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      await telegram.sendMessage(chatId, msgs.noProfile);
      return true;
    }
    const runCount = queries.getCompletedStoryRunCountForProfile(profile.id);
    await telegram.sendMessage(chatId, msgs.profileDisplay(
      profile.profileName,
      profile.audienceLanguage,
      profile.audienceDescription,
      profile.preferredVoiceProvider ?? "auto",
      profile.preferredVoiceId ?? "auto",
      runCount,
    ));
    return true;
  }

  if (cmd.type === "music") {
    const msgs = resolveMessages(chatId);
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      await telegram.sendMessage(chatId, msgs.noProfile);
      return true;
    }
    // If genre provided directly (text shortcut), apply immediately
    if (cmd.genre) {
      const genre = cmd.genre.toLowerCase();
      const error = validateMusicGenreInput(genre);
      if (error) {
        await telegram.sendMessage(chatId, error);
        return true;
      }
      const session = queries.getStoryIntakeSession(chatId);
      queries.upsertStoryIntakeSession({
        chatId,
        clips: session?.clips ?? [],
        totalSizeMb: session?.totalSizeMb ?? 0,
        totalDurationSec: session?.totalDurationSec ?? 0,
        pendingMusicOverride: genre as never,
        expiresAt: session?.expiresAt ?? computeStoryIntakeExpiry(),
      });
      await telegram.sendMessage(chatId, msgs.musicGenreSet(genre));
      return true;
    }
    // No genre — show genre buttons
    await telegram.sendMessageWithButtons?.(chatId, msgs.chooseMusicGenre, [
      [
        { text: "Upbeat", callback_data: "music:upbeat" },
        { text: "Calm", callback_data: "music:calm" },
        { text: "Neutral", callback_data: "music:neutral" },
      ],
      [
        { text: "Playful", callback_data: "music:playful" },
        { text: "Dramatic", callback_data: "music:dramatic" },
        { text: "Inspirational", callback_data: "music:inspirational" },
      ],
    ]);
    return true;
  }

  if (cmd.type === "story") {
    const msgs = resolveMessages(chatId);
    const session = queries.getStoryIntakeSession(chatId);
    if (!session || session.clips.length === 0) {
      await telegram.sendMessage(chatId, msgs.noClips);
      return true;
    }
    await telegram.sendMessageWithButtons?.(
      chatId,
      msgs.clipBuffer(session.clips.length, 5, session.totalSizeMb, session.totalDurationSec),
      [[
        { text: msgs.runNowButton, callback_data: "story:run" },
        { text: msgs.cancelButton, callback_data: "story:cancel" },
      ]],
    );
    return true;
  }

  if (cmd.type === "cancel") {
    const msgs = resolveMessages(chatId);
    await telegram.sendMessageWithButtons?.(chatId, msgs.confirmCancelPrompt, [[
      { text: msgs.yesClearButton, callback_data: "cancel:yes" },
      { text: msgs.keepClipsButton, callback_data: "cancel:no" },
    ]]);
    return true;
  }

  if (cmd.type === "run") {
    const msgs = resolveMessages(chatId);
    if (isStoryRunning(chatId) || queries.getRecentGeneratingStoryCount(chatId, 5) > 0) {
      await telegram.sendMessage(chatId, msgs.alreadyRunning);
      return true;
    }
    const session = queries.getStoryIntakeSession(chatId);
    if (!session || session.clips.length === 0) {
      await telegram.sendMessage(chatId, msgs.noClips);
      return true;
    }
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      await telegram.sendMessage(chatId, msgs.noProfile);
      return true;
    }
    const kb = buildRunOptionsKeyboard(msgs, true, true, true);
    const header = runOptionsHeaderText(msgs, cmd.note);
    const result = await telegram.sendMessageWithButtons?.(chatId, header, kb);
    setConversationState(chatId, { wizard: "run-options", step: 1, data: { note: cmd.note, voiceEnabled: true, musicEnabled: true, captionsEnabled: true }, promptMessageId: result?.messageId });
    return true;
  }

  if (cmd.type === "tweak") {
    const msgs = resolveMessages(chatId);
    const prev = queries.getLatestStoryRunForChat(chatId);
    if (!prev) {
      await telegram.sendMessage(chatId, msgs.noRecentStory);
      return true;
    }
    if (cmd.note) {
      await _executeTweak(chatId, cmd.note, telegram, msgs);
      return true;
    }
    await telegram.sendMessageWithButtons?.(chatId, msgs.askTweakNote, [
      [{ text: msgs.skipTweakButton, callback_data: "tweak:skip" }],
    ]);
    setConversationState(chatId, { wizard: "tweak", step: 1, data: {} });
    return true;
  }

  if (cmd.type === "resume") {
    const msgs = resolveMessages(chatId);
    let storyId: string | undefined;
    if (cmd.id) {
      storyId = queries.getStoryRunById(cmd.id)?.id ?? queries.getStoryRunByShortId(chatId, cmd.id)?.id;
    } else {
      storyId = queries.getLatestStoryRunForChat(chatId)?.id;
    }
    if (!storyId) {
      await telegram.sendMessage(chatId, msgs.noProfile);
      return true;
    }
    await telegram.sendMessage(chatId, msgs.resumingStory(storyId.slice(0, 8)));
    createProductionStoryRunner(telegram as never).resume(storyId)
      .catch((err) => telegram.sendMessage(chatId, `Failed: ${err instanceof Error ? err.message : String(err)}`));
    return true;
  }

  if (cmd.type === "rebuild") {
    const msgs = resolveMessages(chatId);
    let storyId: string | undefined;
    if (cmd.id) {
      storyId = queries.getStoryRunById(cmd.id)?.id ?? queries.getStoryRunByShortId(chatId, cmd.id)?.id;
    } else {
      storyId = queries.getLatestStoryRunForChat(chatId)?.id;
    }
    if (!storyId) {
      await telegram.sendMessage(chatId, msgs.noRecentStory);
      return true;
    }
    await telegram.sendMessage(chatId, msgs.rebuildingStory(storyId.slice(0, 8), cmd.stage));
    createProductionStoryRunner(telegram as never).rebuild(storyId, cmd.stage)
      .catch((err) => telegram.sendMessage(chatId, `Failed: ${err instanceof Error ? err.message : String(err)}`));
    return true;
  }

  if (cmd.type === "help") {
    const msgs = resolveMessages(chatId);
    await telegram.sendMessage(chatId, msgs.helpText);
    return true;
  }

  return false;
}

export async function handleStoryReelCallback(
  chatId: string,
  callbackQueryId: string,
  data: string,
  telegram: Sender,
  messageId?: number,
): Promise<void> {
  await telegram.answerCallbackQuery?.(callbackQueryId);

  const state = getConversationState(chatId);
  const msgs = resolveMessages(chatId, state?.data.language);

  if (data.startsWith("setup:lang:")) {
    const lang = data.replace("setup:lang:", "") as StoryReelAudienceLanguage;
    const newState = { wizard: "setup" as const, step: 2, data: { ...state?.data, language: lang } };
    setConversationState(chatId, newState);
    const langMsgs = getMessages(lang);
    await telegram.sendMessage(chatId, langMsgs.askProfileName);
    return;
  }

  if (data === "setup:skip_audience") {
    if (!state || state.wizard !== "setup" || state.step !== 3) return;
    const newState = { ...state, step: 4, data: { ...state.data, audienceDescription: "" } };
    setConversationState(chatId, newState);
    const langMsgs = getMessages(newState.data.language ?? "english");
    const summary = langMsgs.confirmSetup(newState.data.profileName ?? "", newState.data.language ?? "english", "");
    const result = await telegram.sendMessageWithButtons?.(chatId, summary, [
      [
        { text: langMsgs.confirmButton, callback_data: "setup:confirm" },
        { text: langMsgs.startOverButton, callback_data: "setup:restart" },
      ],
    ]);
    if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
    return;
  }

  if (data === "setup:confirm") {
    if (!state || state.wizard !== "setup" || state.step !== 4) return;
    clearConversationState(chatId);
    const langMsgs = getMessages(state.data.language ?? "english");
    const existingProfile = queries.getStoryProfileByChatId(chatId);
    if (!existingProfile) {
      queries.upsertStorySetupRequest({
        chatId,
        chatTitle: state.data.chatTitle ?? null,
        chatType: state.data.chatType ?? null,
        chatUsername: state.data.chatUsername ?? null,
        profileName: state.data.profileName!,
        audienceLanguage: (state.data.language ?? "english") as never,
        audienceDescription: state.data.audienceDescription ?? "",
      });
      const adminChatId = getStoryReelAdminChatId();
      if (adminChatId) {
        await telegram.sendMessage(adminChatId, formatStorySetupRequestMessage({
          chatId,
          chatTitle: state.data.chatTitle,
          chatType: state.data.chatType,
          chatUsername: state.data.chatUsername,
          profileName: state.data.profileName!,
          audienceLanguage: state.data.language ?? "english",
          audienceDescription: state.data.audienceDescription ?? "",
        }));
      }
      await telegram.sendMessage(chatId, langMsgs.setupRequestSent);
      return;
    }
    queries.upsertStoryProfile({
      telegramChatId: chatId,
      profileName: state.data.profileName!,
      audienceLanguage: (state.data.language ?? "english") as never,
      audienceDescription: state.data.audienceDescription ?? "",
    });
    await telegram.sendMessage(chatId, langMsgs.setupComplete);
    return;
  }

  if (data === "setup:restart") {
    clearConversationState(chatId);
    const result = await telegram.sendMessageWithButtons?.(chatId, msgs.chooseLanguage, [
      [
        { text: "ภาษาไทย", callback_data: "setup:lang:thai" },
        { text: "English", callback_data: "setup:lang:english" },
        { text: "Deutsch", callback_data: "setup:lang:german" },
      ],
    ]);
    setConversationState(chatId, { wizard: "setup", step: 1, data: {}, promptMessageId: result?.messageId });
    return;
  }

  if (data.startsWith("music:")) {
    const genre = data.replace("music:", "");
    clearConversationState(chatId);
    const session = queries.getStoryIntakeSession(chatId);
    queries.upsertStoryIntakeSession({
      chatId,
      clips: session?.clips ?? [],
      totalSizeMb: session?.totalSizeMb ?? 0,
      totalDurationSec: session?.totalDurationSec ?? 0,
      pendingMusicOverride: genre as never,
      expiresAt: session?.expiresAt ?? computeStoryIntakeExpiry(),
    });
    await telegram.sendMessage(chatId, msgs.musicGenreSet(genre));
    return;
  }

  if (data === "run:skip" || data === "story:run") {
    clearConversationState(chatId);
    await _executeRun(chatId, undefined, telegram, msgs);
    return;
  }

  if (data.startsWith("run-opt:toggle:")) {
    if (!state || state.wizard !== "run-options") return;
    const field = data.replace("run-opt:toggle:", "") as "voice" | "music" | "captions";
    const key = `${field}Enabled` as "voiceEnabled" | "musicEnabled" | "captionsEnabled";
    const current = state.data[key] ?? true;
    const updated = { ...state.data, [key]: !current };
    setConversationState(chatId, { ...state, data: updated });
    const kb = buildRunOptionsKeyboard(msgs, updated.voiceEnabled ?? true, updated.musicEnabled ?? true, updated.captionsEnabled ?? true);
    if (state.promptMessageId) {
      await telegram.editMessageWithButtons?.(chatId, state.promptMessageId, msgs.runOptionsHeader, kb);
    }
    return;
  }

  if (data === "run-opt:start") {
    if (!state || state.wizard !== "run-options") return;
    const newState = { ...state, step: 2 };
    setConversationState(chatId, newState);
    const result = await telegram.sendMessageWithButtons?.(chatId, msgs.runOptionsAskNote, [
      [{ text: msgs.runOptionsSkipNoteButton, callback_data: "run-opt:skip-note" }],
    ]);
    if (result) setConversationState(chatId, { ...newState, promptMessageId: result.messageId });
    return;
  }

  if (data === "run-opt:skip-note") {
    if (!state || state.wizard !== "run-options") return;
    clearConversationState(chatId);
    await _executeRun(chatId, state.data.note, telegram, msgs, {
      voiceEnabled: state.data.voiceEnabled ?? true,
      musicEnabled: state.data.musicEnabled ?? true,
      captionsEnabled: state.data.captionsEnabled ?? true,
    });
    return;
  }

  if (data === "run:confirm") {
    if (!state || state.wizard !== "run") return;  // stale — answer already sent above
    clearConversationState(chatId);
    await _executeRun(chatId, state.data.note, telegram, msgs);
    return;
  }

  if (data === "run:cancel") {
    clearConversationState(chatId);
    return;
  }

  if (data === "tweak:skip") {
    clearConversationState(chatId);
    await _executeTweak(chatId, "", telegram, msgs);
    return;
  }

  if (data === "tweak:confirm") {
    if (!state || state.wizard !== "tweak") return;  // stale — answer already sent above
    clearConversationState(chatId);
    await _executeTweak(chatId, state.data.note ?? "", telegram, msgs);
    return;
  }

  if (data === "tweak:cancel") {
    clearConversationState(chatId);
    return;
  }

  if (data === "cancel:yes" || data === "story:cancel") {
    clearConversationState(chatId);
    if (messageId) await telegram.deleteMessage?.(chatId, messageId);
    requestCancelStory(chatId);
    queries.clearStoryIntakeSession(chatId);
    removeStoryIntakeFiles(chatId);
    await telegram.sendMessage(chatId, msgs.cancelComplete);
    return;
  }

  if (data === "cancel:no") {
    clearConversationState(chatId);
    if (messageId) await telegram.deleteMessage?.(chatId, messageId);
    return;
  }
}

export async function handleCommand(
  brandId: BrandId,
  chatId: string,
  rawText: string | TelegramMessage,
  telegram: Sender,
): Promise<void> {
  const brand = getBrand(brandId);
  const language = brand.language as UiLang;
  const S = getUiStrings(language);
  const validThemes = ["Tech", "Health", "Economy", "Politics", "Entertainment", "Environment", "Science", "Sports", "Lifestyle"];

  const inbound = typeof rawText === "string"
    ? ({ text: rawText.trim() } as TelegramMessage)
    : rawText;
  const rawTrimmed = inbound.text.trim();

  if (!getStoryReelBotToken() && await handleStoryReelCommand(chatId, inbound, telegram)) return;

  const intakeSession = getReelIntakeSession(brandId, chatId);
  if (intakeSession && !rawTrimmed.startsWith("!")) {
    if (intakeSession.step === "awaiting_source") {
      if (!rawTrimmed) {
        await telegram.sendMessage(chatId, `⚠️ Source is required (URL or non-empty label)`);
        return;
      }
      setReelIntakeSession({
        brand: brandId,
        chatId,
        mode: intakeSession.mode,
        step: "awaiting_content",
        sourceInput: rawTrimmed,
        stage5Renderer: intakeSession.stage5Renderer,
        stage5Template: intakeSession.stage5Template,
      });
      await telegram.sendMessage(chatId, `✅ Source saved. Send content as one message (max ~4096 chars) or upload a .txt file.`);
      return;
    }

    let contentText = "";
    let inputType: "pasted" | "txt_upload" = "pasted";
    if (inbound.document) {
      const fileName = inbound.document.fileName ?? "";
      if (!fileName.toLowerCase().endsWith(".txt")) {
        await telegram.sendMessage(chatId, `⚠️ Only .txt files are supported. Please upload a .txt file.`);
        return;
      }
      if (!telegram.downloadTextFile) {
        await telegram.sendMessage(chatId, `⚠️ File upload intake is only supported on Telegram in this version.`);
        return;
      }
      contentText = (await telegram.downloadTextFile(inbound.document.fileId)).trim();
      inputType = "txt_upload";
    } else {
      contentText = rawTrimmed;
      if (contentText.length > 4096) {
        await telegram.sendMessage(chatId, `⚠️ Pasted text is too long. Please shorten it or upload a .txt file.`);
        return;
      }
    }

    if (!contentText) {
      await telegram.sendMessage(chatId, `⚠️ Content is empty. Please send text or upload a .txt file.`);
      return;
    }

    if (isReelRunning(brandId)) {
      await telegram.sendMessage(chatId, `⚠️ Already running`);
      return;
    }

    clearReelIntakeSession(brandId, chatId);
    const modeLabel = intakeSession.mode === "text" ? "manual text" : "hint";
    await telegram.sendMessage(chatId, `🎬 Generating reel from ${modeLabel} source — ${brand.name}`);
    ReelRunner.run(brandId, {
      manualSourceMode: intakeSession.mode,
      manualSourceInput: intakeSession.sourceInput,
      manualSourceText: contentText,
      manualSourceTextInputType: inputType,
      categorySource: "manual" as const,
      stage5Renderer: intakeSession.stage5Renderer,
      stage5Template: intakeSession.stage5Template,
    } as any).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
    return;
  }

  if (!rawTrimmed.startsWith("!") || rawTrimmed.startsWith("!!")) return;
  console.log(`[cmd-listener:${brandId}] received: "${rawTrimmed}"`);

  // ── Global flags ──────────────────────────────────────────────────────────
  let useStockImages: boolean | undefined = undefined;
  let raw = rawTrimmed;
  if (raw.toLowerCase().includes("-stock")) {
    useStockImages = true;
    raw = raw.replace(/-stock/gi, "").replace(/\s+/g, " ").trim();
  }

  const t = raw.slice(1).trim().toLowerCase();

  // ── !help ──────────────────────────────────────────────────────────────────
  if (t === "help") {
    const msg = S.helpCommandBody.replace("__BRAND_NAME__", escapeHtml(brand.name));
    await telegram.sendMessage(chatId, msg);
    return;
  }

  // ── !status ────────────────────────────────────────────────────────────────
  if (t === "status") {
    let reelBlock = "";
    if (brand.reels?.enabled) {
      const latestReel = getRecentReels(brandId, 1)[0];
      if (latestReel) {
        const reelStatusEmoji: Record<string, string> = { generating: "⚙️", awaiting_script_confirmation: "🛑", awaiting_approval: "⏳", approved: "✅", published: "📤", rejected: "❌", failed: "❌", cancelled: "🛑" };
        const reelReviewLine = latestReel.reviewUrl && latestReel.status === "awaiting_approval"
          ? `\n📄 <a href="${latestReel.reviewUrl}">${S.reelReviewLink}</a>`
          : "";
        reelBlock = `\n\n🎬 ${S.latestReel} · <code>${latestReel.id.slice(0, 8)}</code>\n${reelStatusEmoji[latestReel.status] ?? "❓"} ${latestReel.status} — ${latestReel.headline.slice(0, 60)}${reelReviewLine}`;
      }
    }

    const msg = `📊 <b>${S.statusHeading} — ${brand.name}</b>${reelBlock}`;
    await telegram.sendMessage(chatId, msg);
    return;
  }

  // ── !batch ────────────────────────────────────────────────────────────────
  if (t === "batch" || t.startsWith("batch ")) {
    const subCmd = t === "batch" ? "" : t.slice(6).trim();
    const countMatch = subCmd.match(/^(\d+)/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    if (subCmd === "" || subCmd === "status") {
      const recentBatches = queries.getRecentBatchRuns(brandId, 5);
      if (!recentBatches.length) { await telegram.sendMessage(chatId, `📦 No batch runs yet`); return; }
      const lines = recentBatches.map((b: any) => `📦 <code>${b.id}</code> · ${b.count} reels · ${b.status}`);
      await telegram.sendMessage(chatId, `📦 <b>Batch runs — ${brand.name}</b>\n\n${lines.join("\n\n")}`);
      return;
    }
    if (count < 1 || count > 20) { await telegram.sendMessage(chatId, `⚠️ Count 1-20 required`); return; }
    if (isReelRunning(brandId)) { await telegram.sendMessage(chatId, `⚠️ A reel is already running`); return; }
    await telegram.sendMessage(chatId, `📦 Starting batch: ${count} reels...`);
    const { spawn } = await import("child_process");
    const child = spawn("npx", ["tsx", "scripts/batch-run.ts", brandId, "--count", String(count)], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }

  // ── !reel ──────────────────────────────────────────────────────────────────
  if (t === "reel" || t.startsWith("reel ")) {
    const subCmd = t === "reel" ? "" : t.slice(5).trim();
    const subCmdLoose = subCmd.replace(/[.!?]+$/, "");
    const subCmdPreserveCase = raw.slice(1).trim() === "reel" ? "" : raw.slice(1).trim().slice(5).trim();
    if (/(^|\s)-ffmpeg(?=\s|$)/i.test(subCmdPreserveCase)) {
      await telegram.sendMessage(chatId, "❌ Stage 5 ffmpeg renderer is retired. Hyperframes is now the default.");
      return;
    }
    const commandFlags = parseReelCommandFlags(subCmdPreserveCase);
    const cleanedSubCmd = commandFlags.cleaned.toLowerCase().replace(/[.!?]+$/, "");
    const stage5Overrides = {
      stage5Renderer: commandFlags.stage5Renderer,
      stage5Template: commandFlags.stage5Template,
    };
    const reelUseStockImages = commandFlags.useStockImages ?? useStockImages;

    if (subCmdLoose === "list") {
      const recentReels = queries.getRecentReels(brandId, 5);
      const lines = recentReels.map((r) => {
        const shortId = r.id.slice(0, 8);
        const schedLine = r.status === "approved" && r.scheduledTime ? `\n   🕐 Scheduled: ${r.scheduledTime}` : "";
        const reviewLink = r.reviewUrl ? ` · <a href="${r.reviewUrl}">Review</a>` : "";
        return `🆔 <code>${shortId}</code> ${r.status}${reviewLink}${schedLine}\n   📰 ${r.headline?.slice(0, 55)}`;
      });
      await telegram.sendMessage(chatId, `🎬 <b>Recent reels — ${brand.name}</b>\n\n${lines.join("\n\n")}`);
      return;
    }

    if (subCmdLoose === "status") {
      const getNextReelRun = (skip = 0): string => {
        if (!brand.reels?.scheduleEnabled) return "Schedule disabled";
        const now = new Date();
        const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: brand.timezone }));
        const nowMins = nowLocal.getHours() * 60 + nowLocal.getMinutes();
        let found = 0;
        for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
          const d = new Date(now.getTime() + dayOffset * 86400_000);
          const dow = new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone, weekday: "short" }).format(d);
          const isWeekend = dow === "Sat" || dow === "Sun";
          const slots = isWeekend ? (brand.reels.reelTimesWeekend ?? brand.reels.reelTimes) : brand.reels.reelTimes;
          const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: brand.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
          for (const slot of slots) {
            const time = typeof slot === "string" ? slot : slot.time;
            const [ph, pm] = time.split(":").map(Number);
            const fireMins = ph * 60 + pm - 30;
            const fh = Math.floor(((fireMins % 1440) + 1440) % 1440 / 60);
            const fm = ((fireMins % 60) + 60) % 60;
            if (dayOffset > 0 || fh * 60 + fm > nowMins) { if (found++ < skip) continue; return `${dateStr} ${String(fh).padStart(2,"0")}:${String(fm).padStart(2,"0")}`; }
          }
        }
        return "Unknown";
      };
      const latestReel = queries.getRecentReels(brandId, 1)[0];
      if (!latestReel) { await telegram.sendMessage(chatId, `ℹ️ No reels yet`); return; }
      const shortId = latestReel.id.slice(0, 8);
      const skipCount = isSkipNextReel(brandId);
      const nextRun = getNextReelRun(skipCount);
      const schedLine = latestReel.status === "approved" && latestReel.scheduledTime ? `\n   🕐 Scheduled: ${latestReel.scheduledTime}` : "";
      const reviewLine = latestReel.reviewUrl && latestReel.status === "awaiting_approval" ? `\n📄 <a href="${latestReel.reviewUrl}">Review page</a>` : "";
      await telegram.sendMessage(chatId, `🎬 <b>Latest reel — ${brand.name}</b> · <code>${shortId}</code>\n${latestReel.status} — ${latestReel.headline}${reviewLine}${schedLine}\n\n⏰ <b>Next run:</b> ${nextRun}${skipCount > 0 ? ` (⏭ ${skipCount} skipped)` : ""}`);
      return;
    }

    if (subCmdLoose === "cancel") {
      clearReelIntakeSession(brandId, chatId);
      if (isReelRunning(brandId)) { requestCancelReel(brandId); await telegram.sendMessage(chatId, `🛑 Cancelling reel...`); }
      else { await telegram.sendMessage(chatId, `🛑 Intake cancelled`); }
      return;
    }

    if (cleanedSubCmd === "text" || cleanedSubCmd === "hint") {
      if (!brand.reels?.enabled) return;
      if (isReelRunning(brandId)) { await telegram.sendMessage(chatId, `⚠️ Already running`); return; }
      setReelIntakeSession({
        brand: brandId,
        chatId,
        mode: cleanedSubCmd === "text" ? "text" : "hint",
        step: "awaiting_source",
        stage5Renderer: commandFlags.stage5Renderer,
        stage5Template: commandFlags.stage5Template,
      });
      await telegram.sendMessage(chatId, `📝 Send source now (URL or free-text label).`);
      return;
    }

    if (cleanedSubCmd.startsWith("confirm")) {
      const rest = cleanedSubCmd.slice(8).trim();
      const validCategories = ["breaking", "trending", "human_interest", "business", "open"];
      const parts = rest.split(/\s+/);
      let id: string | undefined;
      let categoryOverride: import("../types.js").ReelCategory | undefined;
      if (validCategories.includes(parts[0])) {
        categoryOverride = parts[0] as import("../types.js").ReelCategory;
      } else {
        id = parts[0] || undefined;
        if (validCategories.includes(parts[1])) categoryOverride = parts[1] as import("../types.js").ReelCategory;
      }
      const target = id
        ? getReelByShortId(brandId, id)
        : queries.getRecentReels(brandId, 20).find((r) => r.status === "awaiting_script_confirmation");
      if (!target) {
        await telegram.sendMessage(chatId, id ? "⚠️ Reel not found" : "⚠️ No reel awaiting confirmation");
        return;
      }
      const categoryMsg = categoryOverride ? ` with category ${categoryOverride}` : "";
      await telegram.sendMessage(chatId, `✅ Confirmed reel ${target.id.slice(0, 8)}${categoryMsg} — continuing...`);
      ReelRunner.confirm(target.id, brandId, reelUseStockImages ?? false, stage5Overrides, categoryOverride).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      return;
    }

    if (subCmd.startsWith("reject")) {
      const id = subCmd.slice(7).trim();
      const target = id ? getReelByShortId(brandId, id) : queries.getRecentReels(brandId, 1)[0];
      if (target) { queries.updateReel(target.id, { status: "rejected" }); await telegram.sendMessage(chatId, `❌ Reel rejected`); }
      return;
    }

    if (cleanedSubCmd.startsWith("resume")) {
      const id = cleanedSubCmd.slice(7).trim();
      const target = id ? getReelByShortId(brandId, id) : queries.getRecentReels(brandId, 1).find(r => r.status === "failed" || r.status === "cancelled");
      if (target) {
        await telegram.sendMessage(chatId, `🔄 Resuming reel ${target.id.slice(0, 8)}...`);
        ReelRunner.resume(target.id, brandId, reelUseStockImages ?? false, stage5Overrides).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      }
      return;
    }

    if (cleanedSubCmd === "rebuild" || cleanedSubCmd.startsWith("rebuild ")) {
      const id = cleanedSubCmd.slice(8).trim();
      const target = id
        ? getReelByShortId(brandId, id)
        : queries.getRecentReels(brandId, 20).find((r) => r.status === "awaiting_approval");
      if (!target) {
        await telegram.sendMessage(chatId, id ? "⚠️ Reel not found" : "⚠️ No awaiting-approval reel found");
        return;
      }
      await telegram.sendMessage(chatId, `🔄 Rebuilding reel ${target.id.slice(0, 8)}...`);
      ReelRunner.rebuild(target.id, brandId, reelUseStockImages ?? false, stage5Overrides).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      return;
    }

    if (cleanedSubCmd === "rescript" || cleanedSubCmd.startsWith("rescript ")) {
      const parts = cleanedSubCmd.slice(9).trim().split(/\s+/);
      const first = parts[0];
      const isId = first && isLikelyReelShortId(first);
      const id = isId ? first : undefined;
      const rest = isId ? parts.slice(1) : parts;
      const cat = rest[0] as ReelCategory | undefined;
      const effect = rest[1] as CameraEffectType | undefined;
      const target = id
        ? getReelByShortId(brandId, id)
        : queries.getRecentReels(brandId, 20).find((r) => r.status === "awaiting_approval");
      if (!target) {
        await telegram.sendMessage(chatId, id ? "⚠️ Reel not found" : "⚠️ No awaiting-approval reel found");
        return;
      }
      await telegram.sendMessage(chatId, `🔄 Rescripting reel ${target.id.slice(0, 8)}...`);
      ReelRunner.rerescript(target.id, brandId, cat, reelUseStockImages ?? false, effect, stage5Overrides).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      return;
    }

    if (cleanedSubCmd.startsWith("re-voice") || cleanedSubCmd.startsWith("re-images") || cleanedSubCmd.startsWith("re-music") || cleanedSubCmd.startsWith("re-effect")) {
      let parsed: ReelRebuildCommand;
      try {
        parsed = {
          ...parseReelRebuildCommand(commandFlags.cleaned),
          useStockImagesOverride: reelUseStockImages === true ? true : false,
          stage5Renderer: commandFlags.stage5Renderer,
          stage5Template: commandFlags.stage5Template,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid reel rebuild command";
        await telegram.sendMessage(chatId, `⚠️ ${msg}`);
        return;
      }

      const target = parsed.reelShortId
        ? getReelByShortId(brandId, parsed.reelShortId)
        : queries.getRecentReels(brandId, 20)[0];

      console.log(`[cmd-listener:${brandId}] re-voice: found reel=${target?.id.slice(0, 8)} speed=${parsed.voiceSpeedOverride}`);

      if (!target) {
        await telegram.sendMessage(chatId, parsed.reelShortId ? "⚠️ Reel not found" : "⚠️ No recent reel found");
        return;
      }

      const voiceLabel = parsed.part === "voice"
        ? `voice${parsed.voiceIdOverride ? ` (${parsed.voiceIdOverride.slice(0, 8)})` : ""}${parsed.voiceSpeedOverride ? ` (${parsed.voiceSpeedOverride}x)` : ""}`
        : undefined;
      const label = voiceLabel || (parsed.part === "images" ? "images" : parsed.part === "video" ? `video (effect: ${parsed.cameraEffectOverride})` : "music");
      console.log(`[cmd-listener:${brandId}] sending: 🔄 Rebuilding ${label}...`);
      await telegram.sendMessage(chatId, `🔄 Rebuilding ${label} for reel ${target.id.slice(0, 8)}...`);
      ReelRunner.rebuildPart(target.id, brandId, parsed.part, {
        useStockImagesOverride: parsed.useStockImagesOverride,
        musicTrackSelector: parsed.musicTrackSelector,
        cameraEffectOverride: parsed.cameraEffectOverride,
        cameraPresetOverride: parsed.cameraPresetOverride,
        voiceSpeedOverride: parsed.voiceSpeedOverride,
        voiceIdOverride: parsed.voiceIdOverride,
        stage5Renderer: parsed.stage5Renderer,
        stage5Template: parsed.stage5Template,
      }).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      return;
    }

    if (subCmd.startsWith("skip cancel")) {
      cancelSkipNextReel(brandId, subCmd.includes("all"));
      await telegram.sendMessage(chatId, `✅ Skip updated (remaining: ${isSkipNextReel(brandId)})`);
      return;
    }
    if (subCmdLoose === "skip") {
      setSkipNextReel(brandId);
      await telegram.sendMessage(chatId, `⏭ Next run skipped (total: ${isSkipNextReel(brandId)})`);
      return;
    }

    if (subCmd.startsWith("approve")) {
      const parts = subCmd.slice(8).trim().split(/\s+/);
      let approveId = ""; let scheduleTime = ""; let scheduleTomorrow = false;
      for (const part of parts) {
        const tm = part.match(/^(\d{1,2})[:.h](\d{2})$/);
        if (tm) scheduleTime = `${String(tm[1]).padStart(2, "0")}:${tm[2]}`;
        else if (/^(tmr|tomorrow|tom)$/i.test(part)) scheduleTomorrow = true;
        else approveId = part;
      }
      const latestReel = approveId ? getReelByShortId(brandId, approveId) : queries.getRecentReels(brandId, 1).find((r) => r.status === "awaiting_approval");
      if (!latestReel) { await telegram.sendMessage(chatId, `⚠️ Reel not found`); return; }
      if (!latestReel.videoGcsUrl) {
        const hint = latestReel.status === "awaiting_script_confirmation" ? " — use !reel confirm to continue generation first" : "";
        await telegram.sendMessage(chatId, `⚠️ Reel has no video yet (status: ${latestReel.status})${hint}`);
        return;
      }
      if (scheduleTime) {
        const baseDate = new Date();
        if (scheduleTomorrow) baseDate.setDate(baseDate.getDate() + 1);
        else {
          const nowTime = baseDate.toLocaleTimeString("en-CA", { timeZone: brand.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
          if (scheduleTime <= nowTime) baseDate.setDate(baseDate.getDate() + 1);
        }
        const fullSched = `${baseDate.toLocaleDateString("en-CA", { timeZone: brand.timezone })} ${scheduleTime}`;
        queries.updateReel(latestReel.id, { status: "approved", scheduledTime: fullSched });
        await telegram.sendMessage(chatId, `✅ Reel approved for ${fullSched}`);
        return;
      }
      await telegram.sendMessage(chatId, `⏳ Publishing...`);
      const { createMetaService } = await import("../services/meta.js");
      const { buildReelCaption } = await import("./reel-runner.js");
      const meta = createMetaService();
      const script = JSON.parse(latestReel.script ?? "{}") as ReelScript;
      const { caption, sourceComment } = buildReelCaption(latestReel.headline, script.hashtags || [], latestReel.sourceUrl, brand.postSourceAsComment ?? false);
      let fbPostId: string | undefined;
      let igResult: { id: string; permalink?: string } | undefined;
      try {
        fbPostId = await meta.publishFacebookReel(brand.metaPageId, brand.metaPageToken, latestReel.videoGcsUrl!, caption);
        if (fbPostId && sourceComment) {
          await meta.addFirstComment(fbPostId, brand.metaPageToken, sourceComment).catch((err) =>
            console.error(`[reel-approve:${brandId}] Facebook source comment failed:`, err instanceof Error ? err.message : err)
          );
        }
      } catch (err: any) {
        await telegram.sendMessage(chatId, `❌ Facebook failed: ${err.message}`);
        return;
      }
      const nowSched = `${new Date().toLocaleDateString("en-CA", { timeZone: brand.timezone })} ${new Date().toLocaleTimeString("en-CA", { timeZone: brand.timezone, hour: "2-digit", minute: "2-digit", hour12: false })}`;
      queries.updateReel(latestReel.id, { status: "published", approved: true, facebookPostId: fbPostId, scheduledTime: nowSched, publishedAt: new Date().toISOString() });
      if (brand.instagramEnabled) {
        try {
          const igUserId = await meta.getInstagramUserId(brand.metaPageId, brand.metaPageToken);
          if (igUserId) igResult = await meta.publishInstagramReel(igUserId, brand.metaPageToken, latestReel.videoGcsUrl!, caption);
          if (igResult && sourceComment) {
            await meta.addFirstComment(igResult.id, brand.metaPageToken, sourceComment).catch((err) =>
              console.error(`[reel-approve:${brandId}] Instagram source comment failed:`, err instanceof Error ? err.message : err)
            );
          }
        } catch (err: any) {
          await telegram.sendMessage(chatId, `⚠️ Facebook ok, Instagram failed: ${err.message}`);
        }
      }
      const msgParts = [`✅ FB: ${fbPostId}`];
      if (igResult) msgParts.push(`IG: ${igResult.permalink || igResult.id}`);
      await telegram.sendMessage(chatId, msgParts.join(" | "));
      return;
    }

    const manualUseStockImages = commandFlags.useStockImages ?? useStockImages;
    const matchedReelTheme = validThemes.find(th => th.toLowerCase() === cleanedSubCmd);
    // Support: !reel, !reel <category>, !reel <category> <effect>, !reel <effect>, !reel <url>, !reel <url> <category>, !reel <url> <category> <effect>, !reel <theme>
    const reelSubTokens = cleanedSubCmd.split(/\s+/);
    const possibleCategory = reelSubTokens[0];
    const possibleEffect = reelSubTokens[1] as CameraEffectType | undefined;
    const matchedReelThemeFirst = validThemes.find(th => th.toLowerCase() === possibleCategory);
    const firstTokenIsEffect = !REEL_CATEGORIES.includes(possibleCategory as ReelCategory) && !possibleCategory.startsWith("http") && !matchedReelThemeFirst && CAMERA_EFFECT_TYPES.includes(possibleCategory as CameraEffectType);
    if (cleanedSubCmd === "" || REEL_CATEGORIES.includes(possibleCategory as ReelCategory) || possibleCategory.startsWith("http") || matchedReelThemeFirst || firstTokenIsEffect) {
      if (!brand.reels?.enabled) return;
      if (isReelRunning(brandId)) { await telegram.sendMessage(chatId, `⚠️ Already running`); return; }
      let reelTheme: Theme | undefined; let reelCategory: ReelCategory | undefined; let reelUrls: string[] | undefined; let reelCameraEffect: CameraEffectType | undefined;
      const urls = commandFlags.cleaned.match(/https?:\/\/\S+/g);
      if (urls) {
        reelUrls = urls.slice(0, 1);
        const nonUrlTokens = reelSubTokens.filter(t => !t.startsWith("http"));
        const urlCategory = nonUrlTokens.find(t => REEL_CATEGORIES.includes(t as ReelCategory));
        const urlEffect = nonUrlTokens.find(t => CAMERA_EFFECT_TYPES.includes(t as CameraEffectType));
        if (urlCategory) reelCategory = urlCategory as ReelCategory;
        if (urlEffect) reelCameraEffect = urlEffect as CameraEffectType;
      }
      else if (firstTokenIsEffect) {
        reelCameraEffect = possibleCategory as CameraEffectType;
      }
      else if (REEL_CATEGORIES.includes(possibleCategory as ReelCategory)) {
        reelCategory = possibleCategory as ReelCategory;
        if (possibleEffect && CAMERA_EFFECT_TYPES.includes(possibleEffect)) reelCameraEffect = possibleEffect;
      }
      else if (matchedReelThemeFirst) reelTheme = matchedReelThemeFirst as Theme;
      const effectLabel = reelCameraEffect ? ` · effect: ${reelCameraEffect}` : "";
      const categoryLabel = reelCategory ? ` · category: ${reelCategory}` : "";
      await telegram.sendMessage(chatId, `🎬 Generating reel — ${brand.name} (${manualUseStockImages === true ? "[-stock]" : "auto"}${categoryLabel}${effectLabel})`);
      ReelRunner.run(brandId, { theme: reelTheme, category: reelCategory, sourceUrls: reelUrls, categorySource: "manual" as const, useStockImages: manualUseStockImages, cameraEffect: reelCameraEffect, cameraPreset: commandFlags.cameraPreset, stage5Renderer: commandFlags.stage5Renderer, stage5Template: commandFlags.stage5Template }).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
      return;
    }

    await telegram.sendMessage(chatId, `⚠️ Unknown reel command. Try !help`);
    return;
  }

  const isThai = brand.language === "th";
  if (t.startsWith("voice") && !isStoryReelEnabled()) {
    await telegram.sendMessage(chatId, isThai ? "❌ คำสั่ง !voice ใช้ได้เฉพาะ StoryReel pipeline" : "❌ !voice commands are only available for the StoryReel pipeline");
    return;
  }

  if (t === "voice reset") {
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      await telegram.sendMessage(chatId, isThai ? "❌ ไม่พบโปรไฟล์" : "❌ No profile found");
      return;
    }
    queries.clearStoryProfileVoice(profile.id);
    await telegram.sendMessage(chatId, isThai ? "🔄 ล้างเสียงที่บันทึกไว้แล้ว — จะเลือกเสียงใหม่อัตโนมัติในการรันครั้งถัดไป" : "🔄 Saved voice cleared — a new voice will be auto-selected on the next run");
    return;
  }

  if (t.startsWith("voice set")) {
    const profile = queries.getStoryProfileByChatId(chatId);
    if (!profile) {
      await telegram.sendMessage(chatId, isThai ? "❌ ไม่พบโปรไฟล์" : "❌ No profile found");
      return;
    }
    const args = t.slice("voice set".length).trim();
    const providerMatch = args.match(/-p\s+(\S+)/);
    const idMatch = args.match(/-id\s+(\S+)/);
    if (!providerMatch && !idMatch) {
      await telegram.sendMessage(chatId, isThai ? "⚠️ ใช้: !voice set -p &lt;provider&gt; และ/หรือ -id &lt;id&gt;\nProvider ที่รองรับ: elevenlabs, botnoi" : "⚠️ Usage: !voice set -p &lt;provider&gt; and/or -id &lt;id&gt;\nSupported providers: elevenlabs, botnoi");
      return;
    }
    const newProvider = providerMatch?.[1];
    const newId = idMatch?.[1];
    const VALID_PROVIDERS = ["elevenlabs", "botnoi"];
    if (newProvider && !VALID_PROVIDERS.includes(newProvider)) {
      await telegram.sendMessage(chatId, isThai ? `❌ Provider "${newProvider}" ไม่รองรับ — ใช้: elevenlabs, botnoi` : `❌ Unknown provider "${newProvider}" — use: elevenlabs, botnoi`);
      return;
    }
    if (newId && !newProvider && !profile.preferredVoiceProvider) {
      await telegram.sendMessage(chatId, isThai ? "⚠️ กรุณาระบุ -p &lt;provider&gt; ด้วย — ยังไม่มี provider ที่บันทึกไว้" : "⚠️ Please also specify -p &lt;provider&gt; — no provider is currently saved");
      return;
    }
    const mergedProvider = (newProvider ?? profile.preferredVoiceProvider) as "elevenlabs" | "botnoi";
    let mergedId = newId ?? (newProvider ? null : profile.preferredVoiceId) ?? null;

    if (!mergedId) {
      // No ID provided — auto-search for the given provider
      await telegram.sendMessage(chatId, isThai ? `🔍 ค้นหาเสียงจาก ${mergedProvider}...` : `🔍 Searching for a voice from ${mergedProvider}...`);
      try {
        const defaultDirection = { tone: "authoritative" as const, pace: "medium" as const, style: "informative" as const, language_code: profile.audienceLanguage === "thai" ? "th" : "en", reason: "voice set command" };
        const found = mergedProvider === "botnoi"
          ? await selectBotnoiVoice(defaultDirection)
          : await selectSharedVoice(defaultDirection);
        mergedId = found.voiceId;
      } catch (err) {
        await telegram.sendMessage(chatId, isThai ? `❌ ค้นหาเสียงไม่สำเร็จ: ${err}` : `❌ Voice search failed: ${err}`);
        return;
      }
    }

    queries.updateStoryProfileVoice(profile.id, mergedId, mergedProvider);
    await telegram.sendMessage(chatId, isThai ? `✅ บันทึกเสียงแล้ว — provider: ${mergedProvider}, id: ${mergedId}` : `✅ Voice saved — provider: ${mergedProvider}, id: ${mergedId}`);
    return;
  }

  if (t !== "help" && t !== "status" && !t.startsWith("reel") && !t.startsWith("batch") && !t.startsWith("voice")) {
    await telegram.sendMessage(chatId, `❓ Unknown command "${raw}"`);
  }
}

export async function startCommandListeners(
  brandIds: BrandId[],
  telegram: TelegramService,
  line?: LineService,
): Promise<void> {
  const chatMap = new Map<string, BrandId>();
  for (const brandId of brandIds) {
    const brand = getBrand(brandId);
    const tgConfig = brand.channels?.telegram;
    if (!tgConfig?.enabled) continue;
    const chatId = process.env[tgConfig.chatIdEnvVar];
    if (chatId) chatMap.set(chatId, brandId);
  }

  if (chatMap.size > 0) {
    console.log(`[cmd-listener] listening on chats: ${[...chatMap.keys()].join(", ")}`);
    for (const [chatId, brandId] of chatMap) {
      (async () => {
        while (true) {
          try {
            for await (const msg of telegram.pollForReply(chatId, 0)) {
              handleCommand(brandId, chatId, msg, telegram).catch(err => console.error(`[cmd-listener] ${err.message}`));
            }
          } catch (err) { await new Promise(r => setTimeout(r, 5000)); }
        }
      })();
    }
  }

  if (!line) return;
  const lineGroupMap = new Map<string, BrandId>();
  for (const brandId of brandIds) {
    const brand = getBrand(brandId);
    const lineConfig = brand.channels?.line;
    if (lineConfig?.enabled) {
      const groupId = process.env[lineConfig.groupIdEnvVar];
      if (groupId) lineGroupMap.set(groupId, brandId);
    }
  }

  for (const [groupId, brandId] of lineGroupMap) {
    const sender: Sender = { sendMessage: (_id, text) => line.send(groupId, text) };
    (async () => {
      let offset = getLatestLineEventId(groupId) + 1;
      while (true) {
        try {
          for await (const msg of line.pollForReply(groupId, offset)) {
            offset = msg.updateId;
            handleCommand(brandId, groupId, msg.text, sender).catch(err => console.error(`[cmd-listener:line] ${err.message}`));
          }
        } catch (err) { await new Promise(r => setTimeout(r, 5000)); }
      }
    })();
  }
}

export async function startStoryReelListener(): Promise<void> {
  const token = getStoryReelBotToken();
  if (!token || !isStoryReelEnabled()) return;

  const { createTelegramServiceWithToken } = await import("../services/telegram.js");
  const bot = createTelegramServiceWithToken(token);
  console.log("[storyreel-listener] listening for StoryReel messages via dedicated bot");

  // Message loop
  (async () => {
    while (true) {
      try {
        for await (const msg of bot.pollForMessages()) {
          console.log(`[storyreel-listener] msg from ${msg.chatId}: "${msg.message.text?.slice(0, 40)}"`);
          handleStoryReelCommand(msg.chatId, msg.message, bot).catch(err => console.error(`[storyreel-listener] ${err.message}`));
        }
      } catch (err) { await new Promise(r => setTimeout(r, 5000)); }
    }
  })();

  // Callback query loop
  (async () => {
    while (true) {
      try {
        for await (const cbq of bot.pollForCallbackQueries()) {
          console.log(`[storyreel-cbq] from ${cbq.chatId}: "${cbq.data}"`);
          handleStoryReelCallback(cbq.chatId, cbq.id, cbq.data, bot, cbq.messageId).catch(err => console.error(`[storyreel-cbq] ${err.message}`));
        }
      } catch (err) { await new Promise(r => setTimeout(r, 5000)); }
    }
  })();
}
