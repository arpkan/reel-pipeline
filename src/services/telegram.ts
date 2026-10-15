import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export interface TelegramMessage {
  updateId: number;
  messageId: number;
  text: string;
  date: number;
  chatTitle?: string;
  chatType?: string;
  chatUsername?: string;
  document?: {
    fileId: string;
    fileName?: string;
    mimeType?: string;
  };
  video?: {
    fileId: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    duration?: number;
    width?: number;
    height?: number;
  };
}

export interface TelegramChatMessage {
  chatId: string;
  message: TelegramMessage;
}

export interface TelegramCallbackQueryEvent {
  id: string;
  data: string;
  chatId: string;
  messageId: number;
}

interface TelegramUpdateMessage {
  message_id: number;
  text?: string;
  date: number;
  chat: { id: number; type?: string; title?: string; username?: string };
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
  };
  video?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    duration?: number;
    width?: number;
    height?: number;
  };
}

export function parseTelegramMessage(updateId: number, msg: TelegramUpdateMessage): { chatId: string; message: TelegramMessage } | null {
  if (!msg.text && !msg.document && !msg.video) return null;
  return {
    chatId: String(msg.chat.id),
      message: {
      updateId,
      messageId: msg.message_id,
        text: (msg.text ?? "").trim(),
        date: msg.date,
        chatTitle: msg.chat.title,
        chatType: msg.chat.type,
        chatUsername: msg.chat.username,
      document: msg.document
        ? {
            fileId: msg.document.file_id,
            fileName: msg.document.file_name,
            mimeType: msg.document.mime_type,
          }
        : undefined,
      video: msg.video
        ? {
            fileId: msg.video.file_id,
            fileName: msg.video.file_name,
            mimeType: msg.video.mime_type,
            fileSize: msg.video.file_size,
            duration: msg.video.duration,
            width: msg.video.width,
            height: msg.video.height,
          }
        : undefined,
    },
  };
}

export class TelegramService {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly emitter = new EventEmitter();
  private globalOffset = 0;
  private pollingStarted = false;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.emitter.setMaxListeners(100);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        });
        if (!response.ok) {
          throw new Error(`Telegram sendMessage failed: ${response.status}`);
        }
        return;
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Telegram sendMessage failed");
  }

  async sendMessageWithId(chatId: string, text: string): Promise<number | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (!response.ok) return null;
      const data = await response.json() as { ok: boolean; result?: { message_id: number } };
      return data.result?.message_id ?? null;
    } catch {
      return null;
    }
  }

  async sendPhoto(chatId: string, buffer: Buffer, caption: string): Promise<void> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    form.set("photo", new Blob([buffer]), "thumbnail.jpg");
    const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram sendPhoto failed: ${response.status}${body ? ` ${body}` : ""}`);
    }
  }

  async sendPhotoWithButtons(
    chatId: string,
    buffer: Buffer,
    caption: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<void> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    form.set("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
    form.set("photo", new Blob([buffer]), "thumbnail.jpg");
    const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram sendPhoto failed: ${response.status}${body ? ` ${body}` : ""}`);
    }
  }

  async sendDocument(chatId: string, buffer: Buffer, filename: string, caption: string): Promise<void> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    form.set("document", new Blob([buffer]), filename);
    const response = await fetch(`${this.baseUrl}/sendDocument`, { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram sendDocument failed: ${response.status}${body ? ` ${body}` : ""}`);
    }
  }

  async editMessage(chatId: string, messageId: number, text: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
    } catch {
      // non-fatal — progress edit failures are best-effort
    }
  }

  async sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<{ messageId: number } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons },
        }),
      });
      if (!response.ok) return null;
      const data = await response.json() as { ok: boolean; result?: { message_id: number } };
      return data.result?.message_id != null ? { messageId: data.result.message_id } : null;
    } catch {
      return null;
    }
  }

  async editMessageWithButtons(
    chatId: string,
    messageId: number,
    text: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons },
        }),
      });
    } catch {
      // non-fatal
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
      });
    } catch {
      // non-fatal
    }
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      });
    } catch {
      // non-fatal
    }
  }

  async downloadTextFile(fileId: string): Promise<string> {
    const fileResponse = await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!fileResponse.ok) {
      throw new Error(`Telegram getFile failed: ${fileResponse.status}`);
    }
    const fileData = await fileResponse.json() as { ok: boolean; result?: { file_path?: string } };
    const filePath = fileData.result?.file_path;
    if (!filePath) throw new Error("Telegram file_path missing");

    const contentResponse = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!contentResponse.ok) {
      throw new Error(`Telegram file download failed: ${contentResponse.status}`);
    }
    return await contentResponse.text();
  }

  async downloadVideoFile(fileId: string, destination: string): Promise<void> {
    const fileResponse = await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!fileResponse.ok) {
      throw new Error(`Telegram getFile failed: ${fileResponse.status}`);
    }
    const fileData = await fileResponse.json() as { ok: boolean; result?: { file_path?: string } };
    const filePath = fileData.result?.file_path;
    if (!filePath) throw new Error("Telegram file_path missing");

    const contentResponse = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!contentResponse.ok) {
      throw new Error(`Telegram file download failed: ${contentResponse.status}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const bytes = Buffer.from(await contentResponse.arrayBuffer());
    fs.writeFileSync(destination, bytes);
  }

  // Start the single shared getUpdates loop (idempotent).
  // Always fast-forwards to the current position first so old messages are never replayed.
  private startPolling(): void {
    if (this.pollingStarted) return;
    this.pollingStarted = true;

    (async () => {
      // Fast-forward to current position before entering long-poll loop
      try {
        const res = await fetch(`${this.baseUrl}/getUpdates?timeout=0&limit=1&offset=-1`);
        const data = await res.json() as { result: Array<{ update_id: number }> };
        if (data.result.length > 0) {
          this.globalOffset = data.result[data.result.length - 1].update_id + 1;
        }
      } catch {
        // non-fatal — will start from 0 and flush old messages quickly
      }
      console.log(`[telegram] poll loop started from offset ${this.globalOffset}`);
      while (true) {
        try {
          const url = `${this.baseUrl}/getUpdates?timeout=60&offset=${this.globalOffset}`;
          const response = await fetch(url);

          if (!response.ok) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const data = await response.json() as {
            ok: boolean;
            result: Array<{
              update_id: number;
              message?: TelegramUpdateMessage;
              callback_query?: {
                id: string;
                data?: string;
                message?: { chat: { id: number }; message_id: number };
              };
            }>;
          };

          for (const update of data.result ?? []) {
            this.globalOffset = update.update_id + 1;
            const msg = update.message;
            if (msg) {
              const parsed = parseTelegramMessage(update.update_id, msg);
              if (parsed) {
                this.emitter.emit(`msg:${parsed.chatId}`, parsed.message);
                this.emitter.emit("msg:*", parsed);
              }
            }
            const cbq = update.callback_query;
            if (cbq?.message) {
              const event: TelegramCallbackQueryEvent = {
                id: cbq.id,
                data: cbq.data ?? "",
                chatId: String(cbq.message.chat.id),
                messageId: cbq.message.message_id,
              };
              this.emitter.emit("cbq:*", event);
            }
          }
        } catch (err) {
          console.error("[telegram] poll loop error, retrying in 5s:", err instanceof Error ? err.message : err);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();
  }

  // Subscribe to messages for a specific chat. The initialOffset is only used to
  // seed the global polling loop if it hasn't started yet; once the loop is running
  // all subscribers receive new messages from the current position.
  async *pollForReply(
    chatId: string,
    _initialOffset: number,
    signal?: AbortSignal,
  ): AsyncGenerator<TelegramMessage> {
    if (!this.pollingStarted) {
      this.startPolling();
    }

    const queue: TelegramMessage[] = [];
    let wake: (() => void) | null = null;

    const handler = (msg: TelegramMessage) => {
      queue.push(msg);
      const fn = wake;
      wake = null;
      fn?.();
    };

    this.emitter.on(`msg:${chatId}`, handler);

    try {
      while (!signal?.aborted) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      this.emitter.off(`msg:${chatId}`, handler);
    }
  }

  async *pollForMessages(signal?: AbortSignal): AsyncGenerator<TelegramChatMessage> {
    if (!this.pollingStarted) {
      this.startPolling();
    }

    const queue: TelegramChatMessage[] = [];
    let wake: (() => void) | null = null;

    const handler = (msg: TelegramChatMessage) => {
      queue.push(msg);
      const fn = wake;
      wake = null;
      fn?.();
    };

    this.emitter.on("msg:*", handler);

    try {
      while (!signal?.aborted) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      this.emitter.off("msg:*", handler);
    }
  }

  async *pollForCallbackQueries(signal?: AbortSignal): AsyncGenerator<TelegramCallbackQueryEvent> {
    if (!this.pollingStarted) {
      this.startPolling();
    }

    const queue: TelegramCallbackQueryEvent[] = [];
    let wake: (() => void) | null = null;

    const handler = (event: TelegramCallbackQueryEvent) => {
      queue.push(event);
      const fn = wake;
      wake = null;
      fn?.();
    };

    this.emitter.on("cbq:*", handler);

    try {
      while (!signal?.aborted) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      this.emitter.off("cbq:*", handler);
    }
  }
}

// Module-level singleton — all callers share one getUpdates loop
let _instance: TelegramService | null = null;

export function createTelegramService(): TelegramService {
  if (!_instance) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    _instance = new TelegramService(token);
  }
  return _instance;
}

export function createTelegramServiceWithToken(token: string): TelegramService {
  return new TelegramService(token);
}
