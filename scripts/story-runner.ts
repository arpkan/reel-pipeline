import "dotenv/config";
import { fileURLToPath } from "node:url";
import { isStoryReelEnabled } from "../src/config.js";
import type { StoryReelAudienceLanguage } from "../src/storyreel/types.js";

export interface StoryRunnerCliArgs {
  chatId: string;
  profileName: string;
  language: StoryReelAudienceLanguage;
  audienceDescription: string;
  clipPaths: string[];
  note?: string;
}

interface StoryRunnerCliDeps {
  upsertStoryProfile?: (params: {
    telegramChatId: string;
    profileName: string;
    audienceLanguage: StoryReelAudienceLanguage;
    audienceDescription: string;
  }) => unknown;
  createRunner?: () => { runFromLocalClips(params: { chatId: string; clipPaths: string[]; note?: string; profile: unknown }): Promise<unknown> };
}

function usage(): string {
  return [
    "Usage: tsx scripts/story-runner.ts --chat-id <id> --profile-name <name> --language <thai|english|german> --audience <description> --clip <file> [--clip <file>...] [--note <note>]",
    "Set STORYREEL_ENABLED=true before running.",
  ].join("\n");
}

export function parseStoryRunnerArgs(argv: string[]): StoryRunnerCliArgs {
  let chatId = "local-storyreel";
  let profileName = "Local StoryReel";
  let language: StoryReelAudienceLanguage | undefined;
  let audienceDescription = "";
  let note: string | undefined;
  const clipPaths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--chat-id" && next) {
      chatId = next;
      i++;
    } else if (arg === "--profile-name" && next) {
      profileName = next;
      i++;
    } else if (arg === "--language" && next) {
      const value = next.toLowerCase();
      if (value !== "thai" && value !== "english" && value !== "german") throw new Error(`${usage()}\nInvalid language: ${next}`);
      language = value;
      i++;
    } else if (arg === "--audience" && next) {
      audienceDescription = next;
      i++;
    } else if (arg === "--clip" && next) {
      clipPaths.push(next);
      i++;
    } else if (arg === "--note" && next) {
      note = next;
      i++;
    } else {
      throw new Error(`${usage()}\nUnknown or incomplete argument: ${arg}`);
    }
  }

  if (!language) throw new Error(`${usage()}\n--language is required`);
  if (audienceDescription.trim().length < 20) throw new Error(`${usage()}\n--audience must be at least 20 characters`);
  if (clipPaths.length === 0) throw new Error(`${usage()}\nAt least one --clip is required`);
  if (clipPaths.length > 5) throw new Error(`${usage()}\nMax 5 clips per run`);

  return { chatId, profileName, language, audienceDescription, clipPaths, note };
}

export async function runStoryRunnerCli(argv: string[], deps: StoryRunnerCliDeps = {}): Promise<unknown> {
  if (!isStoryReelEnabled()) {
    throw new Error("StoryReel is disabled. Set STORYREEL_ENABLED=true to run this command.");
  }
  const args = parseStoryRunnerArgs(argv);
  const queries = deps.upsertStoryProfile ? null : await import("../src/db/queries.js");
  const upsertStoryProfile = deps.upsertStoryProfile ?? queries!.upsertStoryProfile;
  const profile = upsertStoryProfile({
    telegramChatId: args.chatId,
    profileName: args.profileName,
    audienceLanguage: args.language,
    audienceDescription: args.audienceDescription,
  });
  const runner = deps.createRunner?.() ?? (await import("../src/pipeline/story-runtime.js")).createProductionStoryRunner({
    async sendPhoto() {
      // Local runs still publish through GCS; no Telegram notification is needed for CLI smoke tests.
    },
  });

  return runner.runFromLocalClips({
    chatId: args.chatId,
    clipPaths: args.clipPaths,
    note: args.note,
    profile,
  });
}

async function main(): Promise<void> {
  try {
    const result = await runStoryRunnerCli(process.argv.slice(2));
    const storyId = typeof result === "object" && result && "storyId" in result ? String(result.storyId) : "unknown";
    console.log(`StoryReel finished: storyId=${storyId}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
