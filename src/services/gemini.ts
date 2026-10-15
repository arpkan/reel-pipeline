import { GoogleGenAI, ThinkingLevel, type FunctionDeclaration, type Content } from "@google/genai";

const MAX_RETRIES = 3;
const RETRYABLE_CODES = new Set([503, 429, 500]);

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.error?.code ?? err?.status ?? err?.statusCode;
      const status = err?.error?.status ?? err?.status;
      const isRetryable = RETRYABLE_CODES.has(code) || status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED";
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      const delay = attempt * 10_000 + Math.random() * 5_000;
      console.warn(`[${label}] retryable error (code=${code} status=${status}), retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export class GeminiService {
  private readonly client: GoogleGenAI | null = null;
  private readonly modelId = "gemini-3.6-flash";
  private readonly azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  private readonly azureApiKey = process.env.AZURE_OPENAI_API_KEY;
  private readonly azureApiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  private readonly azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT55 ?? "gpt-5.5";

  constructor(apiKey: string | undefined) {
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  async generate(systemPrompt: string, userMessage: string): Promise<{ text: string; source: import("../types.js").ApiProvider }> {
    const provider = (process.env.URL_CLASSIFIER_PROVIDER ?? "gemini").toLowerCase();
    if (provider === "azure_gpt55" || provider === "gpt55") {
      const text = await this.generateWithAzure(systemPrompt, userMessage);
      return { text, source: "azure" };
    }

    if (!this.client) throw new Error("GEMINI_API_KEY is not set");

    const resultText = await withRetry(async () => {
      const response = await this.client!.models.generateContent({
        model: this.modelId,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 8192,
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false },
        },
        contents: userMessage,
      });

      const candidate = response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const parts = candidate?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("");
      if (!text) throw new Error(`Empty response from Gemini (finishReason=${finishReason}). Full response: ${JSON.stringify(response)}`);
      if (finishReason && finishReason !== "STOP") {
        console.warn(`[gemini] finishReason=${finishReason} — response may be incomplete`);
      }
      return text;
    }, "gemini");
    return { text: resultText, source: "native" };
  }

  private async generateWithAzure(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.azureEndpoint || !this.azureApiKey) {
      throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set when URL_CLASSIFIER_PROVIDER=azure_gpt55");
    }

    const url = this.buildAzureChatUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.azureApiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_completion_tokens: 8192,
      }),
    });

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(`Azure GPT-5.5 request failed: ${response.status} ${data.error?.message ?? response.statusText}`);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Azure GPT-5.5 returned empty response");
    return text;
  }

  private buildAzureChatUrl(): string {
    if (!this.azureEndpoint) throw new Error("AZURE_OPENAI_ENDPOINT is not set");
    const base = this.azureEndpoint.endsWith("/") ? this.azureEndpoint.slice(0, -1) : this.azureEndpoint;
    return `${base}/openai/deployments/${this.azureDeployment}/chat/completions?api-version=${encodeURIComponent(this.azureApiVersion)}`;
  }

  /**
   * Agentic loop with function calling.
   */
  async agentic(
    systemPrompt: string,
    userMessage: string,
    tools: FunctionDeclaration[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    terminalTool: string,
    maxTurns = 10,
  ): Promise<{ result: Record<string, unknown>; source: import("../types.js").ApiProvider }> {
    const provider = (process.env.DISCOVERY_PROVIDER ?? "gemini").toLowerCase();
    if (provider === "azure_gpt55" || provider === "gpt55") {
      return this.agenticWithAzure(systemPrompt, userMessage, tools, toolExecutor, terminalTool, maxTurns);
    }

    const contents: Content[] = [
      { role: "user", parts: [{ text: userMessage }] },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      if (!this.client) throw new Error("GEMINI_API_KEY is not set");
      const response = await this.client.models.generateContent({
        model: this.modelId,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false },
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: "ANY" as never } },
        },
        contents,
      });
      const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];

      // Add model turn to history
      contents.push({ role: "model", parts });

      const functionCalls = parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) {
        throw new Error(`Gemini agentic loop ended without calling ${terminalTool}`);
      }

      // Check for terminal tool call first
      const terminal = functionCalls.find((p) => p.functionCall?.name === terminalTool);
      if (terminal?.functionCall) {
        return { result: terminal.functionCall.args as Record<string, unknown>, source: "native" as const };
      }

      // Execute all non-terminal tool calls and collect responses
      const functionResponseParts: Content["parts"] = [];
      for (const part of functionCalls) {
        const fnCall = part.functionCall!;
        const name = fnCall.name ?? "unknown";
        const args = fnCall.args ?? {};
        let result: unknown;
        try {
          result = await toolExecutor(name, args as Record<string, unknown>);
        } catch (err) {
          if (err instanceof Error && err.message.includes("quota exhausted")) throw err;
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        functionResponseParts.push({
          functionResponse: { name: name!, response: { result } },
        });
      }

      contents.push({ role: "user", parts: functionResponseParts });
    }

    throw new Error(`Gemini agentic loop exceeded ${maxTurns} turns without calling ${terminalTool}`);
  }

  private async agenticWithAzure(
    systemPrompt: string,
    userMessage: string,
    tools: FunctionDeclaration[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    terminalTool: string,
    maxTurns: number,
  ): Promise<{ result: Record<string, unknown>; source: import("../types.js").ApiProvider }> {
    if (!this.azureEndpoint || !this.azureApiKey) {
      throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set when DISCOVERY_PROVIDER=azure_gpt55");
    }

    type AzureChatMessage =
      | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
      | { role: "tool"; content: string; tool_call_id: string };

    const messages: AzureChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const azureTools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await fetch(this.buildAzureChatUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.azureApiKey,
        },
        body: JSON.stringify({
          messages,
          tools: azureTools,
          tool_choice: "auto",
          max_completion_tokens: 4096,
        }),
      });

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            role?: "assistant";
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(`Azure GPT-5.5 agentic request failed: ${response.status} ${data.error?.message ?? response.statusText}`);
      }

      const message = data.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: toolCalls });

      if (toolCalls.length === 0) {
        throw new Error(`Azure GPT-5.5 agentic loop ended without calling ${terminalTool}`);
      }

      const terminalCall = toolCalls.find((call) => call.function?.name === terminalTool);
      if (terminalCall) {
        try {
          const parsed = JSON.parse(terminalCall.function.arguments || "{}");
          return { result: parsed as Record<string, unknown>, source: "azure" };
        } catch {
          throw new Error(`Azure GPT-5.5 returned invalid JSON arguments for ${terminalTool}`);
        }
      }

      for (const call of toolCalls) {
        const name = call.function?.name;
        if (!name) continue;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        let result: unknown;
        try {
          result = await toolExecutor(name, args);
        } catch (err) {
          if (err instanceof Error && err.message.includes("quota exhausted")) throw err;
          result = { error: err instanceof Error ? err.message : String(err) };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ result }),
        });
      }
    }

    throw new Error(`Azure GPT-5.5 agentic loop exceeded ${maxTurns} turns without calling ${terminalTool}`);
  }
}

export function createGeminiService(): GeminiService {
  const apiKey = process.env.GEMINI_API_KEY;
  return new GeminiService(apiKey);
}
