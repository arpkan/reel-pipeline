import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, unlinkSync } from "fs";

const TEST_DB_PATH = `/tmp/test-assembly-jobs-${process.pid}-${Date.now()}.db`;
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
process.env.PIPELINE_DB_PATH = TEST_DB_PATH;

const mockEc2Send = vi.fn();
const mockEc2ClientConfig = vi.fn();

vi.mock("@aws-sdk/client-ec2", () => {
  class RunInstancesCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class EC2Client {
    constructor(config: unknown) {
      mockEc2ClientConfig(config);
    }

    send = mockEc2Send;
  }

  return { EC2Client, RunInstancesCommand };
});

const q = await import("../src/db/queries.js");
const launcher = await import("../src/services/assembly-launcher.js");

afterAll(() => {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
});

describe("assembly jobs", () => {
  it("creates and updates job status lifecycle", () => {
    const runId = `run-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Test headline",
      sourceUrl: "https://example.com/story",
    });

    const jobId = `job-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });

    const queued = q.getAssemblyJobById(jobId);
    expect(queued?.status).toBe("queued");

    q.updateAssemblyJob(jobId, { status: "running", startedAt: "2026-04-26T10:00:00.000Z" });
    const running = q.getAssemblyJobById(jobId);
    expect(running?.status).toBe("running");
    expect(running?.startedAt).toBe("2026-04-26T10:00:00.000Z");

    q.updateAssemblyJob(jobId, { status: "failed", error: "worker crash", finishedAt: "2026-04-26T10:01:00.000Z" });
    const failed = q.getAssemblyJobById(jobId);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("worker crash");
    expect(failed?.finishedAt).toBe("2026-04-26T10:01:00.000Z");
  });
});

describe("canLaunchAssemblyWorker", () => {
  it("returns false when a running assembly job already exists", () => {
    const runId = `run-can-launch-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Can launch test",
      sourceUrl: "https://example.com/can-launch",
    });

    const queuedJobId = `job-can-launch-queued-${Date.now()}`;
    q.createAssemblyJob({ id: queuedJobId, runId, brand: "ns" });
    expect(launcher.canLaunchAssemblyWorker()).toBe(true);

    const runningJobId = `job-can-launch-running-${Date.now()}`;
    q.createAssemblyJob({ id: runningJobId, runId, brand: "ns" });
    q.updateAssemblyJob(runningJobId, { status: "running", startedAt: "2026-04-26T10:00:00.000Z" });

    expect(launcher.canLaunchAssemblyWorker()).toBe(false);

    q.updateAssemblyJob(runningJobId, { status: "failed", finishedAt: "2026-04-26T10:01:00.000Z" });
    q.updateAssemblyJob(queuedJobId, { status: "failed", finishedAt: "2026-04-26T10:01:30.000Z" });
  });
});

describe("getOldestQueuedAssemblyJob", () => {
  it("returns the earliest queued job", () => {
    const runId = `run-oldest-queued-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Oldest queued test",
      sourceUrl: "https://example.com/oldest-queued",
    });

    const olderJobId = `job-oldest-queued-older-${Date.now()}`;
    q.createAssemblyJob({ id: olderJobId, runId, brand: "ns" });
    const newerJobId = `job-oldest-queued-newer-${Date.now()}`;
    q.createAssemblyJob({ id: newerJobId, runId, brand: "ns" });

    const oldestQueued = q.getOldestQueuedAssemblyJob();
    expect(oldestQueued?.id).toBe(olderJobId);

    q.updateAssemblyJob(olderJobId, { status: "running", startedAt: "2026-04-26T10:00:00.000Z" });
    const nextQueued = q.getOldestQueuedAssemblyJob();
    expect(nextQueued?.id).toBe(newerJobId);

    q.updateAssemblyJob(olderJobId, { status: "failed", finishedAt: "2026-04-26T10:02:00.000Z" });
    q.updateAssemblyJob(newerJobId, { status: "failed", finishedAt: "2026-04-26T10:02:10.000Z" });
  });
});

describe("launchAssemblyWorker", () => {
  const originalAwsRegion = process.env.AWS_REGION;
  const originalTemplate = process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-southeast-1";
    process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID = "lt-1234567890";
  });

  afterAll(() => {
    if (originalAwsRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = originalAwsRegion;
    }

    if (originalTemplate === undefined) {
      delete process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID;
    } else {
      process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID = originalTemplate;
    }
  });

  it("launches EC2 worker and returns instance id", async () => {
    const runId = `run-launch-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Launch test",
      sourceUrl: "https://example.com/launch",
    });

    const jobId = `job-launch-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });

    mockEc2Send.mockResolvedValueOnce({
      Instances: [{ InstanceId: "i-abc123" }],
    });

    const result = await launcher.launchAssemblyWorker({ jobId });

    expect(result).toEqual({ instanceId: "i-abc123" });
    expect(mockEc2ClientConfig).toHaveBeenCalledWith({ region: "ap-southeast-1" });
    expect(mockEc2Send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          LaunchTemplate: { LaunchTemplateId: "lt-1234567890" },
          MinCount: 1,
          MaxCount: 1,
        },
      }),
    );

    const updated = q.getAssemblyJobById(jobId);
    expect(updated?.status).toBe("running");
    expect(updated?.instanceId).toBe("i-abc123");
    expect(updated?.startedAt).toBeTruthy();

    q.updateAssemblyJob(jobId, { status: "completed", finishedAt: "2026-04-26T10:02:00.000Z" });
  });

  it("blocks concurrent launches with single-flight guard", async () => {
    const runId = `run-single-flight-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Single flight test",
      sourceUrl: "https://example.com/single-flight",
    });

    const firstJobId = `job-single-flight-1-${Date.now()}`;
    const secondJobId = `job-single-flight-2-${Date.now()}`;
    q.createAssemblyJob({ id: firstJobId, runId, brand: "ns" });
    q.createAssemblyJob({ id: secondJobId, runId, brand: "ns" });

    let resolveLaunch: ((value: { Instances: Array<{ InstanceId: string }> }) => void) | undefined;
    mockEc2Send.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveLaunch = resolve;
      }),
    );

    const firstLaunch = launcher.launchAssemblyWorker({ jobId: firstJobId });
    await vi.waitFor(() => {
      expect(mockEc2Send).toHaveBeenCalledTimes(1);
    });

    await expect(launcher.launchAssemblyWorker({ jobId: secondJobId })).rejects.toThrow(
      "Assembly worker launch already in progress",
    );

    if (!resolveLaunch) {
      throw new Error("Expected first launch to hold EC2 send promise");
    }
    resolveLaunch({ Instances: [{ InstanceId: "i-first" }] });
    await expect(firstLaunch).resolves.toEqual({ instanceId: "i-first" });
    q.updateAssemblyJob(firstJobId, { status: "completed", finishedAt: "2026-04-26T10:02:00.000Z" });
  });

  it("marks job failed and rethrows when EC2 launch fails", async () => {
    const runId = `run-launch-fail-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Launch fail test",
      sourceUrl: "https://example.com/launch-fail",
    });

    const jobId = `job-launch-fail-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });

    mockEc2Send.mockRejectedValueOnce(new Error("ec2 launch failed"));

    await expect(launcher.launchAssemblyWorker({ jobId })).rejects.toThrow("ec2 launch failed");

    const updated = q.getAssemblyJobById(jobId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toContain("ec2 launch failed");
    expect(updated?.finishedAt).toBeTruthy();
  });

  it("marks job failed when EC2 returns no instance id", async () => {
    const runId = `run-no-instance-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "No instance id test",
      sourceUrl: "https://example.com/no-instance",
    });

    const jobId = `job-no-instance-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });

    mockEc2Send.mockResolvedValueOnce({ Instances: [{}] });

    await expect(launcher.launchAssemblyWorker({ jobId })).rejects.toThrow("did not return an instance id");

    const updated = q.getAssemblyJobById(jobId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toContain("did not return an instance id");
    expect(updated?.finishedAt).toBeTruthy();
  });

  it("marks job failed when launch template env var is missing", async () => {
    const runId = `run-missing-template-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Missing template test",
      sourceUrl: "https://example.com/missing-template",
    });

    const jobId = `job-missing-template-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });
    delete process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID;

    await expect(launcher.launchAssemblyWorker({ jobId })).rejects.toThrow(
      "REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID is required",
    );

    const updated = q.getAssemblyJobById(jobId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toContain("REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID is required");
    expect(updated?.finishedAt).toBeTruthy();
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it("rejects relaunch when job is not queued", async () => {
    const runId = `run-not-queued-${Date.now()}`;
    q.createReel({
      id: runId,
      brand: "ns",
      runDate: "2026-04-26",
      headline: "Not queued launch test",
      sourceUrl: "https://example.com/not-queued",
    });

    const jobId = `job-not-queued-${Date.now()}`;
    q.createAssemblyJob({ id: jobId, runId, brand: "ns" });
    q.updateAssemblyJob(jobId, { status: "completed", finishedAt: "2026-04-26T10:03:00.000Z" });

    await expect(launcher.launchAssemblyWorker({ jobId })).rejects.toThrow("must be queued before launch");
    expect(mockEc2Send).not.toHaveBeenCalled();
  });
});
