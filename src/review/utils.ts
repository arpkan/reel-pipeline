import { readFileSync } from "fs";
import { join } from "path";
import { getUiStrings, type UiLang, type RunStatus } from "../i18n/ui-strings.js";

function loadLogoBase64(filename: string): string {
  try {
    return readFileSync(join(process.cwd(), "assets/brands", filename)).toString("base64");
  } catch {
    return "";
  }
}

const NS_LOGO_B64 = loadLogoBase64("worldbrief_logo.png");
const DS_LOGO_B64 = loadLogoBase64("thaidaily_logo.png");
const TS_LOGO_B64 = loadLogoBase64("tagesbrief_logo.png");

const LOGOS: Record<string, string> = {
  ds: DS_LOGO_B64,
  ns: NS_LOGO_B64,
  ts: TS_LOGO_B64,
};

export function brandLogoHtml(brandId: string, cls = "brand-logo"): string {
  const b64 = LOGOS[brandId] ?? "";
  if (!b64) return "";
  return `<img src="data:image/png;base64,${b64}" class="${cls}" alt="">`;
}

export function brandThemeCss(brandId: string): string {
  if (brandId === "ns") {
    return `:root{--c-accent:#B21526;--c-accent-bright:#D42030;--c-accent-dim:#2A0609;--c-accent-text:#E87880;--c-accent2:#E8A020;--c-bar:#7A1020;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
  }
  if (brandId === "ts") {
    return `:root{--c-accent:#0E7C3A;--c-accent-bright:#16A34A;--c-accent-dim:#042814;--c-accent-text:#7ADBA0;--c-accent2:#E8A020;--c-bar:#0A5A2A;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
  }
  return `:root{--c-accent:#1550C4;--c-accent-bright:#2060D4;--c-accent-dim:#091440;--c-accent-text:#7AABD8;--c-accent2:#FF5A00;--c-bar:#1040A0;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function statusBadgeHtml(status: RunStatus | string, language: string): string {
  const bgMap: Record<string, { bg: string; color: string }> = {
    awaiting_approval: { bg: "#e53935", color: "#fff" },
    approved:          { bg: "#2e7d32", color: "#fff" },
    published:         { bg: "#1565c0", color: "#fff" },
    rejected:          { bg: "#555",    color: "#fff" },
    failed:            { bg: "#b71c1c", color: "#fff" },
    running:           { bg: "#f57c00", color: "#fff" },
    cancelled:         { bg: "#555",    color: "#fff" },
  };
  const S = getUiStrings(language as UiLang);
  const label = S.statusLabels[status as keyof typeof S.statusLabels] ?? status.toUpperCase();
  const { bg, color } = bgMap[status] ?? { bg: "#888", color: "#fff" };
  return `<span class="status-badge" style="background:${bg};color:${color}">${label}</span>`;
}

export function statusFooterText(status: RunStatus | string, language: string): string {
  const S = getUiStrings(language as UiLang);
  return S.statusFooterText[status as keyof typeof S.statusFooterText] ?? S.statusFooterText.running;
}

export interface StageLog {
  stage: string;
  status: "ok" | "error" | "skipped";
  durationMs: number;
  error?: string;
}

export function stageLogsHtml(stageLogs: StageLog[], language: string): string {
  if (!stageLogs?.length) return "";
  const S = getUiStrings(language as UiLang);
  const rows = stageLogs.map((s) => {
    const icon  = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : "⏭️";
    const dur   = s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(1)}s` : `${s.durationMs}ms`;
    const error = s.error ? `<div class="stage-error">${escapeHtml(s.error.slice(0, 200))}</div>` : "";
    return `<div class="stage-row">
      <span class="stage-icon">${icon}</span>
      <span class="stage-name">${escapeHtml(s.stage)}</span>
      <span class="stage-dur">${dur}</span>
      ${error}
    </div>`;
  }).join("");
  return `<details class="stage-logs-details">
  <summary>${S.stageLogsLabel}</summary>
  <div class="stage-logs-body">${rows}</div>
</details>`;
}
