import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

export class BedrockService {
  private readonly client: AnthropicBedrock;
  private readonly modelId = process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-sonnet-5-5";
  private readonly effort = (process.env.BEDROCK_EFFORT ?? "low") as "low" | "medium" | "high";

  constructor() {
    const apiKey = process.env.BEDROCK_API_KEY;
    this.client = new AnthropicBedrock(
      apiKey
        ? { awsRegion: process.env.AWS_REGION ?? "eu-west-1", skipAuth: true, defaultHeaders: { Authorization: `Bearer ${apiKey}` } }
        : { awsRegion: process.env.AWS_REGION ?? "eu-west-1" },
    );
  }

  async converse(systemPrompt: string, userMessage: string): Promise<{ text: string; source: import("../types.js").ApiProvider }> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 16000,
      output_config: { effort: this.effort },
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    console.log(`[bedrock] tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens} (${this.modelId}, effort=${this.effort})`);

    if (response.stop_reason === "refusal") {
      throw new Error(`Bedrock refused (${response.stop_details?.category ?? "unknown"}): ${response.stop_details?.explanation ?? ""}`);
    }
    // Sonnet 5.5 may return thinking blocks before the text — read by type, not position
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (!text) throw new Error(`Empty text response from Bedrock (stop_reason=${response.stop_reason})`);
    if (response.stop_reason === "max_tokens") console.warn("[bedrock] ⚠️ hit max_tokens — output may be truncated");
    return { text, source: "native" };
  }
}

export function createBedrockService(): BedrockService {
  return new BedrockService();
}
