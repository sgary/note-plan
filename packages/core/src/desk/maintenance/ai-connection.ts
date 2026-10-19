/**
 * "Test connection" for the Settings UI. Runs where the data (and the key) live, so a remote
 * client tests the SERVER's configuration, not its own. Returns a classified result instead of
 * throwing: an incomplete configuration is an expected answer here, not an error.
 */
import { isAIProviderError, type AIErrorCode } from "../ai/errors";
import { getAIMaintenanceSettings, createMaintenanceService } from "./config";
import { isProviderUsable } from "./provider-eligibility";

export interface AIConnectionTestResult {
  ok: boolean;
  code?: AIErrorCode;
  message?: string;
}

export async function testAIConnection(): Promise<AIConnectionTestResult> {
  const settings = await getAIMaintenanceSettings();
  if (!(await isProviderUsable(settings))) {
    return {
      ok: false,
      code: "invalid-config",
      message: "The selected provider is not fully configured.",
    };
  }

  const service = createMaintenanceService(settings, "index");
  try {
    // Minimal round-trip: the answer is irrelevant, reaching the endpoint is the point.
    await service.custom("You are a connectivity probe.", "ping");
    return { ok: true };
  } catch (error) {
    if (isAIProviderError(error)) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: "unknown", message: String(error) };
  }
}
