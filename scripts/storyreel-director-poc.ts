import { runStoryReelDirectorPoc } from "../src/storyreel/director-poc.js";

try {
  const result = await runStoryReelDirectorPoc(process.argv.slice(2));
  console.log(result.summary);
  console.log(`Artifacts written to: ${result.runDir}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
