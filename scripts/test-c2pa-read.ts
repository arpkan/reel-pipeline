import "dotenv/config";
import { Reader, Builder, LocalSigner } from "@contentauth/c2pa-node";
import fs from "fs";
import { execSync } from "child_process";

async function main() {
  const imgBuf = fs.readFileSync("/tmp/test-imagen-output.jpg");
  const imgReader = await Reader.fromAsset({ buffer: imgBuf, mimeType: "image/jpeg" });
  console.log("Source manifest OK:", imgReader.activeLabel());

  execSync(`ffmpeg -y -loop 1 -i /tmp/test-imagen-output.jpg -t 2 -vf "scale=512:512" -c:v libx264 -pix_fmt yuv420p /tmp/test-video.mp4 2>/dev/null`);
  const videoBuf = fs.readFileSync("/tmp/test-video.mp4");
  console.log("Test video:", videoBuf.length, "bytes");

  const sampleDir = "/tmp/c2patool/sample";
  const signer = LocalSigner.newSigner(
    fs.readFileSync(`${sampleDir}/es256_certs.pem`),
    fs.readFileSync(`${sampleDir}/es256_private.key`),
    "es256"
  );

  const builder = Builder.new();
  
  const ingredientJson = JSON.stringify({
    title: "AI-generated scene image",
    relationship: "componentOf",
    format: "image/jpeg"
  });
  await builder.addIngredient(ingredientJson, { buffer: imgBuf, mimeType: "image/jpeg" });
  
  builder.addAction(JSON.stringify({
    action: "c2pa.composed",
    description: "Assembled video from AI-generated images",
    digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
  }));

  const dest: { buffer: Buffer | null } = { buffer: null };
  builder.sign(signer, { buffer: videoBuf, mimeType: "video/mp4" }, dest);
  
  if (!dest.buffer) throw new Error("No output buffer");
  fs.writeFileSync("/tmp/test-video-c2pa.mp4", dest.buffer);
  console.log("Signed video:", dest.buffer.length, "bytes");

  const verifyReader = await Reader.fromAsset({ buffer: dest.buffer, mimeType: "video/mp4" });
  const json = verifyReader.json();
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  console.log(str.slice(0, 6000));
}

main().catch(e => { console.error("ERROR:", e.message?.slice(0, 800)); process.exit(1); });
