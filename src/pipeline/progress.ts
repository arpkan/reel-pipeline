import { createTelegramService } from "../services/telegram.js";

const STAGE_LABELS: Record<string, string> = {
  "stage0-from-url": "Discover",
  "stage1-discover": "Discover",
};

export class PostProgress {
  private chatId: string | null = null;
  private msgId: number | null = null;
  private brandName: string;
  private runId: string;
  private stages: Array<{ name: string; label: string; status: "pending" | "running" | "ok" | "error"; durationMs?: number }>;
  private startTime = Date.now();

  constructor(brandName: string, runId: string, stageNames: string[]) {
    this.brandName = brandName;
    this.runId = runId;
    this.stages = stageNames.map((name) => ({
      name,
      label: STAGE_LABELS[name] ?? name,
      status: "pending" as const,
    }));
  }

  async init(chatId: string): Promise<void> {
    this.chatId = chatId;
    const telegram = createTelegramService();
    this.msgId = await telegram.sendMessageWithId(chatId, this.render("running"));
  }

  stageStart(name: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) s.status = "running";
    this.pushUpdate("running");
  }

  stageEnd(name: string, durationMs: number, error?: string): void {
    const s = this.stages.find((s) => s.name === name);
    if (s) { s.status = error ? "error" : "ok"; s.durationMs = durationMs; }
    this.pushUpdate("running");
  }

  async finish(reviewUrl?: string): Promise<void> {
    await this.pushUpdateAsync("done", reviewUrl);
  }

  async fail(stageName: string, error: string): Promise<void> {
    const s = this.stages.find((s) => s.name === stageName);
    if (s) s.status = "error";
    await this.pushUpdateAsync("failed", undefined, error);
  }

  render(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): string {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const icon = state === "done" ? "✅" : state === "failed" ? "❌" : "⏳";
    const lines = [
      `${icon} <b>Posts ${state === "done" ? "ready" : state === "failed" ? "failed" : "in progress"} — ${this.brandName}</b>`,
      `ID: <code>${this.runId.slice(0, 8)}</code>  ⏱ ${elapsed}s`,
      "",
    ];
    for (const s of this.stages) {
      const dot = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : s.status === "running" ? "⏳" : "◻️";
      const dur = s.durationMs !== undefined ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
      lines.push(`${dot} ${s.label}${dur}`);
    }
    if (reviewUrl) { lines.push(""); lines.push(`🔗 <a href="${reviewUrl}">Review</a>`); }
    if (errorMsg) { lines.push(""); lines.push(`⚠️ <code>${errorMsg.slice(0, 200)}</code>`); }
    return lines.join("\n");
  }

  private pushUpdate(state: "running" | "done" | "failed"): void {
    this.pushUpdateAsync(state).catch(() => {});
  }

  private async pushUpdateAsync(state: "running" | "done" | "failed", reviewUrl?: string, errorMsg?: string): Promise<void> {
    if (!this.chatId || !this.msgId) return;
    const telegram = createTelegramService();
    await telegram.editMessage(this.chatId, this.msgId, this.render(state, reviewUrl, errorMsg));
  }
}
