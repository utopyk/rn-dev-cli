import { appendFileSync } from "fs";

export class Logger {
  private readonly logFile: string;
  private readonly verbose: boolean;

  constructor(logFile: string, verbose = true) {
    this.logFile = logFile;
    this.verbose = verbose;
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string, error?: Error): void {
    let line = this.format("ERROR", message);
    if (error?.stack) {
      const indented = error.stack
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n");
      line += `${indented}\n`;
    }
    appendFileSync(this.logFile, line);
  }

  debug(message: string): void {
    if (!this.verbose) return;
    this.write("DEBUG", message);
  }

  private format(level: string, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] ${level}: ${message}\n`;
  }

  private write(level: string, message: string): void {
    appendFileSync(this.logFile, this.format(level, message));
  }
}
