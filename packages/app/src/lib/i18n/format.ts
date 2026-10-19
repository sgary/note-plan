import i18next from "i18next";

const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  "zh-CN": "zh-CN",
};

/**
 * The BCP-47 tag for a language code. Every user-facing date must go through this (or through
 * `dateLocaleFor` for date-fns consumers): date-fns patterns are not locale-aware on their own,
 * and only Intl orders date parts correctly per language ("1月5日", not "5 1月").
 */
export function localeTagFor(language: string | undefined | null): string {
  if (!language) return "en-US";
  return LOCALE_MAP[language] ?? language;
}

/** The tag for the language i18next is currently using. */
export function currentLocale(): string {
  return localeTagFor(i18next.language);
}

/**
 * Parse a `YYYY-MM-DD` date-only string as **local** midnight. `new Date("2026-01-15")`
 * parses as UTC midnight, which renders as the previous day in negative-offset zones — so
 * a date-only value must be constructed from its local parts. Full ISO timestamps (with a
 * time/zone) are left to the native parser.
 */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
}

/**
 * Format an ISO date with Intl options, in the UI language. Yields "" for a missing value and
 * echoes the input back when it cannot be parsed, so list rows can safely pass `row.date`.
 */
export function formatLocaleDate(
  value: string | Date | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (value === undefined || value === null || value === "") return "";
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) {
    return typeof value === "string" ? value : "";
  }
  return new Intl.DateTimeFormat(currentLocale(), opts).format(d);
}

/**
 * Relative time from now ("2 hours ago", "yesterday"), locale-aware via
 * Intl.RelativeTimeFormat. Accepts date-only strings (local midnight) and full
 * ISO timestamps. Falls back to a short absolute date beyond ~4 weeks.
 */
export function formatRelativeTime(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) {
    return typeof value === "string" ? value : "";
  }
  const diffSeconds = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diffSeconds), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 86400 * 28) return rtf.format(Math.round(diffSeconds / 86400), "day");
  return formatLocaleDate(d, { day: "numeric", month: "short" });
}
