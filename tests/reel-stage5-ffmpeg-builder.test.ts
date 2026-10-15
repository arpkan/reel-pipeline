import { describe, expect, it } from "vitest";
import { buildReelStage5EncodeTailArgs } from "../src/stages/reel-stage5-ffmpeg-builder.js";

describe("buildReelStage5EncodeTailArgs", () => {
  it("builds deterministic encode tail args with default preset", () => {
    const args = buildReelStage5EncodeTailArgs({
      finalVideoLabel: "vtmp",
      audioLabel: "delayed_audio",
      totalDuration: 12.5,
      outputPath: "/tmp/segment1.mp4",
    });

    expect(args).toEqual([
      "-map", "[vtmp]", "-map", "[delayed_audio]",
      "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage",
      "-c:a", "aac", "-b:a", "192k",
      "-t", "12.5", "-pix_fmt", "yuv420p",
      "/tmp/segment1.mp4",
    ]);
  });

  it("uses provided preset with deterministic full arg order", () => {
    const args = buildReelStage5EncodeTailArgs({
      finalVideoLabel: "vb2",
      audioLabel: "delayed_audio",
      totalDuration: 9,
      outputPath: "/tmp/segment2.mp4",
      preset: "veryfast",
    });

    expect(args).toEqual([
      "-map", "[vb2]", "-map", "[delayed_audio]",
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
      "-c:a", "aac", "-b:a", "192k",
      "-t", "9", "-pix_fmt", "yuv420p",
      "/tmp/segment2.mp4",
    ]);
  });
});
