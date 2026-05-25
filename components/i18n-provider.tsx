"use client";

import { NextIntlClientProvider } from "next-intl";
import { useLocaleStore, getMessages } from "@/lib/i18n";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const messages = getMessages(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
