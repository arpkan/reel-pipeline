import { describe, expect, it } from "vitest";
import { parseTelegramMessage } from "../src/services/telegram.js";

describe("reel manual source flow helpers", () => {
  it("maps telegram txt document payload to inbound message", () => {
    const parsed = parseTelegramMessage(99, {
      message_id: 1,
      date: 12345,
      chat: { id: 42 },
      document: {
        file_id: "abc123",
        file_name: "input.txt",
        mime_type: "text/plain",
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.message.document?.fileName).toBe("input.txt");
    expect(parsed?.message.document?.fileId).toBe("abc123");
  });
});
