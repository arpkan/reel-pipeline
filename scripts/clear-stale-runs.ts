import "dotenv/config";
import { db } from "../src/db/client.js";
import { runs } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const result = db.update(runs).set({ status: "failed" }).where(eq(runs.status, "running")).run();
console.log(`Cleared ${result.changes} stale running run(s).`);
