/** Theme color tokens */
export interface ThemeColors {
  bg: string;
  fg: string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  highlight: string;
  selection: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
}

/** IPC bridge exposed on window.rndev */
export interface RnDevBridge {
  on: (channel: string, callback: (...args: any[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

declare global {
  interface Window {
    rndev?: RnDevBridge;
  }
}

export type ViewTab = 'dev-space' | 'lint-test' | 'metro-logs' | 'settings';

export interface ProfileInfo {
  name: string;
  branch: string;
  platform: string;
  dirty: boolean;
  port: number;
  buildType: string;
}
