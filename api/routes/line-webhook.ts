import { Hono } from "hono";
import { createLineService } from "../../src/services/line.js";
import { insertLineEvent } from "../../src/db/queries.js";

export const lineWebhookRouter = new Hono();

lineWebhookRouter.post("/webhook/line", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? "";

  // Verify signature
  const line = createLineService();
  if (!line) {
    console.error("[line-webhook] LINE service not configured — missing env vars");
    return c.json({ ok: false }, 500);
  }

  if (!line.verifySignature(rawBody, signature)) {
    console.warn("[line-webhook] invalid signature — request rejected");
    return c.json({ ok: false }, 401);
  }

  let body: {
    events: Array<{
      type: string;
      timestamp: number;
      source?: { type: string; groupId?: string; userId?: string };
      message?: { type: string; text?: string };
    }>;
  };

  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false }, 400);
  }

  for (const event of body.events ?? []) {
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;
    if (event.source?.type !== "group") continue;

    const groupId = event.source.groupId;
    const text = event.message.text;
    const userId = event.source.userId ?? null;

    if (!groupId || !text) continue;

    // Only store messages that start with exactly one ! — ignore plain chat and !!
    const looksLikeCommand = text.trim().startsWith("!") && !text.trim().startsWith("!!");
    if (!looksLikeCommand) {
      console.log(`[line-webhook] ignored non-command message from group ${groupId}: "${text.slice(0, 40)}"`);
      continue;
    }

    insertLineEvent(groupId, text, userId, event.timestamp);
    console.log(`[line-webhook] stored event from group ${groupId}: "${text}"`);
  }

  return c.json({ ok: true });
});
