import { afterEach, describe, expect, it } from "vitest";
import { resetAIFetchResolver, setAIFetchResolver } from "@desk/core/host";
import {
  providerNeedsFetch,
  runChat,
} from "../../packages/core/src/desk/ai/transport";

const CHAT_COMPLETION = {
  id: "cmpl-1",
  object: "chat.completion",
  created: 0,
  model: "deepseek-chat",
  choices: [
    { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
};

function stubFetch(calls: string[]) {
  return (async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify(CHAT_COMPLETION), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("custom (OpenAI-compatible) provider", () => {
  afterEach(() => resetAIFetchResolver());

  it("sends the request to the configured base URL through the injected fetch", async () => {
    const calls: string[] = [];
    setAIFetchResolver(() => stubFetch(calls));

    const result = await runChat({
      provider: "custom",
      apiKey: "test-key",
      model: "deepseek-chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      systemPrompt: "You are a test.",
      message: "ping",
    });

    expect(result.message).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ark.cn-beijing.volces.com");
    expect(calls[0]).toContain("chat/completions");
  });

  it("rejects a custom request with no base URL as invalid-config", async () => {
    const calls: string[] = [];
    setAIFetchResolver(() => stubFetch(calls));

    await expect(
      runChat({
        provider: "custom",
        apiKey: "k",
        model: "m",
        systemPrompt: "s",
        message: "m",
      }),
    ).rejects.toMatchObject({ code: "invalid-config" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a custom request with no model as invalid-config", async () => {
    await expect(
      runChat({
        provider: "custom",
        apiKey: "k",
        baseURL: "https://example.test/v1",
        systemPrompt: "s",
        message: "m",
      }),
    ).rejects.toMatchObject({ code: "invalid-config" });
  });

  it("only the custom provider consumes the AI fetch seam", () => {
    expect(providerNeedsFetch("custom")).toBe(true);
    expect(providerNeedsFetch("openai")).toBe(false);
    expect(providerNeedsFetch("anthropic")).toBe(false);
  });
});
