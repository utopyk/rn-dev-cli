import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Theme, ThemeColors } from '../types';

const defaultTheme: Theme = {
  name: 'Midnight',
  colors: {
    bg: '#1a1b26',
    fg: '#c0caf5',
    border: '#565f89',
    accent: '#7aa2f7',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    muted: '#565f89',
    highlight: '#bb9af7',
    selection: '#283457',
  },
};

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyThemeToRoot(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty('--bg', colors.bg);
  root.style.setProperty('--fg', colors.fg);
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--success', colors.success);
  root.style.setProperty('--warning', colors.warning);
  root.style.setProperty('--error', colors.error);
  root.style.setProperty('--muted', colors.muted);
  root.style.setProperty('--highlight', colors.highlight);
  root.style.setProperty('--selection', colors.selection);
  // Derived
  root.style.setProperty('--panel-focus', darken(colors.bg, 0.15));
}

function darken(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyThemeToRoot(t.colors);
  }, []);

  useEffect(() => {
    applyThemeToRoot(theme.colors);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
