import fs from "fs";
import { Reader, Builder, LocalSigner } from "@contentauth/c2pa-node";
import type { ImageSource } from "../types.js";

interface SceneImage {
  path: string;
  sceneNumber: number;
  source: ImageSource;
}

export class C2paSigner {
  private signer: InstanceType<typeof LocalSigner> | null = null;

  private getSigner(): InstanceType<typeof LocalSigner> {
    if (this.signer) return this.signer;
    const certPath = process.env.C2PA_SIGN_CERT;
    const keyPath = process.env.C2PA_SIGN_KEY;
    if (!certPath || !keyPath) {
      throw new Error("C2PA_SIGN_CERT and C2PA_SIGN_KEY env vars must be set");
    }
    this.signer = LocalSigner.newSigner(
      fs.readFileSync(certPath),
      fs.readFileSync(keyPath),
      "es256",
    );
    return this.signer;
  }

  async signReel(
    videoBuffer: Buffer,
    sceneImages: SceneImage[],
  ): Promise<Buffer> {
    const aiScenes = sceneImages.filter((s) => s.source.type === "ai");
    if (aiScenes.length === 0) {
      return videoBuffer;
    }

    const signer = this.getSigner();
    const builder = Builder.new();

    for (const scene of aiScenes) {
      const imgBuf = fs.readFileSync(scene.path);
      const mimeType = detectImageMime(imgBuf);
      try {
        const reader = await Reader.fromAsset({ buffer: imgBuf, mimeType });
        builder.addIngredient(
          JSON.stringify({
            title: "AI scene",
            relationship: "componentOf",
            format: mimeType,
          }),
          { buffer: imgBuf, mimeType },
        );
      } catch (err) {
        console.warn(
          `  [c2pa] Could not read C2PA from scene ${scene.sceneNumber}: ${(err as Error).message}`,
        );
      }
    }

    builder.addAction(
      JSON.stringify({
        action: "c2pa.created",
        description: "Assembled video from AI-generated images and voiceover",
        digitalSourceType:
          "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
      }),
    );

    const dest: { buffer: Buffer | null } = { buffer: null };
    builder.sign(
      signer,
      { buffer: videoBuffer, mimeType: "video/mp4" },
      dest,
    );

    if (!dest.buffer) {
      throw new Error("C2PA signing produced no output");
    }

    return dest.buffer;
  }
}

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/jpeg";
}
