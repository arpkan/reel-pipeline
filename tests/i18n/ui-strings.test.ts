import { describe, it, expect } from "vitest";
import { UI_STRINGS, type UiLang } from "../../src/i18n/ui-strings.js";

describe("UI_STRINGS", () => {
  (["th", "en", "de"] as UiLang[]).forEach((lang) => {
    describe(`${lang}`, () => {
      it("has all status labels", () => {
        const statuses = ["awaiting_approval", "approved", "published", "rejected", "failed", "running"];
        statuses.forEach((s) => {
          expect(UI_STRINGS[lang].statusLabels[s as keyof typeof UI_STRINGS[typeof lang].statusLabels]).toBeDefined();
        });
      });

      it("has stageLogsLabel", () => {
        expect(UI_STRINGS[lang].stageLogsLabel.length).toBeGreaterThan(0);
      });

      it("has category label", () => {
        expect(UI_STRINGS[lang].category.length).toBeGreaterThan(0);
      });
    });
  });

  it("Thai stageLogsLabel is preserved verbatim (ds regression guard)", () => {
    expect(UI_STRINGS.th.stageLogsLabel).toBe("บันทึกขั้นตอน");
  });

  it("English category label is 'Category' (ns regression guard)", () => {
    expect(UI_STRINGS.en.category).toBe("Category");
  });

  it("German category label is 'Kategorie'", () => {
    expect(UI_STRINGS.de.category).toBe("Kategorie");
  });

  it("German statusLabels.awaiting_approval is uppercase German", () => {
    expect(UI_STRINGS.de.statusLabels.awaiting_approval).toBe("AUF FREIGABE WARTEND");
  });
});
