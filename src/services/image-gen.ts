import { GoogleGenAI, Type } from "@google/genai";
import type { ImageGenOptions } from "../types.js";

export class ImageSafetyError extends Error {
  constructor(public readonly originalPrompt: string) {
    super("IMAGE_SAFETY");
    this.name = "ImageSafetyError";
  }
}

export interface BatchImageResult {
  status: "SUCCEEDED" | "FAILED" | "EXPIRED";
  images: Map<string, Buffer>;
  totalWaitMs: number;
  perItemMs: number[];
}

interface BatchPrompt {
  key: string;
  prompt: string;
  aspectRatio?: string;
}

export class ImageGenService {
  private readonly client: GoogleGenAI | null = null;
  // private readonly modelId = "gemini-3-pro-image"; // Nano Banana Pro (higher quality)
  private readonly modelId = "gemini-3.1-flash-lite-image"; // Nano Banana 2 Lite (lowest cost/latency)

  get modelName(): string {
    return this.modelId;
  }

  private readonly batchModelId = "gemini-3.1-flash-lite-image";

  constructor(apiKey: string | undefined) {
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  async generate(prompt: string, options?: ImageGenOptions): Promise<{ buffer: Buffer; source: import("../types.js").ApiProvider }> {
    if (!this.client) throw new Error("GEMINI_IMAGE_API_KEY is not set");

    const aspectRatio = options?.aspectRatio ?? "1:1";
    const maxAttempts = 3;
    let lastError: Error = new Error("No image data in response");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = attempt * 5000;
        console.log(`    [image-gen] retry ${attempt}/${maxAttempts} in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await this.client!.models.generateContent({
        model: this.modelId,
        contents: prompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { imageSize: "1K", aspectRatio },
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        if (part.inlineData?.data) {
          const data = part.inlineData.data;
          const buffer = typeof data === "string" 
            ? Buffer.from(data, "base64") 
            : Buffer.from(data as Uint8Array);
          const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
          return { buffer: buf, source: "native" as const };
        }
      }

      const finishReason = candidate?.finishReason ?? "unknown";
      const textParts = parts.filter((p) => p.text).map((p) => p.text?.slice(0, 100)).join(" | ");
      console.log(`    [image-gen] attempt ${attempt} — no image. finishReason=${finishReason}${textParts ? ` text="${textParts}"` : ""}`);

      if (finishReason === "IMAGE_SAFETY") throw new ImageSafetyError(prompt);

      if (finishReason === "IMAGE_OTHER") throw new ImageSafetyError(prompt);

      lastError = new Error(`No image data in response (finishReason=${finishReason})`);
    }

    throw lastError;
  }

  async generateBatch(prompts: BatchPrompt[]): Promise<BatchImageResult> {
    if (prompts.length === 0) throw new Error("No prompts provided for batch");

    console.log(`  [image-batch] submitting ${prompts.length} image prompts...`);

    const requests = prompts.map((p) => ({
      key: p.key,
      request: {
        contents: [{ parts: [{ text: p.prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      },
    }));

    const jsonl = requests.map((r) => JSON.stringify(r)).join("\n");
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const file = new File([blob], "batch-image-requests.jsonl", { type: "application/jsonl" });

    const uploadedFile = await this.client!.files.upload({
      file,
      config: { mimeType: "jsonl" },
    });
    console.log(`  [image-batch] uploaded JSONL file: ${uploadedFile.name}`);

    const batchJob = await this.client!.batches.create({
      model: this.batchModelId,
      src: uploadedFile.name!,
      config: { displayName: `batch-images-${Date.now()}` },
    });
    console.log(`  [image-batch] batch job created: ${batchJob.name}`);

    const submitTime = Date.now();
    const completedStates = new Set([
      "JOB_STATE_SUCCEEDED",
      "JOB_STATE_FAILED",
      "JOB_STATE_CANCELLED",
      "JOB_STATE_EXPIRED",
    ]);

    let currentJob = await this.client!.batches.get({ name: batchJob.name! });
    let lastLogTime = submitTime;

    while (!completedStates.has((currentJob.state as string) ?? "")) {
      await new Promise((r) => setTimeout(r, 60_000));
      currentJob = await this.client!.batches.get({ name: batchJob.name! });

      const elapsed = Date.now() - submitTime;
      if (elapsed - lastLogTime >= 10 * 60_000) {
        console.log(`  [image-batch] polling... state=${currentJob.state} (${Math.round(elapsed / 60_000)}m elapsed)`);
        lastLogTime = elapsed;
      }
    }

    const totalWaitMs = Date.now() - submitTime;
    const state = currentJob.state as string;
    console.log(`  [image-batch] job finished: ${state} (${Math.round(totalWaitMs / 60_000)}m wait)`);

    if (state === "JOB_STATE_FAILED" || state === "JOB_STATE_CANCELLED" || state === "JOB_STATE_EXPIRED") {
      return { status: "FAILED", images: new Map(), totalWaitMs, perItemMs: [] };
    }

    const images = new Map<string, Buffer>();
    const perItemMs: number[] = [];
    const destFileName = (currentJob.dest as { fileName?: string })?.fileName;
    if (!destFileName) {
      console.error(`  [image-batch] no destination file in batch result`);
      return { status: "FAILED", images: new Map(), totalWaitMs, perItemMs };
    }

    const tmpResultPath = `/tmp/batch-result-${Date.now()}.jsonl`;
    await this.client!.files.download({ file: destFileName, downloadPath: tmpResultPath });
    const fs2 = await import("fs");
    const resultText = fs2.readFileSync(tmpResultPath, "utf-8");
    fs2.unlinkSync(tmpResultPath);

    let itemIdx = 0;
    for (const line of resultText.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          console.warn(`  [image-batch] error for key=${parsed.key ?? itemIdx}: ${JSON.stringify(parsed.error)}`);
          itemIdx++;
          continue;
        }
        const key = parsed.key ?? `item-${itemIdx}`;
        const parts = parsed.response?.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            const data = typeof part.inlineData.data === "string"
              ? Buffer.from(part.inlineData.data, "base64")
              : Buffer.from(part.inlineData.data as Uint8Array);
            images.set(key, data);
            perItemMs.push(Math.round(totalWaitMs / prompts.length));
            break;
          }
        }
      } catch (e) {
        console.warn(`  [image-batch] failed to parse result line: ${(e as Error).message}`);
      }
      itemIdx++;
    }

    console.log(`  [image-batch] retrieved ${images.size}/${prompts.length} images`);
    return { status: "SUCCEEDED", images, totalWaitMs, perItemMs };
  }
}

export function createImageGenService(): ImageGenService {
  const apiKey = process.env.GEMINI_IMAGE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_IMAGE_API_KEY is not set");
  return new ImageGenService(apiKey);
}
