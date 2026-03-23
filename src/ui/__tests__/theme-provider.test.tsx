import { describe, it, expect } from "vitest";
import { loadBuiltInTheme, loadTheme, listThemes } from "../theme-provider.js";

describe("loadBuiltInTheme", () => {
  it("loads midnight theme correctly", () => {
    const theme = loadBuiltInTheme("midnight");
    expect(theme.name).toBe("Midnight");
    expect(theme.colors.bg).toBe("#1a1b26");
    expect(theme.colors.fg).toBe("#c0caf5");
    expect(theme.colors.accent).toBe("#7aa2f7");
    expect(theme.colors.border).toBe("#565f89");
    expect(theme.colors.success).toBe("#9ece6a");
    expect(theme.colors.warning).toBe("#e0af68");
    expect(theme.colors.error).toBe("#f7768e");
    expect(theme.colors.muted).toBe("#565f89");
    expect(theme.colors.highlight).toBe("#bb9af7");
    expect(theme.colors.selection).toBe("#283457");
  });

  it("all 4 built-in themes load with valid colors", () => {
    const themeNames = ["midnight", "ember", "arctic", "neon-drive"];
    const colorKeys = [
      "bg",
      "fg",
      "border",
      "accent",
      "success",
      "warning",
      "error",
      "muted",
      "highlight",
      "selection",
    ] as const;

    for (const name of themeNames) {
      const theme = loadBuiltInTheme(name);
      expect(theme.name).toBeTruthy();
      expect(theme.colors).toBeDefined();
      for (const key of colorKeys) {
        expect(
          theme.colors[key],
          `${name}.colors.${key} should be a hex color`
        ).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("throws for unknown theme name", () => {
    expect(() => loadBuiltInTheme("nonexistent")).toThrow(
      'Unknown built-in theme: "nonexistent"'
    );
  });
});

describe("loadTheme", () => {
  it("loads a built-in theme by name", () => {
    const theme = loadTheme("arctic");
    expect(theme.name).toBe("Arctic");
  });

  it("throws for unknown theme with no custom dir", () => {
    expect(() => loadTheme("unknown")).toThrow('Unknown theme: "unknown"');
  });
});

describe("listThemes", () => {
  it("returns all 4 built-in theme names", () => {
    const themes = listThemes();
    expect(themes).toContain("midnight");
    expect(themes).toContain("ember");
    expect(themes).toContain("arctic");
    expect(themes).toContain("neon-drive");
    expect(themes).toHaveLength(4);
  });
});
