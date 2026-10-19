/**
 * date-fns locale for the app's current language.
 *
 * date-fns `format()` uses English month and weekday names unless a `locale` is passed — it is
 * not locale-aware the way `Intl` is. Every `format()` call that renders to the user must
 * therefore pass `currentDateLocale()` (or, in `@desk/core`, take a `locale` argument from its
 * caller). `Intl`-based helpers in `lib/i18n/format.ts` do not need this.
 */
import type { Locale } from "date-fns";
import { de, enUS, fr, zhCN } from "date-fns/locale";
import i18next from "i18next";

/** Exported for tests and for `@desk/core` callers, which take the locale as an argument. */
const LOCALES: Record<string, Locale> = {
  en: enUS,
  de,
  fr,
  "zh-CN": zhCN,
};

/** Resolve a language tag (`zh-CN`, `de-AT`, `zh-Hans-CN`) to its date-fns locale. */
export function dateLocaleFor(language: string | undefined | null): Locale {
  if (!language) return enUS;

  const lower = language.toLowerCase();
  const exact = Object.keys(LOCALES).find((code) => code.toLowerCase() === lower);
  if (exact) return LOCALES[exact];

  // Base language only: `de-AT` → `de`, `zh-Hans-CN` → `zh-CN`.
  const base = lower.split("-")[0];
  const match = Object.keys(LOCALES).find((code) => code.toLowerCase().split("-")[0] === base);
  return match ? LOCALES[match] : enUS;
}

/** The date-fns locale for the language i18next is currently using. */
export function currentDateLocale(): Locale {
  return dateLocaleFor(i18next.language);
}
