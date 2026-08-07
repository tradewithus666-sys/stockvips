import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { translate, DEFAULT_LANG, LANGS } from './i18n';

const LangContext = createContext(null);
const STORAGE_KEY = 'stockvip_lang';

function readInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* localStorage 不可用时退回预设语言 */ }
  return DEFAULT_LANG;
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readInitialLang);

  const setLang = useCallback((l) => {
    if (!LANGS.includes(l)) return;
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key, ...args) => translate(lang, key, ...args), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang 必须在 <LangProvider> 内使用');
  return ctx;
}
