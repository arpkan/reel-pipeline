import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { BedrockService } = await import("../src/services/bedrock.js");

function reply(content: unknown[], stop_reason = "end_turn", stop_details: unknown = null) {
  return { content, stop_reason, stop_details, usage: { input_tokens: 10, output_tokens: 20 } };
}

describe("BedrockService.converse", () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_EFFORT;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns the text when a thinking block comes first", async () => {
    createMock.mockResolvedValue(reply([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: '{"title":"ok"}' },
    ]));
    const { text, source } = await new BedrockService().converse("sys", "msg");
    expect(text).toBe('{"title":"ok"}');
    expect(source).toBe("native");
  });

  it("sends Sonnet 5.5, low effort and 16000 max_tokens by default", async () => {
    createMock.mockResolvedValue(reply([{ type: "text", text: "hi" }]));
    await new BedrockService().converse("sys", "msg");
    const params = createMock.mock.calls[0][0];
    expect(params.model).toBe("eu.anthropic.claude-sonnet-5-5");
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.max_tokens).toBe(16000);
    expect(params.thinking).toBeUndefined();
  });

  it("honours BEDROCK_MODEL_ID and BEDROCK_EFFORT overrides", async () => {
    process.env.BEDROCK_MODEL_ID = "eu.anthropic.claude-sonnet-4-6";
    process.env.BEDROCK_EFFORT = "medium";
    createMock.mockResolvedValue(reply([{ type: "text", text: "hi" }]));
    await new BedrockService().converse("sys", "msg");
    const params = createMock.mock.calls[0][0];
    expect(params.model).toBe("eu.anthropic.claude-sonnet-4-6");
    expect(params.output_config).toEqual({ effort: "medium" });
  });

  it("throws with the category on a refusal", async () => {
    createMock.mockResolvedValue(reply([], "refusal", { type: "refusal", category: "general_harms", explanation: "nope" }));
    await expect(new BedrockService().converse("sys", "msg")).rejects.toThrow(/refused \(general_harms\)/);
  });

  it("throws when there is no text block", async () => {
    createMock.mockResolvedValue(reply([{ type: "thinking", thinking: "", signature: "sig" }]));
    await expect(new BedrockService().converse("sys", "msg")).rejects.toThrow(/Empty text response/);
  });
});
