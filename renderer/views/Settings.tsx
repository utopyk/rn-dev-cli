import React from 'react';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../types';
import './Settings.css';

const themes: Theme[] = [
  {
    name: 'Midnight',
    colors: { bg: '#1a1b26', fg: '#c0caf5', border: '#565f89', accent: '#7aa2f7', success: '#9ece6a', warning: '#e0af68', error: '#f7768e', muted: '#565f89', highlight: '#bb9af7', selection: '#283457' },
  },
  {
    name: 'Ember',
    colors: { bg: '#1c1210', fg: '#e8d5c4', border: '#6b4c3b', accent: '#e8976c', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', muted: '#6b4c3b', highlight: '#d08770', selection: '#3b2520' },
  },
  {
    name: 'Arctic',
    colors: { bg: '#1b2330', fg: '#d8dee9', border: '#4c566a', accent: '#88c0d0', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', muted: '#4c566a', highlight: '#b48ead', selection: '#2e3440' },
  },
  {
    name: 'Neon Drive',
    colors: { bg: '#0d0d1a', fg: '#e0e0ff', border: '#3d3d5c', accent: '#00ffcc', success: '#39ff14', warning: '#ffcc00', error: '#ff0055', muted: '#3d3d5c', highlight: '#ff00ff', selection: '#1a1a33' },
  },
];

export function Settings() {
  const { theme: currentTheme, setTheme } = useTheme();

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">Theme</h3>
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              key={t.name}
              className={`theme-card${currentTheme.name === t.name ? ' active' : ''}`}
              onClick={() => setTheme(t)}
            >
              <div className="theme-preview" style={{ background: t.colors.bg }}>
                <div className="theme-swatch" style={{ background: t.colors.accent }} />
                <div className="theme-swatch" style={{ background: t.colors.success }} />
                <div className="theme-swatch" style={{ background: t.colors.error }} />
                <div className="theme-swatch" style={{ background: t.colors.highlight }} />
              </div>
              <div className="theme-name">{t.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
