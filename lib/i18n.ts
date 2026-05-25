import { create } from "zustand";
import { persist } from "zustand/middleware";
import zh from "../messages/zh.json";
import en from "../messages/en.json";

export type Locale = "zh" | "en";

const messagesMap = { zh, en } as const;

export function getMessages(locale: Locale) {
  return messagesMap[locale] || zh;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "zh",
      setLocale: (locale) => set({ locale }),
    }),
    { name: "lumen-locale" },
  ),
);
