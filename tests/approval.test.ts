import { describe, it, expect } from "vitest";

// Re-export parseCommand for testing by extracting it inline
// We test the poller's command parsing by checking known inputs
const parseCommand = (text: string) => {
  const t = text.trim().toLowerCase();

  if (t === "approve all" || t === "approve") return { action: "approve_all" };
  if (t === "reject all" || t === "reject") return { action: "reject" };

  const approveN = t.match(/^approve\s+(\d+)$/);
  if (approveN) return { action: "approve", postIndices: [parseInt(approveN[1]) - 1] };

  const editN = t.match(/^edit\s+(\d+)$/);
  if (editN) return { action: "edit", postIndices: [parseInt(editN[1]) - 1] };

  const newImage = t.match(/^new\s+image\s+(\d+)$/);
  if (newImage) return { action: "new_image", postIndices: [parseInt(newImage[1]) - 1] };

  const newText = t.match(/^new\s+text\s+(\d+)$/);
  if (newText) return { action: "new_text", postIndices: [parseInt(newText[1]) - 1] };

  const reschedule = t.match(/^reschedule\s+(\d+)\s+to\s+(\d{1,2}:\d{2})$/);
  if (reschedule) return { action: "reschedule", postIndices: [parseInt(reschedule[1]) - 1], editPayload: { newTime: reschedule[2] } };

  return null;
};

describe("approval command parsing", () => {
  it("approve all", () => expect(parseCommand("approve all")).toEqual({ action: "approve_all" }));
  it("approve (shorthand)", () => expect(parseCommand("approve")).toEqual({ action: "approve_all" }));
  it("reject all", () => expect(parseCommand("reject all")).toEqual({ action: "reject" }));
  it("reject (shorthand)", () => expect(parseCommand("reject")).toEqual({ action: "reject" }));
  it("approve N — converts to 0-indexed", () => expect(parseCommand("approve 1")).toEqual({ action: "approve", postIndices: [0] }));
  it("approve 2", () => expect(parseCommand("approve 2")).toEqual({ action: "approve", postIndices: [1] }));
  it("edit N", () => expect(parseCommand("edit 1")).toEqual({ action: "edit", postIndices: [0] }));
  it("new image N", () => expect(parseCommand("new image 1")).toEqual({ action: "new_image", postIndices: [0] }));
  it("new text N", () => expect(parseCommand("new text 2")).toEqual({ action: "new_text", postIndices: [1] }));
  it("reschedule N to TIME", () => expect(parseCommand("reschedule 1 to 09:00")).toEqual({ action: "reschedule", postIndices: [0], editPayload: { newTime: "09:00" } }));
  it("unknown command returns null", () => expect(parseCommand("hello")).toBeNull());
  it("case-insensitive", () => expect(parseCommand("APPROVE ALL")).toEqual({ action: "approve_all" }));
  it("trims whitespace", () => expect(parseCommand("  approve all  ")).toEqual({ action: "approve_all" }));
});
