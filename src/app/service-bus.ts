/**
 * Global service bus — bridges the gap between start-flow (outside React)
 * and AppContext (inside React).
 *
 * start-flow emits events when services start/update.
 * AppContext subscribes via useEffect and updates React state.
 * This avoids calling root.render() multiple times.
 */

import { EventEmitter } from "events";
import type { MetroManager } from "../core/metro.js";
import type { FileWatcher } from "../core/watcher.js";

export interface ServiceBusEvents {
  log: (text: string) => void;
  metro: (metro: MetroManager) => void;
  builder: (builder: any) => void;
  watcher: (watcher: FileWatcher) => void;
  worktreeKey: (key: string) => void;
}

class ServiceBus extends EventEmitter {
  log(text: string) {
    this.emit("log", text);
  }

  setMetro(metro: MetroManager) {
    this.emit("metro", metro);
  }

  setBuilder(builder: any) {
    this.emit("builder", builder);
  }

  setWatcher(watcher: FileWatcher) {
    this.emit("watcher", watcher);
  }

  setWorktreeKey(key: string) {
    this.emit("worktreeKey", key);
  }
}

// Singleton — shared between start-flow and AppContext
export const serviceBus = new ServiceBus();
