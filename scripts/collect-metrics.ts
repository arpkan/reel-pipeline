import "dotenv/config";
import { collectMetrics } from "../src/services/metrics-collector.ts";

await collectMetrics("ns");
console.log("Done ns");
await collectMetrics("ds");
console.log("Done ds");
