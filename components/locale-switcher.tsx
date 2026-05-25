"use client";

import { useLocaleStore, type Locale } from "@/lib/i18n";

const labels: Record<Locale, string> = { zh: "中", en: "EN" };
const next: Record<Locale, Locale> = { zh: "en", en: "zh" };

export function LocaleSwitcher() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <button
      onClick={() => setLocale(next[locale])}
      className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
      title={`Switch to ${next[locale] === "zh" ? "中文" : "English"}`}
    >
      {labels[locale]}
    </button>
  );
}
