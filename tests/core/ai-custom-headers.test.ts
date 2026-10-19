import { describe, expect, it } from "vitest";
import { resolveCustomHeaders } from "../../packages/core/src/desk/ai/custom-headers";

describe("resolveCustomHeaders", () => {
  it("parses Name: value lines, ignoring blanks and comments", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "\n  x-a: 1  \n# a comment\nnot-a-header\nx-b: two: colons\n",
      sessionId: "sess-1",
      baseURL: "https://example.test/v1",
    });
    expect(headers).toEqual({ "x-a": "1", "x-b": "two: colons" });
  });

  it("adds a session header for opencode endpoints", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "",
      sessionId: "sess-1",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
    });
    expect(headers["x-opencode-session"]).toBe("sess-1");
  });

  it("never adds the session header to other endpoints", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "",
      sessionId: "sess-1",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(headers).toEqual({});
  });

  it("lets an explicit user header win over the generated session", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "x-opencode-session: mine",
      sessionId: "sess-1",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
    });
    expect(headers["x-opencode-session"]).toBe("mine");
  });

  it("omits the session header when no session id is available", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "",
      sessionId: "",
      baseURL: "https://opencode.ai/inference/go/openai/v1",
    });
    expect(headers).toEqual({});
  });

  it("does not match a lookalike host", () => {
    const headers = resolveCustomHeaders({
      rawHeaders: "",
      sessionId: "sess-1",
      baseURL: "https://opencode.ai.evil.test/v1",
    });
    expect(headers).toEqual({});
  });
});
