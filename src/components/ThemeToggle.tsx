import { useTheme } from '../lib/theme';
import { IconMoon, IconSun } from './Icons';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      title={theme === 'light' ? 'Dark theme' : 'Light theme'}
    >
      {theme === 'light' ? <IconMoon /> : <IconSun />}
    </button>
  );
}
