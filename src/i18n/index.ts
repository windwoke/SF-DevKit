import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_STORAGE_KEY = "sfdevkit.language";

function normalizeLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) return null;
  if (value === "zh-CN" || value.startsWith("zh")) return "zh-CN";
  if (value === "en-US" || value.startsWith("en")) return "en-US";
  return null;
}

function resolveInitialLanguage(): SupportedLanguage {
  const saved = normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  if (saved) return saved;
  const system = normalizeLanguage(window.navigator.language);
  return system ?? "zh-CN";
}

const initialLanguage = resolveInitialLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: initialLanguage,
  fallbackLng: "en-US",
  interpolation: {
    escapeValue: false,
  },
});

void i18n.on("languageChanged", (lng) => {
  const normalized = normalizeLanguage(lng) ?? "zh-CN";
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
});

export default i18n;
