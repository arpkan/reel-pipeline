import { Hono } from "hono";
import { getRunById, updateRunStatus } from "../../src/db/queries.js";

export const approvalRouter = new Hono();

// POST /runs/:brand/:runId/approve
approvalRouter.post("/runs/:brand/:runId/approve", (c) => {
  const runId = c.req.param("runId");
  const run = getRunById(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  if (run.status !== "awaiting_approval") {
    return c.json({ error: `Run is not awaiting approval (status: ${run.status})` }, 409);
  }
  updateRunStatus(runId, "approved");
  return c.json({ ok: true, approved: "all" });
});

// POST /runs/:brand/:runId/reject
approvalRouter.post("/runs/:brand/:runId/reject", (c) => {
  const runId = c.req.param("runId");
  const run = getRunById(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  updateRunStatus(runId, "rejected");
  return c.json({ ok: true, status: "rejected" });
});
