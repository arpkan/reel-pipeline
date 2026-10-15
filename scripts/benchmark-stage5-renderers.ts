import "dotenv/config";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

type Brand = "ds" | "ns";
type Renderer = "ffmpeg" | "hyperframes";

function usage(): never {
  console.error("Usage: npm run benchmark:stage5 -- <brand> <source-url>");
  console.error("  brand: ds or ns");
  process.exit(1);
}

function parseArgs(): { brand: Brand; url: string } {
  const [brand, url] = process.argv.slice(2);

  if ((brand !== "ds" && brand !== "ns") || !url) {
    usage();
  }

  return { brand, url };
}

function runCommand(command: string, args: string[]): void {
  execFileSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
}

export function benchmarkUrlForRenderer(url: string, renderer: Renderer): string {
  try {
    const benchmarkUrl = new URL(url);
    benchmarkUrl.searchParams.set("_stage5_benchmark", renderer);
    return benchmarkUrl.href;
  } catch {
    throw new Error(`Invalid source URL: ${url}`);
  }
}

function runRenderer(brand: Brand, url: string, renderer: Renderer): number {
  const start = performance.now();

  runCommand("npm", [
    "run",
    "cli",
    "--",
    brand,
    "--reel",
    "--url",
    url,
    "--stage5-renderer",
    renderer,
  ]);

  return (performance.now() - start) / 1000;
}

function main(): void {
  const { brand, url } = parseArgs();
  let ffmpegUrl: string;
  let hyperframesUrl: string;

  try {
    ffmpegUrl = benchmarkUrlForRenderer(url, "ffmpeg");
    hyperframesUrl = benchmarkUrlForRenderer(url, "hyperframes");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    usage();
  }

  try {
    runCommand("npx", ["hyperframes", "doctor"]);
  } catch (err) {
    console.warn("Hyperframes doctor failed; continuing to renderer benchmark.");
  }

  const ffmpegSeconds = runRenderer(brand, ffmpegUrl, "ffmpeg");
  const hyperframesSeconds = runRenderer(brand, hyperframesUrl, "hyperframes");
  const ratio = hyperframesSeconds / ffmpegSeconds;

  console.log(JSON.stringify({ brand, url, ffmpegSeconds, hyperframesSeconds, ratio }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
