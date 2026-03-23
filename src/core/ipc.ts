import net from "node:net";
import { EventEmitter } from "node:events";
import { existsSync, unlinkSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpcMessage {
  /** "command" | "response" | "event" */
  type: string;
  /** "reload", "dev-menu", "clean", "status", etc. */
  action: string;
  payload?: unknown;
  /** Unique message id for request/response matching */
  id: string;
}

export interface IpcMessageEvent {
  message: IpcMessage;
  reply: (response: IpcMessage) => void;
}

// ---------------------------------------------------------------------------
// IpcServer
// ---------------------------------------------------------------------------

export class IpcServer extends EventEmitter {
  private server: net.Server | null = null;

  constructor(private socketPath: string) {
    super();
  }

  /**
   * Start the Unix domain socket server.
   * Removes any stale socket file before binding.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove stale socket file if it exists
      if (existsSync(this.socketPath)) {
        try {
          unlinkSync(this.socketPath);
        } catch {
          // ignore — may have already been removed by another process
        }
      }

      const srv = net.createServer((socket) => {
        let buffer = "";

        socket.setEncoding("utf8");

        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          // Keep incomplete last chunk in buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let message: IpcMessage;
            try {
              message = JSON.parse(trimmed) as IpcMessage;
            } catch {
              // Malformed JSON — skip
              continue;
            }

            const reply = (response: IpcMessage): void => {
              if (!socket.destroyed) {
                socket.write(JSON.stringify(response) + "\n");
              }
            };

            this.emit("message", { message, reply } satisfies IpcMessageEvent);
          }
        });

        socket.on("error", () => {
          // Individual connection errors are non-fatal for the server
        });
      });

      srv.on("error", (err) => {
        reject(err);
      });

      srv.listen(this.socketPath, () => {
        this.server = srv;
        resolve();
      });
    });
  }

  /**
   * Stop the server and remove the socket file.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;

        if (existsSync(this.socketPath)) {
          try {
            unlinkSync(this.socketPath);
          } catch {
            // ignore
          }
        }

        resolve();
      });

      // Destroy all open connections so close() resolves promptly
      // (net.Server.close() only stops accepting new connections by default)
      this.server.closeAllConnections?.();
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }
}

// ---------------------------------------------------------------------------
// IpcClient
// ---------------------------------------------------------------------------

const CLIENT_TIMEOUT_MS = 5_000;

export class IpcClient {
  constructor(private socketPath: string) {}

  /**
   * Send a message to the running TUI and wait for a response.
   * Rejects with a timeout error if no response arrives within 5 seconds.
   */
  send(message: IpcMessage): Promise<IpcMessage> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      let buffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`IPC timeout: no response received within ${CLIENT_TIMEOUT_MS}ms`));
      }, CLIENT_TIMEOUT_MS);

      socket.setEncoding("utf8");

      socket.on("connect", () => {
        socket.write(JSON.stringify(message) + "\n");
      });

      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let response: IpcMessage;
          try {
            response = JSON.parse(trimmed) as IpcMessage;
          } catch {
            continue;
          }

          // Match response to our request by id
          if (response.id === message.id) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(response);
            return;
          }
        }
      });

      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      socket.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("IPC connection closed before response was received"));
      });
    });
  }

  /**
   * Check whether a TUI server is currently reachable on the socket path.
   */
  isServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!existsSync(this.socketPath)) {
        resolve(false);
        return;
      }

      const socket = net.createConnection(this.socketPath);

      const cleanup = (result: boolean): void => {
        socket.destroy();
        resolve(result);
      };

      socket.on("connect", () => cleanup(true));
      socket.on("error", () => cleanup(false));
    });
  }
}
