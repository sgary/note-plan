import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const authRoot = mkdtempSync(join(tmpdir(), "desk-oauth-resource-config-"));

beforeAll(() => {
  process.env.DESK_DATA_ROOT = authRoot;
  process.env.DESK_AUTH_DB = join(authRoot, "auth.sqlite");
});

afterAll(() => {
  delete process.env.DESK_AUTH_DB;
  delete process.env.DESK_DATA_ROOT;
  rmSync(authRoot, { recursive: true, force: true });
});

describe("OAuth protected-resource configuration", () => {
  it("registers the MCP audience for new and existing dynamic clients", async () => {
    const authModule = await import("../../packages/server/src/auth");
    const options = (
      authModule as typeof authModule & {
        oauthProviderOptions?: Record<string, unknown>;
      }
    ).oauthProviderOptions;

    expect(options).toMatchObject({
      resources: [authModule.MCP_RESOURCE],
      enforcePerClientResources: false,
      clientRegistrationDefaultResources: [authModule.MCP_RESOURCE],
      clientRegistrationAllowedResources: [authModule.MCP_RESOURCE],
    });
    expect(options).not.toHaveProperty("validAudiences");
  });
});
