import { useEffect, useState } from "react";
import {
  SettingsField,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "@/components/ui/settings-section";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAISettingsStore } from "@/stores/ai";
import { useAIMaintenanceSettingsStore } from "@/stores/ai-maintenance-settings";
import { useAIMaintenanceInfo } from "@/hooks/use-ai-maintenance-info";
import { aiMaintenanceKeys } from "@/lib/query-client";
import { PROVIDER_MODELS, DEFAULT_MODELS, getDeskService } from "@desk/core";
import type { AIProviderType, AIUsageRecord } from "@desk/core";
import { BrowserModeError, getSecret, setSecret, type SecretKeyRef } from "@/lib/ai/secrets";
import { isTauri } from "@desk/core";
import { isInsecureEndpoint } from "@/lib/ai/custom-endpoint";
import { isDomainRemote } from "@/lib/connection";
import { SmartIndexSection } from "./smart-index-section";

/**
 * One explicit map per concern, all keyed by provider: adding a provider fails to compile here
 * rather than silently reusing another provider's label, keychain entry, or placeholder.
 */
const PROVIDER_LABEL_KEY: Record<AIProviderType, string> = {
  openai: "settings.ai.providers.openai",
  anthropic: "settings.ai.providers.anthropic",
  custom: "settings.ai.providers.custom",
};

const KEY_REF_BY_PROVIDER: Record<AIProviderType, SecretKeyRef> = {
  openai: "ai.openai",
  anthropic: "ai.anthropic",
  custom: "ai.custom",
};

const API_KEY_PLACEHOLDER_KEY: Record<AIProviderType, string> = {
  openai: "settings.ai.apiKey.placeholderOpenai",
  anthropic: "settings.ai.apiKey.placeholderAnthropic",
  custom: "settings.ai.apiKey.placeholderCustom",
};

function linuxKeyringHint(message: string, t: (key: string) => string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("secret service") || lower.includes("no such interface") || lower.includes("dbus")) {
    return t("settings.ai.errors.linuxKeyring");
  }
  return null;
}

/**
 * Usage is read through DeskService so the panel shows whichever host actually ran the AI —
 * the app in local mode, the server in hosted mode.
 */
function AIUsageStats() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: records = [] } = useQuery<AIUsageRecord[]>({
    queryKey: ["ai-usage"],
    queryFn: () => getDeskService().getAIUsage(),
  });
  const clearUsage = useMutation({
    mutationFn: () => getDeskService().clearAIUsage(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-usage"] }),
  });

  const stats = {
    totalTokens: records.reduce((sum, r) => sum + r.usage.totalTokens, 0),
    totalRequests: records.length,
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {records.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
            clearUsage.mutate(undefined, {
              onSuccess: () => toast.success(t("toasts.settings.usageCleared")),
            });
          }}>
            {t("settings.ai.usage.clear")}
          </Button>
        )}
      </div>

      {stats.totalRequests === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.ai.usage.noUsage")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <p className="text-2xl font-semibold">{formatNumber(stats.totalTokens)}</p>
            <p className="text-xs text-muted-foreground">{t("settings.ai.usage.totalTokens")}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <p className="text-2xl font-semibold">{stats.totalRequests}</p>
            <p className="text-xs text-muted-foreground">{t("settings.ai.usage.requests")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function AITab() {
  const { t } = useTranslation();
  // DEVICE state: privacy consent (per machine). Whether a provider key exists is read live
  // from the host that owns the data (useAIMaintenanceInfo), not mirrored here. USER state
  // (provider/model selection): shared settings file, so the server engine follows the choice.
  const { aiConsentGiven, setAIConsentGiven } = useAISettingsStore();
  const {
    providerType,
    modelByProvider,
    customBaseURL,
    customHeaders,
    customSessionId,
    setProviderType,
    setModelForProvider,
    setCustomBaseURL,
    setCustomHeaders,
    setCustomSessionId,
  } = useAIMaintenanceSettingsStore();
  const queryClient = useQueryClient();

  const safeProviderType: AIProviderType =
    providerType in PROVIDER_MODELS ? providerType : "openai";
  const isCustom = safeProviderType === "custom";
  const activeModel = modelByProvider[safeProviderType] || DEFAULT_MODELS[safeProviderType];
  const modelOptions = PROVIDER_MODELS[safeProviderType];
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const browserMode = !isTauri();

  // Which providers have a resolvable key on the host that owns the data (this machine's
  // Keychain locally, the server's env in hosted mode). One source of truth for both.
  const remote = isDomainRemote();
  const { data: maintenanceInfo } = useAIMaintenanceInfo();

  const providerLabel = (p: AIProviderType): string => t(PROVIDER_LABEL_KEY[p]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const keyRef = KEY_REF_BY_PROVIDER[safeProviderType];
      try {
        const key = await getSecret(keyRef);
        if (cancelled) return;
        setApiKeyInput(key ?? "");
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setApiKeyInput("");
        setLoadError(error instanceof BrowserModeError ? null : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeProviderType]);

  useEffect(() => {
    if (providerType !== safeProviderType) {
      setProviderType(safeProviderType);
    }
  }, [providerType, safeProviderType, setProviderType]);

  // OpenCode Go rejects requests without a session header. Generate the id once and keep it
  // stable (a fresh value per request would defeat OpenCode's prompt caching).
  useEffect(() => {
    if (isCustom && !customSessionId) {
      setCustomSessionId(crypto.randomUUID());
    }
  }, [isCustom, customSessionId, setCustomSessionId]);

  /** Writes the current input to the Keychain and refreshes the "configured?" readers. */
  const persistApiKey = async (): Promise<boolean> => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return false;
    await setSecret(KEY_REF_BY_PROVIDER[safeProviderType], trimmed);
    // The key now resolves from the Keychain; re-ask the host so every "configured?" reader updates.
    await queryClient.invalidateQueries({ queryKey: aiMaintenanceKeys.info });
    setLoadError(null);
    return true;
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      toast.error(t("errors.settings.apiKeyEmpty"));
      return;
    }

    setIsSavingKey(true);
    try {
      await persistApiKey();
      toast.success(t("toasts.settings.apiKeySaved", { provider: providerLabel(safeProviderType) }));
    } catch (error) {
      const message = String(error);
      const hint = linuxKeyringHint(message, t);
      toast.error(
        hint
          ? t("errors.settings.apiKeySaveFailedWithHint", { message, hint })
          : t("errors.settings.apiKeySaveFailed", { message }),
      );
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // Test what the user sees: persist a pending key first. A save failure (e.g. no keychain
      // in browser mode) is not fatal here — we still probe with whatever the host already has.
      if (apiKeyInput.trim()) {
        try {
          await persistApiKey();
        } catch {
          /* fall through to the probe */
        }
      }
      const result = await getDeskService().testAIConnection();
      if (result.ok) {
        toast.success(t("settings.ai.testConnection.success"));
      } else {
        toast.error(t("settings.ai.testConnection.failed"), {
          description: t(`errors.ai.${result.code ?? "unknown"}`),
        });
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t("settings.ai.provider.title")}
        description={t("settings.ai.provider.description")}
      >
        <SettingsGroup>
          <SettingsRow
            label={t("settings.ai.provider.label")}
            description={t("settings.ai.provider.helperText")}
          >
            <Select
              value={safeProviderType}
              onValueChange={(value: AIProviderType) => {
                setProviderType(value);
                toast.success(t("toasts.settings.providerSet", { provider: providerLabel(value) }));
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t("settings.ai.providers.openai")}</SelectItem>
                <SelectItem value="anthropic">{t("settings.ai.providers.anthropic")}</SelectItem>
                <SelectItem value="custom">{t("settings.ai.providers.custom")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          {isCustom && (
            <>
              <SettingsRow
                label={t("settings.ai.customBaseUrl.label")}
                description={t("settings.ai.customBaseUrl.helperText")}
              >
                <div className="w-full sm:w-[320px] space-y-1">
                  <Input
                    value={customBaseURL}
                    onChange={(event) => setCustomBaseURL(event.target.value)}
                    placeholder={t("settings.ai.customBaseUrl.placeholder")}
                    className="bg-background/80 font-mono text-sm"
                  />
                  {isInsecureEndpoint(customBaseURL) && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {t("settings.ai.customBaseUrl.insecureWarning")}
                    </p>
                  )}
                </div>
              </SettingsRow>
              <SettingsRow
                label={t("settings.ai.customHeaders.label")}
                description={t("settings.ai.customHeaders.helperText")}
              >
                <Textarea
                  value={customHeaders}
                  onChange={(event) => setCustomHeaders(event.target.value)}
                  placeholder={t("settings.ai.customHeaders.placeholder")}
                  rows={3}
                  spellCheck={false}
                  className="w-full bg-background/80 font-mono text-xs sm:w-[320px]"
                />
              </SettingsRow>
            </>
          )}
          <SettingsRow
            label={t("settings.ai.model.label")}
            description={
              isCustom
                ? t("settings.ai.model.freeTextHelperText")
                : t("settings.ai.model.helperText")
            }
          >
            {isCustom ? (
              <Input
                value={activeModel}
                onChange={(event) => setModelForProvider("custom", event.target.value)}
                placeholder="deepseek-chat"
                className="w-full bg-background/80 font-mono text-sm sm:w-[240px]"
              />
            ) : (
              <Select
                value={activeModel}
                onValueChange={(value) => {
                  setModelForProvider(safeProviderType, value);
                  const label = modelOptions.find((model) => model.id === value)?.label ?? value;
                  toast.success(t("toasts.settings.modelSet", { model: label }));
                }}
              >
                <SelectTrigger className="w-full sm:w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings.ai.credentials.title")}
        description={t("settings.ai.credentials.description")}
      >
        {remote ? (
          <SettingsNotice title={t("settings.ai.serverMode.title")}>
            <p>{t("settings.ai.serverMode.description")}</p>
            <p className="mt-2 font-medium text-foreground">
              {maintenanceInfo?.providerConfigured[safeProviderType]
                ? t("settings.ai.serverMode.providerConfigured", {
                    provider: providerLabel(safeProviderType),
                  })
                : t("settings.ai.serverMode.providerNotConfigured", {
                    provider: providerLabel(safeProviderType),
                  })}
            </p>
          </SettingsNotice>
        ) : (
          <SettingsGroup>
            <SettingsField
              label={t("settings.ai.apiKey.label", { provider: providerLabel(safeProviderType) })}
              htmlFor="api-key"
              footer={t("settings.ai.apiKey.storedNotice")}
            >
              {browserMode && (
                <SettingsNotice title={t("settings.ai.browserMode.title")}>
                  {t("settings.ai.browserMode.description")}
                </SettingsNotice>
              )}
              {loadError && !browserMode && (
                <SettingsNotice tone="error" title={t("settings.ai.keychainError.title")}>
                  <p>{t("settings.ai.keychainError.description")}</p>
                  {linuxKeyringHint(loadError, t) && <p>{linuxKeyringHint(loadError, t)}</p>}
                  <details>
                    <summary className="cursor-pointer">
                      {t("settings.ai.keychainError.errorDetails")}
                    </summary>
                    <p className="mt-1 break-all font-mono">{loadError}</p>
                  </details>
                </SettingsNotice>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Input
                    id="api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    placeholder={t(API_KEY_PLACEHOLDER_KEY[safeProviderType])}
                    className="bg-background/80 pr-10 font-mono text-sm"
                    disabled={browserMode}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowApiKey(!showApiKey)}
                    disabled={browserMode}
                    aria-label={
                      showApiKey
                        ? t("settings.ai.apiKey.hideAriaLabel")
                        : t("settings.ai.apiKey.showAriaLabel")
                    }
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                <Button onClick={handleSaveApiKey} disabled={isSavingKey || browserMode}>
                  {t("common.buttons.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || browserMode}
                >
                  {isTesting
                    ? t("settings.ai.testConnection.testing")
                    : t("settings.ai.testConnection.button")}
                </Button>
              </div>
              {!browserMode &&
                !loadError &&
                maintenanceInfo &&
                !maintenanceInfo.providerConfigured[safeProviderType] && (
                  <SettingsNotice tone="warning">
                    {t("settings.ai.apiKey.notConfigured")}
                  </SettingsNotice>
                )}
            </SettingsField>
          </SettingsGroup>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings.ai.usage.title")}
        description={t("settings.ai.usage.description")}
      >
        <SettingsGroup>
          <SettingsField>
            <AIUsageStats />
          </SettingsField>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings.ai.privacy.title")}
        description={t("settings.ai.privacy.description")}
      >
        <SettingsGroup>
          <SettingsField className="text-sm leading-relaxed text-muted-foreground">
            <p>{t("settings.ai.privacy.intro")}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="text-foreground">
                  {t("settings.ai.privacy.smartIndexLabel")}
                </span>
                {t("settings.ai.privacy.smartIndexBody")}
              </li>
            </ul>
            <p>{t("settings.ai.privacy.retention")}</p>
          </SettingsField>
          <SettingsRow
            label={t("settings.ai.privacy.acknowledgement.title")}
            description={
              aiConsentGiven
                ? t("settings.ai.privacy.acknowledgement.given")
                : t("settings.ai.privacy.acknowledgement.notGiven")
            }
          >
            {aiConsentGiven && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAIConsentGiven(false);
                  toast.success(t("toasts.settings.privacyAcknowledgementReset"));
                }}
              >
                {t("settings.ai.privacy.acknowledgement.revoke")}
              </Button>
            )}
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SmartIndexSection />
    </div>
  );
}
