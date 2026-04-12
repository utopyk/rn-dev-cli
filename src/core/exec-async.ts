/**
 * Non-blocking shell execution using Node's child_process.spawn.
 * Compatible with both Bun and Node.js (Electron).
 */

import { spawn } from "child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Collect all data from a Node readable stream into a string.
 */
function collectStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  return new Promise((resolve) => {
    if (!stream) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
    stream.on("error", () => resolve(Buffer.concat(chunks).toString()));
  });
}

/**
 * Wait for a spawned child process to exit, returning its exit code.
 */
function waitForExit(proc: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    proc.on("exit", (code) => resolve(code ?? 1));
    proc.on("error", () => resolve(1));
  });
}

/**
 * Run a command asynchronously. Never blocks the event loop.
 * Returns stdout on success, throws on failure (like execSync).
 */
export async function execAsync(
  cmd: string,
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<string> {
  const parts = cmd.split(" ");
  const proc = spawn(parts[0], parts.slice(1), {
    cwd: options?.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options?.env },
  });

  // Timeout handling
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options?.timeout) {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeout);
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    waitForExit(proc),
    collectStream(proc.stdout),
    collectStream(proc.stderr),
  ]);
  if (timer) clearTimeout(timer);

  if (timedOut) {
    throw new Error(`Command timed out after ${options!.timeout}ms: ${cmd}`);
  }

  if (exitCode !== 0) {
    const err = new Error(`Command failed (exit ${exitCode}): ${cmd}\n${stderr}`);
    (err as any).stdout = stdout;
    (err as any).stderr = stderr;
    (err as any).status = exitCode;
    throw err;
  }

  return stdout;
}

/**
 * Run a command and return the result without throwing.
 * Useful when you want to handle failures yourself.
 */
export async function execAsyncSafe(
  cmd: string,
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<ExecResult> {
  const parts = cmd.split(" ");
  const proc = spawn(parts[0], parts.slice(1), {
    cwd: options?.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options?.env },
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options?.timeout) {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeout);
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    waitForExit(proc),
    collectStream(proc.stdout),
    collectStream(proc.stderr),
  ]);
  if (timer) clearTimeout(timer);

  return {
    stdout,
    stderr,
    exitCode: timedOut ? -1 : exitCode,
  };
}

/**
 * Run a shell command (supports pipes, redirects, etc).
 */
export async function execShellAsync(
  cmd: string,
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<string> {
  const proc = spawn("sh", ["-c", cmd], {
    cwd: options?.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options?.env },
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options?.timeout) {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeout);
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    waitForExit(proc),
    collectStream(proc.stdout),
    collectStream(proc.stderr),
  ]);
  if (timer) clearTimeout(timer);

  if (timedOut) {
    throw new Error(`Command timed out after ${options!.timeout}ms: ${cmd}`);
  }

  if (exitCode !== 0) {
    const err = new Error(`Command failed (exit ${exitCode}): ${cmd}\n${stderr}`);
    (err as any).stdout = stdout;
    (err as any).stderr = stderr;
    (err as any).status = exitCode;
    throw err;
  }

  return stdout;
}
