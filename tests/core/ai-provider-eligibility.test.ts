import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_MAINTENANCE_DEFAULTS,
  getDeskService,
  type AIMaintenanceSettings,
} from "@desk/core";
import { getAIMaintenanceSettings } from "../../packages/core/src/desk/maintenance/config";
import {
  isProviderConfigured,
  isProviderUsable,
} from "../../packages/core/src/desk/maintenance/provider-eligibility";
import {
  InMemoryStorageProvider,
  resetAIKeyResolver,
  resetDeskRuntime,
  setAIKeyResolver,
  setDataRootResolver,
  setStorage,
} from "@desk/core/host";

function settings(patch: Partial<AIMaintenanceSettings> = {}): AIMaintenanceSettings {
  return { ...AI_MAINTENANCE_DEFAULTS, ...patch };
}

describe("provider eligibility", () => {
  beforeEach(() => {
    setAIKeyResolver(async (ref) => (ref === "ai.custom" ? "custom-key" : "other-key"));
  });
  afterEach(() => resetAIKeyResolver());

  it("treats a key as sufficient for openai and anthropic", async () => {
    expect(await isProviderConfigured("openai", settings())).toBe(true);
    expect(await isProviderConfigured("anthropic", settings())).toBe(true);
  });

  it("requires both a base URL and a model for custom", async () => {
    const bothMissing = settings({ customBaseURL: "", modelByProvider: {} });
    expect(await isProviderConfigured("custom", bothMissing)).toBe(false);

    const noModel = settings({ customBaseURL: "https://example.test/v1", modelByProvider: {} });
    expect(await isProviderConfigured("custom", noModel)).toBe(false);

    const noBaseURL = settings({ customBaseURL: "  ", modelByProvider: { custom: "m" } });
    expect(await isProviderConfigured("custom", noBaseURL)).toBe(false);

    const ready = settings({
      customBaseURL: "https://example.test/v1",
      modelByProvider: { custom: "m" },
    });
    expect(await isProviderConfigured("custom", ready)).toBe(true);
  });

  it("ignores the custom fields for the other providers", async () => {
    // An empty customBaseURL must not make openai unconfigured.
    expect(await isProviderUsable(settings({ providerType: "openai", customBaseURL: "" }))).toBe(true);
  });

  it("is unusable when no key resolves", async () => {
    setAIKeyResolver(async () => null);
    expect(
      await isProviderUsable(
        settings({
          providerType: "custom",
          customBaseURL: "https://example.test/v1",
          modelByProvider: { custom: "m" },
        }),
      ),
    ).toBe(false);
  });
});

describe("ai-maintenance settings backfill", () => {
  beforeEach(() => {
    resetDeskRuntime();
    setStorage(new InMemoryStorageProvider());
    setDataRootResolver(async () => "~/DeskMD");
  });
  afterEach(() => resetDeskRuntime());

  it("reads a settings file written before this feature without losing the old choices", async () => {
    const service = getDeskService();
    await service.setSetting(
      "ai-maintenance",
      JSON.stringify({ providerType: "openai", modelByProvider: { openai: "gpt-5" } }),
    );

    const read = await getAIMaintenanceSettings();
    expect(read.customBaseURL).toBe("");
    expect(read.providerType).toBe("openai");
    expect(read.modelByProvider.openai).toBe("gpt-5");
  });
});
