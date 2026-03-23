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

/**
 * Polls `condition` every 10 ms until it returns true or `timeoutMs` elapses.
 * Much more robust than trying to flush exact timer counts.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((r) => setTimeout(r, 10));
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
  // Strategy: debounceMs=0, trigger change, then use waitFor() to poll for
  // the expected condition rather than trying to flush exact timer counts.
  // -------------------------------------------------------------------------

  describe("pipeline", () => {
    /**
     * Triggers the chokidar 'change' handler (simulates a file save).
     * Does NOT wait for any async work — callers use waitFor() for that.
     */
    function triggerChange(files: string[]): void {
      const calls = mockChokidarWatcher.on.mock.calls as [
        string,
        (...args: unknown[]) => void
      ][];
      const changeHandler = calls.find(([event]) => event === "change")?.[1];
      if (!changeHandler) throw new Error("No 'change' handler registered");
      for (const f of files) {
        changeHandler(f);
      }
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

      triggerChange(["/proj/src/App.tsx"]);
      await waitFor(() => pipelineStartEvents.length > 0);

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

      triggerChange(["/proj/src/foo.ts"]);

      // Wait for action-1 to start (spawn is called)
      await waitFor(() => actionStarts.includes("action-1"));
      mockProcesses[0]?.simulateExit(0);

      // Wait for action-2 to start
      await waitFor(() => actionStarts.includes("action-2"));
      mockProcesses[1]?.simulateExit(0);

      // Wait for both to complete
      await waitFor(() => actionCompletes.length >= 2);

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
      const pipelineCompletes: unknown[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );
      watcher.on("pipeline-complete", (data) => pipelineCompletes.push(data));

      triggerChange(["/proj/src/foo.ts"]);
      await waitFor(() => actionStarts.includes("enabled-action"));
      mockProcesses[0]?.simulateExit(0);
      await waitFor(() => pipelineCompletes.length > 0);

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
      const pipelineCompletes: unknown[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );
      watcher.on("pipeline-complete", (data) => pipelineCompletes.push(data));

      triggerChange(["/proj/src/index.ts"]);
      await waitFor(() => actionStarts.includes("failing-action"));
      mockProcesses[0]?.simulateExit(1); // fail
      await waitFor(() => pipelineCompletes.length > 0);

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
      const pipelineCompletes: unknown[] = [];
      watcher.on("action-start", ({ name }: { name: string }) =>
        actionStarts.push(name)
      );
      watcher.on("pipeline-complete", (data) => pipelineCompletes.push(data));

      triggerChange(["/proj/src/index.ts"]);
      await waitFor(() => actionStarts.includes("non-halting-fail"));
      mockProcesses[0]?.simulateExit(1);
      await waitFor(() => actionStarts.includes("runs-anyway"));
      mockProcesses[1]?.simulateExit(0);
      await waitFor(() => pipelineCompletes.length > 0);

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

      triggerChange(["/proj/src/a.ts", "/proj/src/b.ts"]);
      await waitFor(() => spawnMock.mock.calls.length > 0);

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

      const pipelineCompletes: unknown[] = [];
      watcher.on("pipeline-complete", (data) => pipelineCompletes.push(data));

      // Trigger with a .css file — should NOT run ts-only
      triggerChange(["/proj/src/styles.css"]);
      // Wait for pipeline-complete (the pipeline runs but skips all actions)
      await waitFor(() => pipelineCompletes.length > 0);

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
      triggerChange(["/proj/src/styles.css", "/proj/src/App.ts"]);
      await waitFor(() => actionStarts.includes("ts-lint"));

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

      triggerChange(["/proj/src/index.ts"]);
      await waitFor(() => mockProcesses.length > 0);
      mockProcesses[0]?.simulateExit(0);
      await waitFor(() => pipelineCompletes.length > 0);

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

      const pipelineStartEvents: unknown[] = [];
      watcher.on("pipeline-start", (data) => pipelineStartEvents.push(data));

      triggerChange(["/proj/src/index.ts"]);

      // Wait long enough that if the pipeline were going to run, it would have
      await new Promise<void>((r) => setTimeout(r, 50));

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

      triggerChange(["/proj/src/foo.ts"]);
      await waitFor(() => mockProcesses.length > 0);
      mockProcesses[0]?.simulateExit(0);
      await waitFor(() => completeEvents.length > 0);

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

      triggerChange(["/proj/src/foo.ts"]);
      await waitFor(() => mockProcesses.length > 0);
      mockProcesses[0]?.simulateExit(2);
      await waitFor(() => completeEvents.length > 0);

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
