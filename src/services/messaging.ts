import type { BrandConfig } from "../types.js";
import type { TelegramService } from "./telegram.js";
import type { LineService } from "./line.js";

export interface MessagingChannel {
  name: string;   // "telegram" | "line"
  send(html: string): Promise<void>;
  pollForReply(offset: number, signal?: AbortSignal): AsyncGenerator<{ updateId: number; text: string }>;
}

export function getEnabledChannels(
  brand: BrandConfig,
  telegram: TelegramService,
  line: LineService | null,
): MessagingChannel[] {
  const channels: MessagingChannel[] = [];

  const tgConfig = brand.channels?.telegram;
  if (tgConfig?.enabled) {
    const chatId = process.env[tgConfig.chatIdEnvVar];
    if (!chatId) throw new Error(`${tgConfig.chatIdEnvVar} is not set`);
    channels.push({
      name: "telegram",
      send: (html) => telegram.sendMessage(chatId, html),
      pollForReply: (offset, signal) => telegram.pollForReply(chatId, offset, signal),
    });
  }

  const lineConfig = brand.channels?.line;
  if (lineConfig?.enabled) {
    if (!line) throw new Error("LINE is enabled for this brand but LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET are not set");
    const groupId = process.env[lineConfig.groupIdEnvVar];
    if (!groupId) throw new Error(`${lineConfig.groupIdEnvVar} is not set`);
    channels.push({
      name: "line",
      send: (html) => line.send(groupId, html),
      pollForReply: (offset, signal) => line.pollForReply(groupId, offset, signal),
    });
  }

  return channels;
}
