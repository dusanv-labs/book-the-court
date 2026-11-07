import { createContext, useContext } from 'react';
import { en, type Lang, type Messages } from './messages';

export interface I18nState {
  lang: Lang;
  m: Messages;
  setLang: (lang: Lang) => void;
}

export const I18nContext = createContext<I18nState>({ lang: 'en', m: en, setLang: () => {} });

/** Current language and its messages: `const { m } = useI18n(); m.booking.title` */
export function useI18n(): I18nState {
  return useContext(I18nContext);
}

const STORAGE_KEY = 'btc_lang';
const SERBIAN_LIKE = ['sr', 'hr', 'bs', 'sh', 'cnr'];

/** Saved choice first, then the browser language (Serbian/Croatian/Bosnian → sr), else English. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'sr') return saved;
  } catch {
    /* storage unavailable */
  }
  const browser = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase().split('-')[0];
  return SERBIAN_LIKE.includes(browser) ? 'sr' : 'en';
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}
