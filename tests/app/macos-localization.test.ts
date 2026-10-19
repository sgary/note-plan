import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * macOS renders its OWN chrome (the webview right-click menu, the Services menu, and every
 * PredefinedMenuItem in the app menu bar) in the language AppKit picks for the bundle. Without
 * `CFBundleLocalizations` the bundle declares English only, so that chrome stays English even
 * when the system language is Chinese. i18next cannot reach any of it.
 *
 * These assertions keep the bundle's declared localizations in step with the UI's i18n files,
 * so adding a language (or dropping the plist wiring) cannot silently regress the system chrome.
 */

const TAURI_DIR = "packages/app/src-tauri";

/** AppKit's tag for each i18n locale code. A new locale must be added here deliberately. */
const APPKIT_TAG: Record<string, string> = {
  en: "en",
  de: "de",
  fr: "fr",
  "zh-CN": "zh-Hans",
};

describe("macOS bundle localization", () => {
  const i18nLocales = readdirSync(resolve("packages/app/src/i18n"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));

  it("has an AppKit tag for every shipped locale", () => {
    expect(i18nLocales.filter((locale) => !(locale in APPKIT_TAG))).toEqual([]);
  });

  it("declares every shipped locale in CFBundleLocalizations", () => {
    const plist = readFileSync(resolve(TAURI_DIR, "Info.plist"), "utf8");
    const block = plist.match(
      /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(block, "CFBundleLocalizations array missing from Info.plist").not.toBeNull();

    const declared = [...block![1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
    const expected = i18nLocales.map((locale) => APPKIT_TAG[locale]);

    expect([...declared].sort()).toEqual([...expected].sort());
  });

  it("actually merges the plist into the bundle", () => {
    const config = JSON.parse(readFileSync(resolve(TAURI_DIR, "tauri.conf.json"), "utf8")) as {
      bundle?: { macOS?: { infoPlist?: string } };
    };
    expect(config.bundle?.macOS?.infoPlist).toBe("Info.plist");
  });
});
