import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";

export class GcsService {
  private readonly storage: Storage;
  private readonly bucket: string;

  constructor(bucket: string) {
    this.storage = new Storage(); // uses GOOGLE_APPLICATION_CREDENTIALS
    this.bucket = bucket;
  }

  async uploadImage(gcsPrefix: string, runId: string, filename: string, buffer: Buffer): Promise<string> {
    const path = `${gcsPrefix}/${runId}/${filename}`;
    const file = this.storage.bucket(this.bucket).file(path);
    await file.save(buffer, { contentType: "image/png", metadata: { cacheControl: "no-cache, max-age=0" } });
    return `https://storage.googleapis.com/${this.bucket}/${path}`;
  }

  async uploadVideo(gcsPrefix: string, runId: string, filename: string, buffer: Buffer): Promise<string> {
    const path = `${gcsPrefix}/${runId}/${filename}`;
    const file = this.storage.bucket(this.bucket).file(path);
    await file.save(buffer, { contentType: "video/mp4", metadata: { cacheControl: "no-cache, max-age=0" } });
    return `https://storage.googleapis.com/${this.bucket}/${path}?v=${randomUUID()}`;
  }


  async uploadFile(gcsPrefix: string, runId: string, filename: string, buffer: Buffer, contentType: string): Promise<string> {
    const filePath = `${gcsPrefix}/${runId}/${filename}`;
    const file = this.storage.bucket(this.bucket).file(filePath);
    await file.save(buffer, { contentType, metadata: { cacheControl: 'no-cache, max-age=0' } });
    return `https://storage.googleapis.com/${this.bucket}/${filePath}`;
  }

    async downloadFile(gcsPrefix: string, runId: string, filename: string, destination: string): Promise<void> {
    const objectPath = `${gcsPrefix}/${runId}/${filename}`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await this.storage.bucket(this.bucket).file(objectPath).download({ destination });
  }
}

export function createGcsService(): GcsService {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) throw new Error("GCS_BUCKET is not set");
  return new GcsService(bucket);
}
