import type { Theme } from '../types.js';

export const softDark: Theme = {
  name: 'Soft Dark',
  colors: {
    // Neumorphic tokens
    bg:             '#14151E',
    bgSoft:         '#1A1B26',
    surface:        '#1E202B',
    surfaceHi:      '#262833',
    ink:            '#ECEEF5',
    inkSoft:        '#C5C8D2',
    muted:          '#7D8192',
    muted2:         '#525668',
    glow:           '#FF8A2A',
    glowWarm:       '#FFB457',
    ready:          '#2BD96A',
    booting:        '#FFB020',
    shadowLight:    'rgba(255, 255, 255, 0.05)',
    shadowDark:     'rgba(0, 0, 0, 0.55)',
    shadowDarkSoft: 'rgba(0, 0, 0, 0.35)',
    glowMedium:     '0 3px 14px rgb(193 146 255 / 26%), 0 18px 38px rgb(200 135 255 / 28%)',
    accentBorder:   '#cc97cc',
    bodyBg:         'radial-gradient(1200px 700px at 85% 10%, #1E1F2B 0%, transparent 60%), radial-gradient(900px 700px at 10% 90%, #181A24 0%, transparent 55%), #14151E',
    // Legacy keys
    fg:             '#ECEEF5',
    border:         '#cc97cc',
    accent:         '#FF8A2A',
    success:        '#2BD96A',
    warning:        '#FFB020',
    error:          '#f7768e',
    highlight:      '#FF8A2A',
    selection:      '#262833',
  },
};

export const softLight: Theme = {
  name: 'Soft Light',
  colors: {
    // Neumorphic tokens
    bg:             '#E8E4F0',
    bgSoft:         '#EEEAF4',
    surface:        '#F5F2FA',
    surfaceHi:      '#FFFFFF',
    ink:            '#1A1F2E',
    inkSoft:        '#2A3042',
    muted:          '#6B6E7D',
    muted2:         '#9A9CA8',
    glow:           '#FF8A2A',
    glowWarm:       '#FFB457',
    ready:          '#2BD96A',
    booting:        '#FFB020',
    shadowLight:    'rgba(255, 255, 255, 0.9)',
    shadowDark:     'rgba(163, 156, 184, 0.55)',
    shadowDarkSoft: 'rgba(163, 156, 184, 0.35)',
    glowMedium:     '0 8px 22px rgb(255 195 146 / 55%), 0 18px 38px rgb(255 224 135 / 28%)',
    accentBorder:   'transparent',
    bodyBg:         'radial-gradient(1200px 700px at 85% 10%, #EFE8F5 0%, transparent 60%), radial-gradient(900px 700px at 10% 90%, #E2DCEC 0%, transparent 55%), #E8E4F0',
    // Legacy keys
    fg:             '#1A1F2E',
    border:         'rgba(163, 156, 184, 0.35)',
    accent:         '#FF8A2A',
    success:        '#2BD96A',
    warning:        '#FFB020',
    error:          '#f7768e',
    highlight:      '#FF8A2A',
    selection:      '#FFFFFF',
  },
};
