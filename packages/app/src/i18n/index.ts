import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import de from "./de.json";
import fr from "./fr.json";
import zhCN from "./zh-CN.json";

export const defaultNS = "translation";
export const resources = {
  en: { translation: en },
  de: { translation: de },
  fr: { translation: fr },
  "zh-CN": { translation: zhCN },
} as const;

export type SupportedLanguage = keyof typeof resources;

const SUPPORTED_LANGUAGES = Object.keys(resources) as SupportedLanguage[];

function readInitialLang(): SupportedLanguage {
  try {
    const raw = localStorage.getItem("desk-preferences");
    const lng = raw ? JSON.parse(raw)?.state?.language : null;
    return SUPPORTED_LANGUAGES.includes(lng) ? lng : "en";
  } catch {
    return "en";
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: readInitialLang(),
  fallbackLng: "en",
  defaultNS,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export default i18next;
