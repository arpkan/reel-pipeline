import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramService } from "../src/services/telegram.js";

describe("TelegramService.sendMessage", () => {
  const chatId = "-100123";
  const text = "hello";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries once on transient fetch failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await expect(telegram.sendMessage(chatId, text)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("TelegramService.sendPhoto", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("includes Telegram response details when sendPhoto fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"ok":false,"description":"Bad Request: failed to get HTTP URL content"}',
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await expect(telegram.sendPhoto("-100123", Buffer.from("image"), "caption"))
      .rejects.toThrow("Telegram sendPhoto failed: 400 {\"ok\":false,\"description\":\"Bad Request: failed to get HTTP URL content\"}");
  });
});

describe("TelegramService.sendPhotoWithButtons", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads a photo with URL buttons", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await telegram.sendPhotoWithButtons("-100123", Buffer.from("image"), "Ready", [[
      { text: "View", url: "https://example.com/video.mp4" },
      { text: "Download", url: "https://example.com/video.mp4" },
    ]]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sendPhoto"),
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("reply_markup")).toBe(JSON.stringify({
      inline_keyboard: [[
        { text: "View", url: "https://example.com/video.mp4" },
        { text: "Download", url: "https://example.com/video.mp4" },
      ]],
    }));
  });
});

describe("TelegramService.sendDocument", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads a document with caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await telegram.sendDocument("-100123", Buffer.from("video"), "video.mp4", "Download/share this video");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sendDocument"),
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
});

describe("TelegramService.pollForMessages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("yields messages from any chat so a dedicated bot can discover new groups", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [
            {
              update_id: 10,
              message: {
                message_id: 20,
                text: "!setup DogWalks english People who want practical dog walking videos",
                date: 1,
                chat: { id: -100123 },
              },
            },
          ],
        }),
      } as Response)
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const telegram = new TelegramService("token");
    const iterator = telegram.pollForMessages(controller.signal);

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        chatId: "-100123",
        message: expect.objectContaining({ text: "!setup DogWalks english People who want practical dog walking videos" }),
      }),
    });

    controller.abort();
    await iterator.return?.(undefined);
  });

  it("preserves Telegram chat metadata for admin approval messages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [
            {
              update_id: 11,
              message: {
                message_id: 21,
                text: "!setup DogWalks english People who want practical dog walking videos",
                date: 1,
                chat: { id: -100123, type: "supergroup", title: "Dog Walkers Berlin", username: "dogwalkersberlin" },
              },
            },
          ],
        }),
      } as Response)
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const telegram = new TelegramService("token");
    const iterator = telegram.pollForMessages(controller.signal);

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        chatId: "-100123",
        message: expect.objectContaining({
          chatTitle: "Dog Walkers Berlin",
          chatType: "supergroup",
          chatUsername: "dogwalkersberlin",
        }),
      }),
    });

    controller.abort();
    await iterator.return?.(undefined);
  });
});

describe("TelegramService.sendMessageWithButtons", () => {
  it("sends inline keyboard with callback_data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 99 } }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    const result = await telegram.sendMessageWithButtons("-100123", "Choose:", [
      [{ text: "Option A", callback_data: "wizard:a" }],
      [{ text: "Option B", callback_data: "wizard:b" }],
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reply_markup.inline_keyboard).toHaveLength(2);
    expect(result).toEqual({ messageId: 99 });
  });
});

describe("TelegramService.answerCallbackQuery", () => {
  it("calls answerCallbackQuery API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await telegram.answerCallbackQuery("cbq-id-123");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.callback_query_id).toBe("cbq-id-123");
  });
});

describe("TelegramService.deleteMessage", () => {
  it("calls deleteMessage API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const telegram = new TelegramService("token");
    await telegram.deleteMessage("-100123", 55);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe("-100123");
    expect(body.message_id).toBe(55);
  });
});

describe("TelegramService.pollForCallbackQueries", () => {
  it("yields callback_query updates from the polling loop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [
            {
              update_id: 20,
              callback_query: {
                id: "cbq-1",
                data: "setup:lang:thai",
                message: { chat: { id: -100123 }, message_id: 5 },
              },
            },
          ],
        }),
      } as Response)
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const telegram = new TelegramService("token");
    const iterator = telegram.pollForCallbackQueries(controller.signal);

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        id: "cbq-1",
        data: "setup:lang:thai",
        chatId: "-100123",
        messageId: 5,
      }),
    });

    controller.abort();
    await iterator.return?.(undefined);
  });
});
