import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import type { OnSaveAction } from "../types.js";

// ---------------------------------------------------------------------------
// Chokidar mock
// ---------------------------------------------------------------------------

const mockChokidarWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockChokidarWatcher),
}));

// ---------------------------------------------------------------------------
// child_process mock
// ---------------------------------------------------------------------------

// We track spawned processes so individual tests can control exit behavior.
type MockProcess = {
  stdout: { on: Mock };
  stderr: { on: Mock };
  on: Mock;
  kill: Mock;
  pid: number;
  // Simulate process exit by invoking registered 'close' callback
  simulateExit: (code: number) => void;
};

let mockProcesses: MockProcess[] = [];

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();

  return {
    ...actual,
    spawn: vi.fn((): MockProcess => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

      const proc: MockProcess = {
        pid: Math.floor(Math.random() * 9000) + 1000,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = handlers[event] ?? [];
          handlers[event].push(cb);
        }),
        simulateExit: (code: number) => {
          for (const cb of handlers["close"] ?? []) {
            cb(code);
          }
        },
      };

      mockProcesses.push(proc);
      return proc;
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(
  overrides: Partial<OnSaveAction> = {}
): OnSaveAction {
  return {
    name: "test-action",
    enabled: true,
    haltOnFailure: false,
    command: "echo hello",
    showOutput: "silent",
    ...overrides,
  };
}

/** Wait for one macrotask + microtask flush (real timers). */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait for a few ticks to let async chains resolve. */
async function flushAsync(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await nextTick();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileWatcher", () => {
  let FileWatcher: typeof import("../watcher.js").FileWatcher;
  let chokidar: typeof import("chokidar");

  beforeEach(async () => {
    vi.clearAllMocks();
    mockProcesses = [];
    // Reset all handler mocks on the chokidar watcher
    mockChokidarWatcher.on.mockReturnThis();

    // Dynamic import so each describe block gets a fresh module after mock setup
    ({ FileWatcher } = await import("../watcher.js"));
    chokidar = await import("chokidar");
  });

  afterEach(() => {
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // start / stop / toggle / isRunning
  // -------------------------------------------------------------------------

  describe("start()", () => {
    it("creates a chokidar watcher on the projectRoot", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      watcher.start();

      expect(chokidar.watch).toHaveBeenCalledOnce();
      const [watchPath] = (chokidar.watch as Mock).mock.calls[0] as [string];
      expect(watchPath).toBe("/my/project");

      watcher.stop();
    });

    it("passes ignore patterns to chokidar", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      watcher.start();

      const [, options] = (chokidar.watch as Mock).mock
        .calls[0] as [string, { ignored: unknown }];
      expect(options.ignored).toBeDefined();

      watcher.stop();
    });

    it("marks watcher as running after start()", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      expect(watcher.isRunning()).toBe(false);
      watcher.start();
      expect(watcher.isRunning()).toBe(true);
      watcher.stop();
    });
  });

  describe("stop()", () => {
    it("marks watcher as not running after stop()", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      watcher.start();
      expect(watcher.isRunning()).toBe(true);
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it("calls close() on the chokidar watcher", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      watcher.start();
      watcher.stop();

      expect(mockChokidarWatcher.close).toHaveBeenCalledOnce();
    });
  });

  describe("toggle()", () => {
    it("returns false when toggled off (initially enabled)", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      const result = watcher.toggle();
      expect(result).toBe(false);
    });

    it("returns true when toggled back on", () => {
      const watcher = new FileWatcher({
        projectRoot: "/my/project",
        actions: [],
      });

      watcher.toggle(); // off
      const result = watcher.toggle(); // on
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline: runPipeline() behavior tested via event emissions
  //
  // Strategy: debounceMs=0, trigger change, await nextTick() to flush the
  // debounce setTimeout(fn, 0), then simulate process exit + flush microtasks.
  // -------------------------------------------------------------------------

  describe("pipeline", () => {
    /**
     * Triggers the chokidar 'change' handler (simulates a file save),
     * then waits for the debounce timer (0ms) to fire.
     */
    async function triggerChange(files: string[]): Promise<void> {
      const calls = mockChokidarWatcher.on.mock.calls as [
        string,
        (...args: unknown[]) => void
      ][];
      const changeHandler = calls.find(([event]) => event === "change")?.[1];
      if (!changeHandler) throw new Error("No 'change' handler registered");
      for (const f of files) {
        changeHandler(f);
      }
      // Wait for debounce (0ms setTimeout) to fire
      await flushAsync(2);
    }

    it("emits pipeline-start with changed files", async () => {
      const action = makeAction({ command: "echo hi" });
      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const pipelineStartEvents: unknown[] = [];
      watcher.on("pipeline-start", (data) => pipelineStartEvents.push(data));

      await triggerChange(["/proj/src/App.tsx"]);

      expect(pipelineStartEvents.length).toBeGreaterThan(0);
      const event = pipelineStartEvents[0] as { files: string[] };
      expect(event.files).toContain("/proj/src/App.tsx");

      watcher.stop();
    });

    it("runs enabled actions in order and emits action-start / action-complete", async () => {
      const a1 = makeAction({ name: "action-1", command: "echo one" });
      const a2 = makeAction({ name: "action-2", command: "echo two" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [a1, a2],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      const actionCompletes: string[] = [];

      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );
      watcher.on(
        "action-complete",
        ({ name }: { name: string }) => actionCompletes.push(name)
      );

      await triggerChange(["/proj/src/foo.ts"]);

      // action-1 is now awaiting its process to exit
      expect(actionStarts).toContain("action-1");
      mockProcesses[0]?.simulateExit(0);
      await flushAsync();

      expect(actionStarts).toContain("action-2");
      mockProcesses[1]?.simulateExit(0);
      await flushAsync();

      expect(actionCompletes).toEqual(["action-1", "action-2"]);

      watcher.stop();
    });

    it("skips disabled actions", async () => {
      const a1 = makeAction({ name: "enabled-action", command: "echo yes" });
      const a2 = makeAction({
        name: "disabled-action",
        command: "echo no",
        enabled: false,
      });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [a1, a2],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );

      await triggerChange(["/proj/src/foo.ts"]);
      mockProcesses[0]?.simulateExit(0);
      await flushAsync();

      expect(actionStarts).toEqual(["enabled-action"]);
      expect(actionStarts).not.toContain("disabled-action");

      watcher.stop();
    });

    it("halts pipeline when haltOnFailure action fails", async () => {
      const a1 = makeAction({
        name: "failing-action",
        command: "exit 1",
        haltOnFailure: true,
      });
      const a2 = makeAction({ name: "should-not-run", command: "echo after" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [a1, a2],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );

      await triggerChange(["/proj/src/index.ts"]);
      mockProcesses[0]?.simulateExit(1); // fail
      await flushAsync();

      expect(actionStarts).toContain("failing-action");
      expect(actionStarts).not.toContain("should-not-run");

      watcher.stop();
    });

    it("does NOT halt pipeline when haltOnFailure is false and action fails", async () => {
      const a1 = makeAction({
        name: "non-halting-fail",
        command: "exit 1",
        haltOnFailure: false,
      });
      const a2 = makeAction({ name: "runs-anyway", command: "echo after" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [a1, a2],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );

      await triggerChange(["/proj/src/index.ts"]);
      mockProcesses[0]?.simulateExit(1);
      await flushAsync();
      mockProcesses[1]?.simulateExit(0);
      await flushAsync();

      expect(actionStarts).toContain("non-halting-fail");
      expect(actionStarts).toContain("runs-anyway");

      watcher.stop();
    });

    it("replaces {files} placeholder in command with changed file paths", async () => {
      const { spawn } = await import("child_process");
      const spawnMock = spawn as Mock;

      const action = makeAction({
        name: "lint",
        command: "eslint {files}",
      });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      await triggerChange(["/proj/src/a.ts", "/proj/src/b.ts"]);

      expect(spawnMock).toHaveBeenCalled();
      // spawn("sh", ["-c", "<full command>"])
      const callArgs = spawnMock.mock.calls[0] as [string, string[], unknown];
      const commandStr = (callArgs[1] as string[])[1];
      expect(commandStr).toContain("/proj/src/a.ts");
      expect(commandStr).toContain("/proj/src/b.ts");

      watcher.stop();
    });

    it("only runs action when changed file matches glob pattern", async () => {
      const { spawn } = await import("child_process");
      const spawnMock = spawn as Mock;

      const action = makeAction({
        name: "ts-only",
        command: "tsc",
        glob: "**/*.ts",
      });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );

      // Trigger with a .css file — should NOT run ts-only
      await triggerChange(["/proj/src/styles.css"]);

      expect(actionStarts).not.toContain("ts-only");
      expect(spawnMock).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("runs glob-filtered action when at least one changed file matches", async () => {
      const action = makeAction({
        name: "ts-lint",
        command: "eslint --ext .ts {files}",
        glob: "**/*.ts",
      });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const actionStarts: string[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );

      // Mix of .ts and .css — should trigger because at least one matches
      await triggerChange(["/proj/src/styles.css", "/proj/src/App.ts"]);

      expect(actionStarts).toContain("ts-lint");

      watcher.stop();
    });

    it("emits pipeline-complete with results after all actions finish", async () => {
      const action = makeAction({ name: "build", command: "tsc" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const pipelineCompletes: unknown[] = [];
      watcher.on("pipeline-complete", (data) =>
        pipelineCompletes.push(data)
      );

      await triggerChange(["/proj/src/index.ts"]);
      mockProcesses[0]?.simulateExit(0);
      await flushAsync();

      expect(pipelineCompletes.length).toBeGreaterThan(0);
      const result = pipelineCompletes[0] as { results: unknown[] };
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBe(1);

      watcher.stop();
    });

    it("does not run pipeline when watcher is toggled off", async () => {
      const { spawn } = await import("child_process");
      const spawnMock = spawn as Mock;

      const action = makeAction({ name: "build", command: "tsc" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();
      watcher.toggle(); // disable

      await triggerChange(["/proj/src/index.ts"]);

      expect(spawnMock).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("action-complete result has success=true when exit code is 0", async () => {
      const action = makeAction({ name: "test", command: "jest" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const completeEvents: unknown[] = [];
      watcher.on("action-complete", (data) => completeEvents.push(data));

      await triggerChange(["/proj/src/foo.ts"]);
      mockProcesses[0]?.simulateExit(0);
      await flushAsync();

      expect(completeEvents.length).toBeGreaterThan(0);
      const event = completeEvents[0] as {
        name: string;
        result: { success: boolean };
      };
      expect(event.result.success).toBe(true);

      watcher.stop();
    });

    it("action-complete result has success=false when exit code is non-zero", async () => {
      const action = makeAction({ name: "test", command: "jest" });

      const watcher = new FileWatcher({
        projectRoot: "/proj",
        actions: [action],
        debounceMs: 0,
      });

      watcher.start();

      const completeEvents: unknown[] = [];
      watcher.on("action-complete", (data) => completeEvents.push(data));

      await triggerChange(["/proj/src/foo.ts"]);
      mockProcesses[0]?.simulateExit(2);
      await flushAsync();

      expect(completeEvents.length).toBeGreaterThan(0);
      const event = completeEvents[0] as {
        name: string;
        result: { success: boolean };
      };
      expect(event.result.success).toBe(false);

      watcher.stop();
    });
  });
});
