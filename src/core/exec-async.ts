/**
 * Non-blocking shell execution using Bun.spawn.
 * Drop-in replacement for execSync that doesn't freeze the event loop.
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
  const proc = Bun.spawn(parts, {
    cwd: options?.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
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

  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

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

  const proc = Bun.spawn(parts, {
    cwd: options?.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
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

  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

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
  const proc = Bun.spawn(["sh", "-c", cmd], {
    cwd: options?.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
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

  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

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
