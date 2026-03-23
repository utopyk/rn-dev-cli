import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Logger } from "../logger.js";

const TMP_DIR = join(tmpdir(), "rn-dev-cli-logger-tests");
let logFile: string;

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  logFile = join(TMP_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
});

afterEach(() => {
  if (existsSync(logFile)) {
    unlinkSync(logFile);
  }
});

function readLog(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

describe("Logger", () => {
  describe("info()", () => {
    it("writes info message to file with correct format", () => {
      const logger = new Logger(logFile);
      logger.info("hello world");

      const content = readLog(logFile);
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(content).toContain("INFO: hello world");
      expect(content.endsWith("\n")).toBe(true);
    });

    it("writes multiple info messages, each on its own line", () => {
      const logger = new Logger(logFile);
      logger.info("first");
      logger.info("second");

      const content = readLog(logFile);
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("INFO: first");
      expect(lines[1]).toContain("INFO: second");
    });
  });

  describe("warn()", () => {
    it("writes warn message with WARN level", () => {
      const logger = new Logger(logFile);
      logger.warn("something suspicious");

      const content = readLog(logFile);
      expect(content).toContain("WARN: something suspicious");
    });
  });

  describe("error()", () => {
    it("writes error message with ERROR level", () => {
      const logger = new Logger(logFile);
      logger.error("something went wrong");

      const content = readLog(logFile);
      expect(content).toContain("ERROR: something went wrong");
    });

    it("includes stack trace when Error object is provided", () => {
      const logger = new Logger(logFile);
      const err = new Error("boom");
      logger.error("caught error", err);

      const content = readLog(logFile);
      expect(content).toContain("ERROR: caught error");
      expect(content).toContain("Error: boom");
      // Stack trace lines start with spaces/indentation
      expect(content).toMatch(/at\s+/);
    });

    it("indents stack trace lines", () => {
      const logger = new Logger(logFile);
      const err = new Error("indented stack");
      logger.error("indented", err);

      const content = readLog(logFile);
      const lines = content.split("\n");
      const stackLines = lines.filter((l) => l.includes("    at "));
      expect(stackLines.length).toBeGreaterThan(0);
    });
  });

  describe("debug()", () => {
    it("writes debug message when verbose=true (default)", () => {
      const logger = new Logger(logFile, true);
      logger.debug("verbose detail");

      const content = readLog(logFile);
      expect(content).toContain("DEBUG: verbose detail");
    });

    it("suppresses debug messages when verbose=false", () => {
      const logger = new Logger(logFile, false);
      logger.debug("suppressed detail");

      const content = readLog(logFile);
      expect(content).not.toContain("DEBUG:");
      expect(content).toBe("");
    });

    it("does not suppress info/warn/error when verbose=false", () => {
      const logger = new Logger(logFile, false);
      logger.info("still shown");
      logger.warn("also shown");
      logger.error("always shown");

      const content = readLog(logFile);
      expect(content).toContain("INFO: still shown");
      expect(content).toContain("WARN: also shown");
      expect(content).toContain("ERROR: always shown");
    });
  });

  describe("timestamp format", () => {
    it("uses ISO 8601 timestamp format", () => {
      const logger = new Logger(logFile);
      logger.info("timestamp test");

      const content = readLog(logFile);
      // Matches [2026-03-22T12:34:56.789Z] or similar ISO format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?\]/);
    });
  });
});
