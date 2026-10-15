import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildAssemblyPlan,
  buildFfmpegSegmentArgs,
  buildRoughCutHtml,
  buildStoryReelCropFilter,
  createRoughCutRunId,
  loadDirection,
  parseRoughCutArgs,
  prepareSegments,
  runStoryReelRoughCutPoc,
  validateSourceClips,
  writeRoughCutArtifacts,
  type StoryReelRoughCutDirection,
} from "../src/storyreel/rough-cut-poc.js";

function sampleDirection(): StoryReelRoughCutDirection {
  return {
    hook_clip: { clip_index: 0, start_sec: 26, end_sec: 29, reason: "price changes" },
    clips: [
      { clip_index: 0, start_sec: 1, end_sec: 3, order: 1, role: "setup" },
      { clip_index: 1, start_sec: 0, end_sec: 5, order: 2, role: "completion" },
    ],
    voiceover_script: { full_text: "สคริปต์ทดสอบ" },
    hook_text_overlay: "เต่าบินลด 5 บาท!",
    caption_lines: ["วิธีสั่งเต่าบิน", "ลด 5 บาท"],
    cta_text: "ติดตามต่อ",
    facebook_caption: "แคปชั่น",
    hashtags: ["#เต่าบิน"],
    total_duration_sec: 8,
    director_notes: "ใช้ช่วงราคาลด",
  };
}

describe("StoryReel rough cut POC", () => {
  it("parses required CLI arguments", () => {
    const args = parseRoughCutArgs([
      "--run-dir", "work/storyreel-poc/storyreel-1",
      "--clips", "clip1.mp4", "clip2.mp4",
    ]);

    expect(args).toEqual({
      runDir: "work/storyreel-poc/storyreel-1",
      clips: ["clip1.mp4", "clip2.mp4"],
      outputBaseDir: "work/storyreel-poc/rough-cuts",
      fps: 24,
      quality: "standard",
    });
  });

  it("parses optional output settings", () => {
    const args = parseRoughCutArgs([
      "--run-dir", "run",
      "--clips", "clip1.mp4",
      "--output-dir", "out",
      "--fps", "30",
      "--quality", "draft",
    ]);

    expect(args.outputBaseDir).toBe("out");
    expect(args.fps).toBe(30);
    expect(args.quality).toBe("draft");
  });

  it("rejects missing run directory or clips", () => {
    expect(() => parseRoughCutArgs(["--clips", "clip1.mp4"])).toThrow("Missing --run-dir");
    expect(() => parseRoughCutArgs(["--run-dir", "run"])).toThrow("Missing --clips");
  });

  it("loads direction.json from the run directory", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-direction-"));
    const direction = sampleDirection();
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(direction));

    expect(loadDirection(runDir)).toEqual(direction);
  });

  it("reports missing direction.json clearly", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-no-direction-"));

    expect(() => loadDirection(runDir)).toThrow(`Missing direction.json: ${path.join(runDir, "direction.json")}`);
  });

  it("reports invalid direction.json syntax clearly", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-bad-json-"));
    fs.writeFileSync(path.join(runDir, "direction.json"), "{bad json");

    expect(() => loadDirection(runDir)).toThrow("Invalid direction.json:");
  });

  it("reports invalid direction.json root shape clearly", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-null-direction-"));
    fs.writeFileSync(path.join(runDir, "direction.json"), "null");

    expect(() => loadDirection(runDir)).toThrow("Invalid direction.json: direction must be an object");
  });

  it("reports missing direction.json fields clearly", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-empty-direction-"));
    fs.writeFileSync(path.join(runDir, "direction.json"), "{}");

    expect(() => loadDirection(runDir)).toThrow("Invalid direction.json: hook_clip must be an object");
  });

  it("reports non-string caption and hashtag items clearly", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-invalid-arrays-"));
    const direction = sampleDirection() as unknown as Record<string, unknown>;
    direction.caption_lines = [123];
    direction.hashtags = ["#ok", 456];
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(direction));

    expect(() => loadDirection(runDir)).toThrow("Invalid direction.json:");
    expect(() => loadDirection(runDir)).toThrow("caption_lines must be an array of strings");
    expect(() => loadDirection(runDir)).toThrow("hashtags must be an array of strings");
  });

  it("validates source clip paths and extensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-clips-"));
    const clip = path.join(dir, "clip1.mp4");
    const aviClip = path.join(dir, "clip2.avi");
    const mkvClip = path.join(dir, "clip3.mkv");
    const movClip = path.join(dir, "clip4.mov");
    const m4vClip = path.join(dir, "clip5.m4v");
    fs.writeFileSync(clip, "fake clip");
    fs.writeFileSync(aviClip, "fake clip");
    fs.writeFileSync(mkvClip, "fake clip");
    fs.writeFileSync(movClip, "fake clip");
    fs.writeFileSync(m4vClip, "fake clip");

    expect(validateSourceClips([clip, aviClip, mkvClip, movClip, m4vClip])).toEqual([
      path.resolve(clip),
      path.resolve(aviClip),
      path.resolve(mkvClip),
      path.resolve(movClip),
      path.resolve(m4vClip),
    ]);
    expect(() => validateSourceClips([path.join(dir, "missing.mp4")])).toThrow("Clip not found");
    expect(() => validateSourceClips([path.join(dir, "notes.txt")])).toThrow("Unsupported clip extension");
  });

  it("rejects directories passed as source clips", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-clip-dir-"));
    const clipDir = path.join(dir, "folder.mp4");
    fs.mkdirSync(clipDir);

    expect(() => validateSourceClips([clipDir])).toThrow("Clip path is not a file");
  });

  it("builds an ordered assembly plan with cumulative timings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-plan-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    expect(plan.totalDurationSec).toBe(7);
    expect(plan.hyperframesDir).toBe(path.join(dir, "hyperframes"));
    expect(plan.assetsDir).toBe(path.join(dir, "hyperframes", "assets"));
    expect(plan.videoPath).toBe(path.join(dir, "hyperframes", "storyreel-rough-cut.mp4"));
    expect(plan.segments).toEqual([
      expect.objectContaining({
        index: 1,
        clipIndex: 0,
        sourceClip: "/clips/clip1.mp4",
        segmentPath: path.join(dir, "hyperframes", "assets", "segment-001.mp4"),
        startSec: 1,
        endSec: 3,
        durationSec: 2,
        outputStartSec: 0,
        role: "setup",
      }),
      expect.objectContaining({
        index: 2,
        clipIndex: 1,
        sourceClip: "/clips/clip2.mp4",
        segmentPath: path.join(dir, "hyperframes", "assets", "segment-002.mp4"),
        startSec: 0,
        endSec: 5,
        durationSec: 5,
        outputStartSec: 2,
        role: "completion",
      }),
    ]);
    expect(plan.hookText).toBe("เต่าบินลด 5 บาท!");
    expect(plan.captionLines).toEqual(["วิธีสั่งเต่าบิน", "ลด 5 บาท"]);
  });

  it("sorts assembly segments by order with sequential segment indices", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-sorted-plan-"));
    const direction = sampleDirection();
    direction.clips = [
      { clip_index: 1, start_sec: 10, end_sec: 12, order: 20, role: "second" },
      { clip_index: 0, start_sec: 2, end_sec: 5, order: 10, role: "first" },
    ];

    const plan = buildAssemblyPlan({
      direction,
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    expect(plan.segments).toEqual([
      expect.objectContaining({
        index: 1,
        clipIndex: 0,
        sourceClip: "/clips/clip1.mp4",
        segmentPath: path.join(dir, "hyperframes", "assets", "segment-001.mp4"),
        outputStartSec: 0,
        role: "first",
      }),
      expect.objectContaining({
        index: 2,
        clipIndex: 1,
        sourceClip: "/clips/clip2.mp4",
        segmentPath: path.join(dir, "hyperframes", "assets", "segment-002.mp4"),
        outputStartSec: 3,
        role: "second",
      }),
    ]);
  });

  it("rejects direction clip indices outside supplied clips", () => {
    const direction = sampleDirection();
    direction.clips[1].clip_index = 5;

    expect(() => buildAssemblyPlan({
      direction,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[1].clip_index 5 is outside supplied clip range 0-1");
  });

  it("rejects non-numeric clip timings", () => {
    const direction = sampleDirection() as unknown as { clips: Array<Record<string, unknown>> };
    direction.clips[0].start_sec = "1";

    expect(() => buildAssemblyPlan({
      direction: direction as unknown as StoryReelRoughCutDirection,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[0].start_sec must be numeric");
  });

  it("rejects non-numeric clip end timings", () => {
    const direction = sampleDirection() as unknown as { clips: Array<Record<string, unknown>> };
    direction.clips[0].end_sec = "3";

    expect(() => buildAssemblyPlan({
      direction: direction as unknown as StoryReelRoughCutDirection,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[0].end_sec must be numeric");
  });

  it("rejects clips whose end time is not after start time", () => {
    const direction = sampleDirection();
    direction.clips[0].end_sec = direction.clips[0].start_sec;

    expect(() => buildAssemblyPlan({
      direction,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[0].end_sec must be greater than start_sec");
  });

  it("rejects non-integer clip indices", () => {
    const direction = sampleDirection();
    direction.clips[0].clip_index = 0.5;

    expect(() => buildAssemblyPlan({
      direction,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[0].clip_index must be an integer");
  });

  it("rejects non-integer clip order", () => {
    const direction = sampleDirection();
    direction.clips[0].order = 1.5;

    expect(() => buildAssemblyPlan({
      direction,
      sourceClips: ["clip1.mp4", "clip2.mp4"],
      outputDir: "out",
      fps: 24,
      quality: "standard",
    })).toThrow("clips[0].order must be an integer");
  });

  it("creates sortable rough-cut run ids", () => {
    expect(createRoughCutRunId(new Date("2026-05-14T18:25:25Z"))).toBe("storyreel-roughcut-20260514-182525");
  });

  it("builds FFmpeg args for a normalized vertical segment", () => {
    const args = buildFfmpegSegmentArgs({
      sourceClip: "/clips/input.mp4",
      startSec: 1,
      durationSec: 2,
      outputPath: "/out/segment-001.mp4",
      fps: 24,
    });

    expect(args).toEqual([
      "-y",
      "-ss", "1",
      "-t", "2",
      "-i", "/clips/input.mp4",
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=24,setsar=1",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "/out/segment-001.mp4",
    ]);
  });

  it("prepares all segment files with an injected FFmpeg executor", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-ffmpeg-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });
    const calls: string[][] = [];

    prepareSegments(plan, (args) => {
      calls.push(args);
      const outputPath = args[args.length - 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "segment");
      return { status: 0, stderr: Buffer.from("") };
    });

    expect(calls).toHaveLength(2);
    expect(fs.existsSync(plan.segments[0].segmentPath)).toBe(true);
    expect(fs.existsSync(plan.segments[1].segmentPath)).toBe(true);
  });

  it("reports FFmpeg failures with segment context", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-ffmpeg-fail-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    expect(() => prepareSegments(plan, () => ({ status: 1, stderr: Buffer.from("bad trim") })))
      .toThrow("FFmpeg failed for segment 1 (/clips/clip1.mp4 1s-3s): bad trim");
  });

  it("reports missing output file after successful executor", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-no-output-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    expect(() => prepareSegments(plan, () => ({ status: 0, stderr: Buffer.from("") })))
      .toThrow(`FFmpeg succeeded for segment 1 but output file missing: ${plan.segments[0].segmentPath}`);
  });

  it("reports spawn failures with null status", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-spawn-enoent-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    expect(() => prepareSegments(plan, () => ({ status: null, stderr: Buffer.from("spawn ffmpeg ENOENT") })))
      .toThrow(/FFmpeg failed.*ENOENT/);
  });

  it("truncates long stderr in failure messages", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-long-stderr-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    const longStderr = "x".repeat(1000);
    try {
      prepareSegments(plan, () => ({ status: 1, stderr: Buffer.from(longStderr) }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      const colonIdx = msg.indexOf(": ");
      const stderrPart = msg.slice(colonIdx + 2);
      expect(stderrPart.length).toBeLessThanOrEqual(500);
    }
  });

  it("includes languageCode in assembly plan from BuildAssemblyPlanInput", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-lang-plan-"));

    const thai = buildAssemblyPlan({ direction: sampleDirection(), sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"], outputDir: dir, fps: 24, quality: "standard", languageCode: "th" });
    expect(thai.languageCode).toBe("th");

    const german = buildAssemblyPlan({ direction: sampleDirection(), sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"], outputDir: dir, fps: 24, quality: "standard", languageCode: "de" });
    expect(german.languageCode).toBe("de");

    const defaulted = buildAssemblyPlan({ direction: sampleDirection(), sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"], outputDir: dir, fps: 24, quality: "standard" });
    expect(defaulted.languageCode).toBe("th");
  });

  it("uses Noto Sans Thai font and lang=th for Thai language plans", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-html-th-"));
    const plan = buildAssemblyPlan({ direction: sampleDirection(), sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"], outputDir: dir, fps: 24, quality: "standard", languageCode: "th" });

    const html = buildRoughCutHtml(plan);

    expect(html).toContain("'Noto Sans Thai', 'Noto Sans', Arial, sans-serif");
    expect(html).toContain('<html lang="th">');
  });

  it("uses Noto Sans only and correct lang attribute for non-Thai language plans", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-html-de-"));
    const plan = buildAssemblyPlan({ direction: sampleDirection(), sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"], outputDir: dir, fps: 24, quality: "standard", languageCode: "de" });

    const html = buildRoughCutHtml(plan);

    expect(html).not.toContain("Noto Sans Thai");
    expect(html).toContain("'Noto Sans', Arial, sans-serif");
    expect(html).toContain('<html lang="de">');
  });

  it("builds Hyperframes HTML for video segments and Thai captions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-html-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    const html = buildRoughCutHtml(plan);

    expect(html).toContain('data-composition-id="storyreel-rough-cut"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('class="clip video-segment segment-1"');
    expect(html).toContain('src="assets/segment-001.mp4"');
    expect(html).toContain("เต่าบินลด 5 บาท!");
    expect(html).toContain("วิธีสั่งเต่าบิน");
    expect(html).toContain("'Noto Sans Thai', 'Noto Sans', Arial, sans-serif");
    expect(html).toContain("window.__timelines['storyreel-rough-cut']");
  });

  it("writes rough-cut artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-artifacts-"));
    const plan = buildAssemblyPlan({
      direction: sampleDirection(),
      sourceClips: ["/clips/clip1.mp4", "/clips/clip2.mp4"],
      outputDir: dir,
      fps: 24,
      quality: "standard",
    });

    writeRoughCutArtifacts(plan, "&lt;html&gt;&lt;/html&gt;");

    expect(fs.existsSync(path.join(plan.hyperframesDir, "index.html"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "assembly-plan.json"), "utf8")).totalDurationSec).toBe(7);
    expect(fs.readFileSync(path.join(dir, "assembly-log.txt"), "utf8")).toContain("StoryReel Rough Cut Assembly");
  });

  it("runs the rough cut POC with injected FFmpeg and Hyperframes renderers", async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-source-"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-run-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-out-"));
    const clip1 = path.join(sourceDir, "clip1.mp4");
    const clip2 = path.join(sourceDir, "clip2.mp4");
    fs.writeFileSync(clip1, "clip1");
    fs.writeFileSync(clip2, "clip2");
    fs.writeFileSync(path.join(runDir, "direction.json"), JSON.stringify(sampleDirection()));

    const result = await runStoryReelRoughCutPoc([
      "--run-dir", runDir,
      "--clips", clip1, clip2,
      "--output-dir", outDir,
    ], {
      now: new Date("2026-05-14T18:25:25Z"),
      ffmpegExecutor(args) {
        const outputPath = args[args.length - 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, "segment");
        return { status: 0, stderr: Buffer.from("") };
      },
      async hyperframesRenderer({ outputPath }) {
        fs.writeFileSync(outputPath, "video");
      },
    });

    expect(result.outputDir).toBe(path.join(outDir, "storyreel-roughcut-20260514-182525"));
    expect(fs.existsSync(path.join(result.outputDir, "rough-cut.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "assembly-plan.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.outputDir, "hyperframes", "index.html"))).toBe(true);
  });

  it("uses production 9:16 crop filters from the pipeline spec", () => {
    expect(buildStoryReelCropFilter({ width: 1080, height: 1920 })).toBe("scale=1080:1920");
    expect(buildStoryReelCropFilter({ width: 1920, height: 1080 })).toBe("crop=608:1080:656:0,scale=1080:1920");
    expect(buildStoryReelCropFilter({ width: 1080, height: 1080 })).toBe("crop=607:1080:236:0,scale=1080:1920");
  });
});
