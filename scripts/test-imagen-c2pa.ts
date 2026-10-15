import "dotenv/config";
import { Reader, Builder, LocalSigner } from "@contentauth/c2pa-node";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import { execSync } from "child_process";

async function main() {
  const apiKey = process.env.GEMINI_IMAGE_API_KEY;
  if (!apiKey) { console.error("GEMINI_IMAGE_API_KEY not set"); process.exit(1); }
  if (!process.env.C2PA_SIGN_CERT || !process.env.C2PA_SIGN_KEY) {
    console.error("C2PA_SIGN_CERT and C2PA_SIGN_KEY not set"); process.exit(1);
  }

  console.log("1. Generating Imagen image...");
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: "Generate a simple photo of a sunset over mountains",
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: "1K", aspectRatio: "1:1" },
    },
  });
  const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
  if (!part?.inlineData?.data) { console.error("No image in response"); process.exit(1); }
  const imgBuf = Buffer.from(part.inlineData.data, "base64");
  fs.writeFileSync("/tmp/test-c2pa-image.jpg", imgBuf);
  console.log(`   Image: ${imgBuf.length} bytes`);

  console.log("2. Reading C2PA manifest from image...");
  const reader = await Reader.fromAsset({ buffer: imgBuf, mimeType: "image/jpeg" });
  console.log(`   Active label: ${reader.activeLabel()}`);

  console.log("3. Building test video...");
  execSync(
    `ffmpeg -y -loop 1 -i /tmp/test-c2pa-image.jpg -t 2 -vf "scale=512:512" ` +
    `-c:v libx264 -pix_fmt yuv420p /tmp/test-c2pa-video.mp4 2>/dev/null`,
  );
  const videoBuf = fs.readFileSync("/tmp/test-c2pa-video.mp4");
  console.log(`   Video: ${videoBuf.length} bytes`);

  console.log("4. Signing video...");
  const signer = LocalSigner.newSigner(
    fs.readFileSync(process.env.C2PA_SIGN_CERT!),
    fs.readFileSync(process.env.C2PA_SIGN_KEY!),
    "es256",
  );
  const builder = Builder.new();
  builder.addIngredient(
    JSON.stringify({ title: "AI scene", relationship: "componentOf", format: "image/jpeg" }),
    { buffer: imgBuf, mimeType: "image/jpeg" },
  );
  builder.addAction(JSON.stringify({
    action: "c2pa.composed",
    description: "Assembled video from AI-generated images",
    digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  }));
  const dest: { buffer: Buffer | null } = { buffer: null };
  builder.sign(signer, { buffer: videoBuf, mimeType: "video/mp4" }, dest);
  if (!dest.buffer) { console.error("Signing failed"); process.exit(1); }
  fs.writeFileSync("/tmp/test-c2pa-signed.mp4", dest.buffer);
  console.log(`   Signed video: ${dest.buffer.length} bytes`);

  console.log("5. Verifying...");
  const verifyReader = await Reader.fromAsset({ buffer: dest.buffer, mimeType: "video/mp4" });
  const json = verifyReader.json();
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const parsed = JSON.parse(str);
  const urns = Object.keys(parsed.manifests);
  console.log(`   ${urns.length} manifests found:`);
  for (const urn of urns) {
    const m = parsed.manifests[urn];
    const issuer = m.signature_info?.issuer ?? "unknown";
    const actions = m.assertions?.find((a: any) => a.label?.includes("actions"))?.data?.actions ?? [];
    console.log(`   - ${issuer}: ${actions.map((a: any) => a.action).join(", ")}`);
  }
  console.log("\n✅ C2PA signing verified successfully");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
