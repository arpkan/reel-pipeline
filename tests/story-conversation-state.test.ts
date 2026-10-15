import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConversationState,
  getConversationState,
  setConversationState,
} from "../src/pipeline/story-conversation-state.js";

describe("ConversationStateStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    clearConversationState("chat-1");
  });

  it("returns null when no state exists", () => {
    expect(getConversationState("chat-1")).toBeNull();
  });

  it("stores and retrieves wizard state", () => {
    setConversationState("chat-1", { wizard: "setup", step: 1, data: {} });
    const state = getConversationState("chat-1");
    expect(state?.wizard).toBe("setup");
    expect(state?.step).toBe(1);
  });

  it("clears state", () => {
    setConversationState("chat-1", { wizard: "run", step: 1, data: {} });
    clearConversationState("chat-1");
    expect(getConversationState("chat-1")).toBeNull();
  });

  it("expires state after 10 minutes", () => {
    setConversationState("chat-1", { wizard: "setup", step: 2, data: { language: "thai" } });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(getConversationState("chat-1")).toBeNull();
  });

  it("does not expire before 10 minutes", () => {
    setConversationState("chat-1", { wizard: "music", step: 1, data: {} });
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(getConversationState("chat-1")).not.toBeNull();
  });

  it("preserves promptMessageId", () => {
    setConversationState("chat-1", { wizard: "cancel", step: 1, data: {}, promptMessageId: 42 });
    expect(getConversationState("chat-1")?.promptMessageId).toBe(42);
  });
});
