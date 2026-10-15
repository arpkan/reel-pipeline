import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { BrandId } from "../types.js";

export interface AssemblyMessage {
  jobId: string;
  runId: string;
  brand: BrandId;
  instanceId?: string;
  requestedAt: string;
}

export function buildAssemblyMessage(jobId: string, runId: string, brand: BrandId, instanceId?: string): AssemblyMessage {
  return {
    jobId,
    runId,
    brand,
    ...(instanceId ? { instanceId } : {}),
    requestedAt: new Date().toISOString(),
  };
}

export async function enqueueAssemblyJob(msg: AssemblyMessage): Promise<void> {
  const queueUrl = process.env.REEL_ASSEMBLY_QUEUE_URL;
  if (!queueUrl) {
    throw new Error("REEL_ASSEMBLY_QUEUE_URL is required");
  }

  const sqs = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(msg),
    }),
  );
}
