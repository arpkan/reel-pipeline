import type { ImageGenOptions } from "../types.js";
import { ImageSafetyError } from "./image-gen.js";

export class AzureImageGenService {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;
  private readonly apiVersion: string;

  readonly modelName: string;

  constructor() {
    this.endpoint = (process.env.AZURE_FOUNDRY_ENDPOINT ?? "").replace(/\/$/, "");
    this.apiKey = process.env.AZURE_FOUNDRY_API_KEY ?? "";
    this.deployment = process.env.AZURE_FOUNDRY_DEPLOYMENT ?? "gpt-image-2";
    this.apiVersion = process.env.AZURE_FOUNDRY_API_VERSION ?? "2025-04-01-preview";
    this.modelName = this.deployment;

    if (!this.endpoint) throw new Error("AZURE_FOUNDRY_ENDPOINT is not set");
    if (!this.apiKey) throw new Error("AZURE_FOUNDRY_API_KEY is not set");
  }

  async generate(prompt: string, _options?: ImageGenOptions): Promise<{ buffer: Buffer; source: import("../types.js").ApiProvider }> {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/images/generations?api-version=${this.apiVersion}`;

    const body = {
      prompt,
      n: 1,
      size: "1024x1792",
      quality: process.env.AZURE_IMAGE_QUALITY ?? "medium",
      output_format: "png",
    };

    const maxAttempts = 3;
    let lastError: Error = new Error("No image data in response");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = attempt * 5000;
        console.log(`    [azure-image] retry ${attempt}/${maxAttempts} in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        // Content policy / safety refusal
        if (res.status === 400) {
          let parsed: { error?: { code?: string; message?: string } } = {};
          try { parsed = JSON.parse(text); } catch { /* ignore */ }
          if (parsed.error?.code === "contentFilter" || parsed.error?.code === "content_policy_violation") {
            throw new ImageSafetyError(prompt);
          }
        }
        lastError = new Error(`Azure image gen HTTP ${res.status}: ${text.slice(0, 300)}`);
        console.log(`    [azure-image] attempt ${attempt} — HTTP ${res.status}`);
        continue;
      }

      const json = await res.json() as { data?: Array<{ b64_json?: string }> };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) {
        lastError = new Error("No b64_json in Azure image response");
        console.log(`    [azure-image] attempt ${attempt} — no image data`);
        continue;
      }

      const buffer = Buffer.from(b64, "base64");
      console.log(`    [azure-image] ✓ ${Math.round(buffer.length / 1024)} KB`);
      return { buffer, source: "azure" as import("../types.js").ApiProvider };
    }

    throw lastError;
  }
}

export function createAzureImageGenService(): AzureImageGenService {
  return new AzureImageGenService();
}
