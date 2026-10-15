import { runStoryReelRoughCutPoc } from "../src/storyreel/rough-cut-poc.js";

try {
  const result = await runStoryReelRoughCutPoc(process.argv.slice(2));
  console.log(`Rough cut written to: ${result.videoPath}`);
  console.log(`Artifacts written to: ${result.outputDir}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
