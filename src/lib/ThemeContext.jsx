import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'stockvip_theme';
export const THEMES = ['dark', 'light'];
const DEFAULT_THEME = 'dark';

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.includes(saved)) return saved;
  } catch { /* localStorage 不可用时退回预设主题 */ }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  // 把目前主题写到 <html data-theme="...">，styles.css 依此切换整套颜色变数
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t) => {
    if (!THEMES.includes(t)) return;
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  return ctx;
}
