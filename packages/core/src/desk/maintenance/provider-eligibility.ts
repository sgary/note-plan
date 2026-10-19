/**
 * The one rule for "can this provider actually run a call": a resolvable key, plus — for the
 * user-configured `custom` provider — a base URL and a model. Shared by the engine gates
 * (index-updater, rebuild) and the Settings status report (scheduler), so the UI and the
 * engine can never disagree about whether summaries will happen.
 */
import { getAIKeyResolver } from "../ai/key-resolver";
import { getProviderDefinition } from "../ai/provider-registry";
import type { AIProviderType } from "../ai/types";
import type { AIMaintenanceSettings } from "./config";

export async function isProviderConfigured(
  provider: AIProviderType,
  settings: AIMaintenanceSettings,
): Promise<boolean> {
  const key = await getAIKeyResolver()(getProviderDefinition(provider).keyRef);
  if (!key) return false;
  // OpenAI/Anthropic are complete with just a key (model has a default).
  if (provider !== "custom") return true;
  return (
    settings.customBaseURL.trim().length > 0
    && (settings.modelByProvider[provider] ?? "").trim().length > 0
  );
}

export async function isProviderUsable(settings: AIMaintenanceSettings): Promise<boolean> {
  return isProviderConfigured(settings.providerType, settings);
}
