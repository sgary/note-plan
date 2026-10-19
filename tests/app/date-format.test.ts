import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18next from "i18next";
import { formatDate, formatDateShort } from "../../packages/app/src/lib/format";
import { formatDayName, formatWeekRange } from "@desk/core";

/**
 * User-facing dates must follow the UI language. These go through `Intl`, which both localizes
 * and orders the parts correctly per language (a date-fns pattern cannot: zh-CN would render
 * "5 1月" instead of "1月5日").
 */

const MONDAY = "2026-01-05";

// The helpers read `i18next.language`. Initializing the shared instance (the app does this at
// boot) is what lets changeLanguage() work here.
beforeAll(async () => {
  await i18next.init({ lng: "en", resources: { en: { translation: {} } } });
});

afterEach(async () => {
  await i18next.changeLanguage("en");
});

describe("app date helpers", () => {
  it("localizes the short date", async () => {
    await i18next.changeLanguage("zh-CN");
    expect(formatDateShort(MONDAY)).toBe("1月5日");

    await i18next.changeLanguage("de");
    expect(formatDateShort(MONDAY)).toBe("5. Jan.");

    await i18next.changeLanguage("en");
    expect(formatDateShort(MONDAY)).toBe("Jan 5");
  });

  it("localizes the full date", async () => {
    await i18next.changeLanguage("zh-CN");
    expect(formatDate(MONDAY)).toBe("2026年1月5日");

    await i18next.changeLanguage("en");
    expect(formatDate(MONDAY)).toBe("Jan 5, 2026");
  });
});

describe("planner date helpers", () => {
  it("localizes the day name from the locale argument", () => {
    expect(formatDayName(MONDAY, "zh-CN")).toBe("周一");
    expect(formatDayName(MONDAY, "de-DE")).toBe("Mo");
    expect(formatDayName(MONDAY, "en-US")).toBe("Mon");
  });

  it("localizes the week range", () => {
    expect(formatWeekRange(MONDAY, false, "zh-CN")).toContain("1月");
    expect(formatWeekRange(MONDAY, false, "en-US")).toContain("Jan");
  });
});
