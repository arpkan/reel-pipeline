import { fileURLToPath } from "node:url";
import type { BrandId, Stage5RendererType, Stage5TemplateName, Theme } from "../src/types.js";

const VALID_BRANDS: BrandId[] = ["ds", "ns", "ts"];
const VALID_THEMES: Theme[] = [
  "Tech", "Health", "Economy", "Politics", "Entertainment",
  "Environment", "Science", "Sports", "Lifestyle",
];

export function parseArgs(args: string[]): {
  brand: BrandId;
  theme?: Theme;
  dryRun: boolean;
  stageFilter?: number;
  resumeRunId?: string;
  reel: boolean;
  sourceUrls?: string[];
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
} {
  const brand = args[0] as BrandId;

  if (!brand || !VALID_BRANDS.includes(brand)) {
    console.error(`Usage: npx tsx bin/run.ts <brand> [--reel] [--url <url>] [--theme <Theme>] [--dry-run] [--stage <N>] [--resume <runId>] [--stage5-renderer <hyperframes>] [--stage5-template <enhanced-default>]`);
    console.error(`Brands: ${VALID_BRANDS.join(", ")}`);
    console.error(`Themes: ${VALID_THEMES.join(", ")}`);
    process.exit(1);
  }

  let theme: Theme | undefined;
  let dryRun = false;
  let stageFilter: number | undefined;
  let resumeRunId: string | undefined;
  let reel = false;
  let stage5Renderer: Stage5RendererType | undefined;
  let stage5Template: Stage5TemplateName | undefined;
  const sourceUrls: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--theme" && args[i + 1]) {
      const t = args[++i] as Theme;
      if (!VALID_THEMES.includes(t)) {
        console.error(`Unknown theme: ${t}. Valid: ${VALID_THEMES.join(", ")}`);
        process.exit(1);
      }
      theme = t;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--stage" && args[i + 1]) {
      stageFilter = parseInt(args[++i]);
    } else if (args[i] === "--resume" && args[i + 1]) {
      resumeRunId = args[++i];
    } else if (args[i] === "--reel") {
      reel = true;
    } else if (args[i] === "--url" && args[i + 1]) {
      sourceUrls.push(args[++i]);
    } else if (args[i] === "--stage5-renderer") {
      if (!args[i + 1] || args[i + 1].startsWith("--")) {
        console.error("Missing value for --stage5-renderer. Valid: hyperframes");
        process.exit(1);
      }
      const value = args[++i];
      if (value !== "hyperframes") {
        if (value === "ffmpeg") {
          console.error("Invalid stage5 renderer: ffmpeg. ffmpeg is retired; use hyperframes. Valid: hyperframes");
        } else {
          console.error(`Invalid stage5 renderer: ${value}. Valid: hyperframes`);
        }
        process.exit(1);
      }
      stage5Renderer = value;
    } else if (args[i] === "--stage5-template") {
      if (!args[i + 1] || args[i + 1].startsWith("--")) {
        console.error("Missing value for --stage5-template. Valid: enhanced-default");
        process.exit(1);
      }
      const value = args[++i];
      if (value !== "enhanced-default") {
        console.error(`Unknown stage5 template: ${value}. Valid: enhanced-default`);
        process.exit(1);
      }
      stage5Template = value;
    }
  }

  if (!reel && (stage5Renderer || stage5Template)) {
    console.error("--stage5-renderer and --stage5-template require --reel");
    process.exit(1);
  }

  return {
    brand, theme, dryRun, stageFilter, resumeRunId, reel,
    sourceUrls: sourceUrls.length ? sourceUrls : undefined,
    stage5Renderer,
    stage5Template,
  };
}

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const { brand, theme, dryRun, stageFilter, resumeRunId, reel, sourceUrls, stage5Renderer, stage5Template } = parseArgs(args);
  const { validateEnv } = await import("../src/config.js");

  validateEnv(brand);

  if (reel) {
    const { ReelRunner } = await import("../src/pipeline/reel-runner.js");
    try {
      if (resumeRunId) {
        console.log(`Resuming reel: brand=${brand} runId=${resumeRunId}`);
        await ReelRunner.resume(resumeRunId, brand, undefined, { stage5Renderer, stage5Template });
        console.log(`Reel resumed: runId=${resumeRunId}`);
        process.exit(0);
      }

      console.log(`Starting reel: brand=${brand}${theme ? ` theme=${theme}` : ""}${sourceUrls ? ` url=${sourceUrls[0]}` : " (discovery)"}${dryRun ? " [dry-run]" : ""}`);
      const ctx = await ReelRunner.run(brand, { theme, sourceUrls, dryRun, stage5Renderer, stage5Template });
      console.log(`Reel finished: status=${ctx.status} runId=${ctx.runId}`);
      process.exit(0);
    } catch (err) {
      console.error("Reel failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } else {
    console.error("Post pipeline is retired. Use --reel to run a reel.");
    process.exit(1);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
