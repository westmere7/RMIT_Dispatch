import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSettings } from '../store/settings';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'rmit-dispatch-theme';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, save } = useSettings();
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  // In 'system' mode the OS drives the theme, live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = settings.theme === 'system' ? systemTheme : settings.theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  /**
   * The top-bar toggle picks a side explicitly, leaving 'system'. It has
   * no Save button of its own, so it commits immediately rather than
   * leaving the settings page dirty.
   */
  const toggle = useCallback(
    () => void save({ theme: theme === 'light' ? 'dark' : 'light' }),
    [theme, save],
  );

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
