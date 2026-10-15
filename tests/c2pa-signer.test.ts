import "dotenv/config";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { X509Certificate } from "node:crypto";
import { describe, it, expect } from "vitest";

const certPath = process.env.C2PA_SIGN_CERT;
const keyPath = process.env.C2PA_SIGN_KEY;
const certsAvailable =
  !!certPath &&
  !!keyPath &&
  fs.existsSync(certPath) &&
  fs.existsSync(keyPath);

/**
 * Regression tests for the C2PA signing certificate.
 *
 * Root cause of the original bug: keys/c2pa-cert.pem was a self-signed cert
 * (CA:TRUE, issuer==subject). c2pa-rs rejects this at sign time in
 * check_certificate_profile (certificate_profile.rs:329) with
 * "the certificate was self-signed". The try/catch in the reel renderer
 * swallowed the error, so every video shipped without C2PA.
 *
 * Fix: use a CA + leaf cert pair. The leaf (CA:FALSE, digitalSignature,
 * emailProtection EKU) is signed by a private CA, so issuer != subject.
 */

function firstCertPem(filePath: string): string {
  const pem = fs.readFileSync(filePath, "utf8");
  const match = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (!match) throw new Error(`No PEM certificate found in ${filePath}`);
  return match[0];
}

describe("C2paSigner", () => {
  it("should export a class with a signReel method", async () => {
    const { C2paSigner } = await import("../src/services/c2pa-signer.js");
    const signer = new C2paSigner();
    expect(typeof signer.signReel).toBe("function");
  });

  describe("cert profile", () => {
    it.skipIf(!certsAvailable)(
      "signing cert must not be self-signed (issuer != subject)",
      () => {
        const cert = new X509Certificate(firstCertPem(certPath!));
        // c2pa-rs certificate_profile.rs:329 rejects is_ca && issuer==subject
        expect(cert.issuer).not.toBe(cert.subject);
      },
    );

    it.skipIf(!certsAvailable)(
      "signing cert must have digitalSignature key usage and emailProtection EKU",
      () => {
        const result = spawnSync("openssl", ["x509", "-in", certPath!, "-noout", "-text"], {
          encoding: "utf8",
        });
        const text = result.stdout ?? "";
        // KeyUsage: digitalSignature (required by certificate_profile.rs:426)
        expect(text).toContain("Digital Signature");
        // EKU: emailProtection (accepted by has_allowed_eku, certificate_trust_policy.rs:396)
        expect(text).toContain("E-mail Protection");
      },
    );
  });

  describe("end-to-end signing", () => {
    it.skipIf(!certsAvailable)(
      "embeds a readable C2PA manifest into a video",
      async () => {
        const { C2paSigner } = await import("../src/services/c2pa-signer.js");
        const { Reader } = await import("@contentauth/c2pa-node");

        const tmpDir = `/tmp/c2pa-test-${process.pid}-${Date.now()}`;
        fs.mkdirSync(tmpDir, { recursive: true });

        // Build a 1-second test video and a dummy scene image.
        const videoPath = path.join(tmpDir, "test.mp4");
        const imagePath = path.join(tmpDir, "scene1.png");
        spawnSync(
          "ffmpeg",
          ["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath],
          { stdio: "ignore" },
        );
        spawnSync(
          "ffmpeg",
          ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", imagePath],
          { stdio: "ignore" },
        );

        const videoBuffer = fs.readFileSync(videoPath);
        const signer = new C2paSigner();

        // signReel skips when there are no AI scenes, so pass one.
        const signed = await signer.signReel(videoBuffer, [
          {
            path: imagePath,
            sceneNumber: 1,
            source: { type: "ai", model: "test", provider: "test" },
          },
        ]);

        // Signed buffer must differ (manifest embedded) and be larger.
        expect(signed).not.toBe(videoBuffer);
        expect(signed.length).toBeGreaterThan(videoBuffer.length);

        // Manifest must be readable.
        const reader = await Reader.fromAsset({ buffer: signed, mimeType: "video/mp4" });
        const json = reader.json();
        const str = typeof json === "string" ? json : JSON.stringify(json);
        const parsed = JSON.parse(str);
        const urns = Object.keys(parsed.manifests ?? {});
        expect(urns.length).toBeGreaterThanOrEqual(1);

        // Must contain the c2pa.actions assertion (our c2pa.created action).
        const manifest = parsed.manifests[urns[0]];
        const labels = (manifest.assertions ?? []).map((a: { label: string }) => a.label);
        expect(labels).toContain("c2pa.actions.v2");

        fs.rmSync(tmpDir, { recursive: true, force: true });
      },
    );
  });
});
