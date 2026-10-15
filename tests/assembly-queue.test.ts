import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();
const mockClientConfig = vi.fn();

vi.mock("@aws-sdk/client-sqs", () => {
  class SendMessageCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class SQSClient {
    constructor(config: unknown) {
      mockClientConfig(config);
    }

    send = mockSend;
  }

  return { SQSClient, SendMessageCommand };
});

import { buildAssemblyMessage, enqueueAssemblyJob } from "../src/services/assembly-queue.js";

describe("buildAssemblyMessage", () => {
  it("builds minimal payload with valid ISO timestamp", () => {
    const msg = buildAssemblyMessage("job-1", "run-1", "ns");

    expect(msg).toMatchObject({ jobId: "job-1", runId: "run-1", brand: "ns" });
    expect(Number.isNaN(Date.parse(msg.requestedAt))).toBe(false);
    expect(new Date(msg.requestedAt).toISOString()).toBe(msg.requestedAt);
  });
});

describe("enqueueAssemblyJob", () => {
  const originalAwsRegion = process.env.AWS_REGION;
  const originalQueueUrl = process.env.REEL_ASSEMBLY_QUEUE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-southeast-1";
    process.env.REEL_ASSEMBLY_QUEUE_URL = "https://sqs.ap-southeast-1.amazonaws.com/123/assembly";
  });

  afterEach(() => {
    if (originalAwsRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = originalAwsRegion;
    }

    if (originalQueueUrl === undefined) {
      delete process.env.REEL_ASSEMBLY_QUEUE_URL;
    } else {
      process.env.REEL_ASSEMBLY_QUEUE_URL = originalQueueUrl;
    }
  });

  it("sends message body to configured SQS queue", async () => {
    const msg = buildAssemblyMessage("job-22", "run-22", "ds");

    await enqueueAssemblyJob(msg);

    expect(mockClientConfig).toHaveBeenCalledWith({ region: "ap-southeast-1" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          QueueUrl: "https://sqs.ap-southeast-1.amazonaws.com/123/assembly",
          MessageBody: JSON.stringify(msg),
        },
      }),
    );
  });
});
