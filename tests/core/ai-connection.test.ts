import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_MAINTENANCE_DEFAULTS, getDeskService, type DeskService } from "@desk/core";
import {
  InMemoryStorageProvider,
  resetAIKeyResolver,
  resetAIFetchResolver,
  resetDeskRuntime,
  setAIKeyResolver,
  setAIFetchResolver,
  setDataRootResolver,
  setStorage,
} from "@desk/core/host";

const OK_BODY = {
  id: "c",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

async function setCustomSettings(service: DeskService, baseURL: string, model: string) {
  await service.setSetting(
    "ai-maintenance",
    JSON.stringify({
      autoSummarizeOnSave: true,
      summaryDetail: "brief",
      providerType: "custom",
      modelByProvider: { custom: model },
      customBaseURL: baseURL,
    }),
  );
}

describe("testAIConnection", () => {
  let service: DeskService;

  beforeEach(async () => {
    resetDeskRuntime();
    setStorage(new InMemoryStorageProvider());
    setDataRootResolver(async () => "~/DeskMD");
    setAIKeyResolver(async () => "test-key");
    service = getDeskService();
    await service.createWorkspace({ id: "acme", name: "Acme", color: "#123456", home: true });
  });

  afterEach(() => {
    resetDeskRuntime();
    resetAIKeyResolver();
    resetAIFetchResolver();
  });

  it("reports ok when the endpoint answers", async () => {
    await setCustomSettings(service, "https://example.test/v1", "m");
    setAIFetchResolver(
      () => (async () =>
        new Response(JSON.stringify(OK_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );

    await expect(service.testAIConnection()).resolves.toMatchObject({ ok: true });
  });

  it("reports the classified code when the endpoint rejects the key", async () => {
    await setCustomSettings(service, "https://example.test/v1", "m");
    setAIFetchResolver(
      () => (async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );

    await expect(service.testAIConnection()).resolves.toMatchObject({ ok: false, code: "auth" });
  });

  it("reports invalid-config without calling the endpoint when the config is incomplete", async () => {
    await setCustomSettings(service, "", "m");
    let called = false;
    setAIFetchResolver(
      () => (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    );

    await expect(service.testAIConnection()).resolves.toMatchObject({
      ok: false,
      code: "invalid-config",
    });
    expect(called).toBe(false);
  });

  it("sends the generated session header to an OpenCode endpoint", async () => {
    await service.setSetting(
      "ai-maintenance",
      JSON.stringify({
        ...AI_MAINTENANCE_DEFAULTS,
        providerType: "custom",
        modelByProvider: { custom: "deepseek-v4.1-flash" },
        customBaseURL: "https://opencode.ai/zen/go/v1",
        customSessionId: "sess-abc",
      }),
    );

    const seen: Headers[] = [];
    setAIFetchResolver(
      () =>
        (async (input: unknown, init?: RequestInit) => {
          seen.push(
            input instanceof Request
              ? input.headers
              : new Headers((init?.headers as HeadersInit) ?? undefined),
          );
          return new Response(JSON.stringify(OK_BODY), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch,
    );

    await expect(service.testAIConnection()).resolves.toMatchObject({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].get("x-opencode-session")).toBe("sess-abc");
  });
});
