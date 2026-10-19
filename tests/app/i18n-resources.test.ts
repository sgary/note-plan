import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Resource = Record<string, unknown>;

function load(language: string): Resource {
  return JSON.parse(
    readFileSync(resolve(`packages/app/src/i18n/${language}.json`), "utf8"),
  ) as Resource;
}

function leafKeys(value: Resource, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? leafKeys(child as Resource, path)
      : [path];
  });
}

describe("translation resources", () => {
  const englishKeys = new Set(leafKeys(load("en")));

  for (const language of ["de", "fr", "zh-CN"]) {
    it(`${language} has exactly the same translation keys as English`, () => {
      const localizedKeys = new Set(leafKeys(load(language)));
      const unknown = [...localizedKeys].filter((key) => !englishKeys.has(key));
      const missing = [...englishKeys].filter((key) => !localizedKeys.has(key));
      expect(unknown).toEqual([]);
      expect(missing).toEqual([]);
    });
  }
});
