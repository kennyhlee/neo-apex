import { useState, useCallback, useEffect } from 'react';
import { translations, type Locale } from '../i18n/translations.ts';

const STORAGE_KEY = 'preferredLanguage';

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  return 'en-US';
}

let globalLocale: Locale = getInitialLocale();
const listeners = new Set<() => void>();

export function useTranslation() {
  const [locale, setLocaleState] = useState<Locale>(globalLocale);

  useEffect(() => {
    const handler = () => setLocaleState(globalLocale);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const t = useCallback(
    (key: string): string => translations[locale]?.[key] ?? key,
    [locale],
  );

  const setLocale = useCallback((lang: Locale) => {
    globalLocale = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    listeners.forEach((fn) => fn());
  }, []);

  return { t, locale, setLocale };
}
