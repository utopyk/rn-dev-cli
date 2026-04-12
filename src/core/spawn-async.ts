/**
 * Runtime-agnostic async spawn wrapper.
 * Uses Bun.spawn when available, falls back to Node's child_process.spawn.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';

export interface SpawnResult {
  pid: number;
  stdout: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
  stderr: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
  exited: Promise<number>;
  kill: () => void;
}

/**
 * Spawn a process asynchronously. Works in both Bun and Node.js.
 */
export function spawnAsync(
  cmd: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: 'ignore' | 'pipe' | 'inherit';
    stdout?: 'ignore' | 'pipe' | 'inherit';
    stderr?: 'ignore' | 'pipe' | 'inherit';
  }
): SpawnResult {
  const [command, ...args] = cmd;

  const child: ChildProcess = nodeSpawn(command, args, {
    cwd: options?.cwd,
    env: options?.env as NodeJS.ProcessEnv,
    stdio: [
      options?.stdin ?? 'ignore',
      options?.stdout ?? 'pipe',
      options?.stderr ?? 'pipe',
    ],
  });

  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  return {
    pid: child.pid ?? 0,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill: () => {
      try { child.kill('SIGKILL'); } catch {}
    },
  };
}

/**
 * Read a Node.js readable stream line by line, calling onLine for each.
 */
export function readLines(
  stream: NodeJS.ReadableStream | ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;

  // Node.js stream
  if ('on' in stream && typeof stream.on === 'function') {
    let buffer = '';
    (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    });
    (stream as NodeJS.ReadableStream).on('end', () => {
      if (buffer.trim()) onLine(buffer);
    });
    return;
  }

  // Web ReadableStream (Bun)
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) {
        if (buf.trim()) onLine(buf);
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
      read();
    }).catch(() => {});
  }

  read();
}
