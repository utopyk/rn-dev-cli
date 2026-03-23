import React from "react";
import fs from "fs";
import path from "path";
import type { Theme, ThemeColors } from "../core/types.js";

import midnightData from "../themes/midnight.json" assert { type: "json" };
import emberData from "../themes/ember.json" assert { type: "json" };
import arcticData from "../themes/arctic.json" assert { type: "json" };
import neonDriveData from "../themes/neon-drive.json" assert { type: "json" };

const BUILT_IN_THEMES: Record<string, Theme> = {
  midnight: midnightData as Theme,
  ember: emberData as Theme,
  arctic: arcticData as Theme,
  "neon-drive": neonDriveData as Theme,
};

export function loadBuiltInTheme(name: string): Theme {
  const key = name.toLowerCase();
  const theme = BUILT_IN_THEMES[key];
  if (!theme) {
    throw new Error(`Unknown built-in theme: "${name}"`);
  }
  return theme;
}

export function loadTheme(name: string, customThemesDir?: string): Theme {
  // Try built-in first
  const key = name.toLowerCase();
  if (BUILT_IN_THEMES[key]) {
    return BUILT_IN_THEMES[key];
  }

  // Try custom themes directory
  if (customThemesDir) {
    const filePath = path.join(customThemesDir, `${name}.json`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as Theme;
    }
  }

  throw new Error(`Unknown theme: "${name}"`);
}

export function listThemes(customThemesDir?: string): string[] {
  const builtIn = Object.keys(BUILT_IN_THEMES);

  if (!customThemesDir || !fs.existsSync(customThemesDir)) {
    return builtIn;
  }

  const customFiles = fs
    .readdirSync(customThemesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));

  // Merge, deduplicating by name (built-in takes precedence in ordering)
  const all = [...builtIn];
  for (const name of customFiles) {
    if (!all.includes(name)) {
      all.push(name);
    }
  }
  return all;
}

// React context — default value is Midnight theme colors
const ThemeContext = React.createContext<ThemeColors>(
  (midnightData as Theme).colors
);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ThemeContext.Provider value={theme.colors}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return React.useContext(ThemeContext);
}
