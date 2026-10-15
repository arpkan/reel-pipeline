import crypto from "crypto";
import { getLineEventsAfter } from "../db/queries.js";

export class LineService {
  constructor(
    private readonly channelAccessToken: string,
    private readonly channelSecret: string,
  ) {}

  verifySignature(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHmac("sha256", this.channelSecret)
      .update(rawBody)
      .digest("base64");
    return expected === signature;
  }

  async send(groupId: string, html: string): Promise<void> {
    // Convert HTML to plain text — LINE doesn't support HTML formatting
    const plain = html
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2\n$1")  // <a href="url">text</a> → text\nurl
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: plain }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LINE push failed: ${response.status} ${body}`);
    }
  }

  async *pollForReply(
    groupId: string,
    offset: number,
    signal?: AbortSignal,
  ): AsyncGenerator<{ updateId: number; text: string }> {
    let currentOffset = offset;

    while (!signal?.aborted) {
      const events = getLineEventsAfter(groupId, currentOffset);
      for (const event of events) {
        currentOffset = event.id + 1;
        yield { updateId: event.id, text: event.text };
      }
      // Poll DB every second
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export function createLineService(): LineService | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!token || !secret) return null;
  return new LineService(token, secret);
}
