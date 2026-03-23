import React from "react";
import type { RnDevModule } from "../../core/types.js";
import { DevSpaceView } from "../../ui/layout/DevSpaceView.js";

const DevSpaceViewWithDefaults: React.FC = () =>
  React.createElement(DevSpaceView, {
    metroLines: [],
    toolOutputLines: [],
    shortcuts: [],
  });

export const devSpaceModule: RnDevModule = {
  id: "dev-space",
  name: "Dev Space",
  icon: "🚀",
  order: 0,
  component: DevSpaceViewWithDefaults,
  shortcuts: [
    { key: "r", label: "Reload", action: async () => { /* wired in app */ }, showInPanel: true },
    { key: "d", label: "Dev Menu", action: async () => { /* wired in app */ }, showInPanel: true },
    { key: "l", label: "Lint", action: async () => { /* wired in app */ }, showInPanel: true },
    { key: "t", label: "Type Check", action: async () => { /* wired in app */ }, showInPanel: true },
    { key: "c", label: "Clean", action: async () => { /* wired in app */ }, showInPanel: true },
    { key: "w", label: "Toggle Watcher", action: async () => { /* wired in app */ }, showInPanel: true },
  ],
};
