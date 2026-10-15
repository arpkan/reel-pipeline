import { getAssemblyJobById, getRunningAssemblyJob, updateAssemblyJob } from "../db/queries.js";

let launchInProgress = false;
const awsEc2Module = "@aws-sdk/client-ec2";

function markAssemblyJobFailed(jobId: string, message: string): void {
  updateAssemblyJob(jobId, {
    status: "failed",
    error: message,
    finishedAt: new Date().toISOString(),
  });
}

export function canLaunchAssemblyWorker(): boolean {
  return !launchInProgress && !getRunningAssemblyJob();
}

export async function launchAssemblyWorker(params: { jobId: string }): Promise<{ instanceId: string }> {
  if (!canLaunchAssemblyWorker()) {
    throw new Error("Assembly worker launch already in progress");
  }

  const job = getAssemblyJobById(params.jobId);
  if (!job) {
    throw new Error(`Assembly job not found: ${params.jobId}`);
  }

  if (job.status !== "queued") {
    throw new Error(`Assembly job ${params.jobId} must be queued before launch`);
  }

  const launchTemplateId = process.env.REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID;
  if (!launchTemplateId) {
    const message = "REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID is required";
    markAssemblyJobFailed(params.jobId, message);
    throw new Error(message);
  }

  launchInProgress = true;

  try {
    try {
      const { EC2Client, RunInstancesCommand } = await import(awsEc2Module);
      const ec2 = new EC2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
      const response = await ec2.send(
        new RunInstancesCommand({
          LaunchTemplate: { LaunchTemplateId: launchTemplateId },
          MinCount: 1,
          MaxCount: 1,
        }),
      );

      const instanceId = response.Instances?.[0]?.InstanceId;
      if (!instanceId) {
        throw new Error(`EC2 did not return an instance id for job ${params.jobId}`);
      }

      updateAssemblyJob(params.jobId, {
        status: "running",
        instanceId,
        startedAt: new Date().toISOString(),
      });

      return { instanceId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markAssemblyJobFailed(params.jobId, message);
      throw error;
    }
  } finally {
    launchInProgress = false;
  }
}
