import { describe, expect, it } from "vitest";
import { format, parseISO } from "date-fns";
import { dateLocaleFor } from "../../packages/app/src/lib/i18n/date-locale";

/**
 * date-fns `format()` silently uses English month/weekday names unless a `locale` is passed,
 * which is what made every date in the UI read English. These tests pin the mapping from the
 * app's language codes to date-fns locales.
 */

const ISO = "2026-01-05"; // a Monday

describe("dateLocaleFor", () => {
  it("maps every shipped language to a date-fns locale", () => {
    expect(dateLocaleFor("en").code).toBe("en-US");
    expect(dateLocaleFor("de").code).toBe("de");
    expect(dateLocaleFor("fr").code).toBe("fr");
    expect(dateLocaleFor("zh-CN").code).toBe("zh-CN");
  });

  it("falls back to English for an unknown or missing language", () => {
    expect(dateLocaleFor("sv-SE").code).toBe("en-US");
    expect(dateLocaleFor(undefined).code).toBe("en-US");
    expect(dateLocaleFor("").code).toBe("en-US");
  });

  it("matches a region-qualified tag to its base language", () => {
    expect(dateLocaleFor("de-AT").code).toBe("de");
    expect(dateLocaleFor("zh-Hans-CN").code).toBe("zh-CN");
  });

  it("actually localizes month and weekday names", () => {
    const zh = dateLocaleFor("zh-CN");
    expect(format(parseISO(ISO), "MMMM", { locale: zh })).toBe("一月");
    expect(format(parseISO(ISO), "EEE", { locale: zh })).toBe("周一");

    const de = dateLocaleFor("de");
    expect(format(parseISO(ISO), "MMMM", { locale: de })).toBe("Januar");
    expect(format(parseISO(ISO), "EEE", { locale: de })).toBe("Mo.");

    const fr = dateLocaleFor("fr");
    expect(format(parseISO(ISO), "MMMM", { locale: fr })).toBe("janvier");
  });
});
