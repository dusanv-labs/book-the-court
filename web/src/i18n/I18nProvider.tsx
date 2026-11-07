import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectLang, I18nContext, saveLang } from './context';
import { MESSAGES, type Lang } from './messages';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
  }, []);

  // Keep <html lang> and the page title in sync for screen readers and search engines.
  useEffect(() => {
    document.documentElement.lang = lang === 'sr' ? 'sr-Latn' : 'en';
    document.title = MESSAGES[lang].meta.title;
  }, [lang]);

  const value = useMemo(() => ({ lang, m: MESSAGES[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
