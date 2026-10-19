import { describe, expect, it } from "vitest";
import { isInsecureEndpoint } from "../../packages/app/src/lib/ai/custom-endpoint";

describe("isInsecureEndpoint", () => {
  it("flags plain http to a remote host", () => {
    expect(isInsecureEndpoint("http://ark.example.com/api/v3")).toBe(true);
    expect(isInsecureEndpoint("http://192.168.1.10:8000/v1")).toBe(true);
  });

  it("exempts loopback, where http is the norm", () => {
    expect(isInsecureEndpoint("http://localhost:11434/v1")).toBe(false);
    expect(isInsecureEndpoint("http://127.0.0.1:8000/v1")).toBe(false);
    expect(isInsecureEndpoint("http://[::1]:8000/v1")).toBe(false);
  });

  it("never flags https or an unparseable/empty value", () => {
    expect(isInsecureEndpoint("https://ark.cn-beijing.volces.com/api/v3")).toBe(false);
    expect(isInsecureEndpoint("")).toBe(false);
    expect(isInsecureEndpoint("not a url")).toBe(false);
    expect(isInsecureEndpoint("http://")).toBe(false);
  });
});
