import type { BuildError } from "./types.js";

// Strip ANSI escape codes from text
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

// ---------------------------------------------------------------------------
// Suggestion map (case-insensitive match on error text)
// ---------------------------------------------------------------------------

const SUGGESTION_MAP: Array<[string, string]> = [
  ["no such module", "Try: pod install, or clean build (press 'c')"],
  ["signing requires", "Set DEVELOPMENT_TEAM in Xcode or .xcconfig"],
  ["duplicate symbol", "Check for conflicting pod versions"],
  ["framework not found", "Try: pod deintegrate && pod install"],
  ["sandbox: rsync denied", "Xcode 15+ issue: disable ENABLE_USER_SCRIPT_SANDBOXING"],
  ["sdk does not contain", "Update Xcode or change IPHONEOS_DEPLOYMENT_TARGET"],
  ["could not resolve dependencies", "Check gradle repositories and dependency versions"],
  ["dex merge", "Enable multidex or resolve duplicate dependencies"],
  ["java_home is not set", "Run preflight fix (press 'f')"],
  ["sdk location not found", "Set ANDROID_HOME environment variable"],
  ["exited with error code 'null'", "Build was cancelled or crashed. Try clean build (press 'c')"],
  ["exited with error code '65'", "Open Xcode to see detailed error, or try ultra-clean"],
  ["no development team", "Set DEVELOPMENT_TEAM in Xcode signing settings"],
  ["provisioning profile", "Fix provisioning profile in Xcode signing settings"],
  ["command phasescriptexecution failed", "A build phase script failed. Check Pods or custom scripts"],
];

function findSuggestion(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [pattern, suggestion] of SUGGESTION_MAP) {
    if (lower.includes(pattern)) {
      return suggestion;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// parseXcodebuildErrors
// ---------------------------------------------------------------------------

// Matches: /path/to/File.swift:3:8: error: message
// Also covers: /path/to/File.swift:3:8: fatal error: message
// Capture group 3 captures "fatal error: ..." or "error: ..." prefix + message
const XCODE_FILE_ERROR_RE =
  /^(.+?):(\d+):\d+: ((?:fatal )?error: .+)$/;

// Matches: /path/to/File.swift:3:8: warning: ... (we skip warnings)
// Matches plain: error: something or fatal error: something (no file prefix)
const XCODE_BARE_ERROR_RE = /^((?:fatal )?error: .+)$/;

// Matches RN CLI error wrapper: error Failed to build ios project. "xcodebuild" exited with error code '65'.
const RN_CLI_BUILD_ERROR_RE = /^error\s+(.+)$/i;

// Matches linker errors: ld: message
const XCODE_LD_RE = /^ld: (.+)$/;

// Matches Code Signing errors from Xcode
const XCODE_SIGNING_RE = /^(.*(?:signing|code sign|codesign).*)$/i;

// Matches Reason: lines
const XCODE_REASON_RE = /^Reason: (.+)$/;

// Matches caused by / underlying error lines
const XCODE_CAUSED_BY_RE = /^(?:caused by|underlying error)[:\s]+(.+)$/i;

/**
 * Parses xcodebuild output and returns an array of BuildError objects.
 * Only errors (not warnings) are returned.
 */
export function parseXcodebuildErrors(output: string): BuildError[] {
  const lines = stripAnsi(output).split("\n").map((l) => l.trim()).filter(Boolean);
  const errors: BuildError[] = [];
  let pendingReason: string | undefined;

  for (const line of lines) {
    // Reason / caused by – attach to the most recent error
    const reasonMatch = XCODE_REASON_RE.exec(line);
    if (reasonMatch) {
      pendingReason = reasonMatch[1].trim();
      if (errors.length > 0) {
        errors[errors.length - 1].reason = pendingReason;
      }
      continue;
    }

    const causedByMatch = XCODE_CAUSED_BY_RE.exec(line);
    if (causedByMatch) {
      pendingReason = causedByMatch[1].trim();
      if (errors.length > 0) {
        errors[errors.length - 1].reason = pendingReason;
      }
      continue;
    }

    // File-prefixed error: /path/file.swift:3:8: error: message
    const fileMatch = XCODE_FILE_ERROR_RE.exec(line);
    if (fileMatch) {
      const [, filePath, lineStr, message] = fileMatch;
      const suggestion = findSuggestion(message) ?? findSuggestion(line);
      errors.push({
        source: "xcodebuild",
        summary: message.trim(),
        file: filePath,
        line: parseInt(lineStr, 10),
        rawOutput: line,
        suggestion,
      });
      continue;
    }

    // Linker errors: ld: message
    const ldMatch = XCODE_LD_RE.exec(line);
    if (ldMatch) {
      const message = ldMatch[1].trim();
      const suggestion = findSuggestion(message) ?? findSuggestion(line);
      errors.push({
        source: "xcodebuild",
        summary: `ld: ${message}`,
        rawOutput: line,
        suggestion,
      });
      continue;
    }

    // Bare error: lines (no file prefix, e.g. from script phases)
    const bareMatch = XCODE_BARE_ERROR_RE.exec(line);
    if (bareMatch) {
      const message = bareMatch[1].trim();
      const suggestion = findSuggestion(message) ?? findSuggestion(line);
      errors.push({
        source: "xcodebuild",
        summary: line,
        rawOutput: line,
        suggestion,
      });
      continue;
    }

    // PhaseScriptExecution failures
    if (/^PhaseScriptExecution\s+.+\s+FAILED$/i.test(line)) {
      errors.push({
        source: "xcodebuild",
        summary: line,
        rawOutput: line,
      });
      continue;
    }

    // RN CLI error wrapper: error Failed to build ios project...
    const rnCliMatch = RN_CLI_BUILD_ERROR_RE.exec(line);
    if (rnCliMatch) {
      const message = rnCliMatch[1].trim();
      const suggestion = findSuggestion(message) ?? findSuggestion(line);
      errors.push({
        source: "xcodebuild",
        summary: message,
        rawOutput: line,
        suggestion,
      });
      continue;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// parseGradleErrors
// ---------------------------------------------------------------------------

/**
 * Parses gradle build output and returns an array of BuildError objects.
 */
export function parseGradleErrors(rawOutput: string): BuildError[] {
  const output = stripAnsi(rawOutput);
  // Fast path: no failure markers
  if (!output.includes("FAILURE:") && !output.includes("FAILED")) {
    return [];
  }

  const errors: BuildError[] = [];
  const lines = output.split("\n");

  // -----------------------------------------------------------------------
  // Pass 1 – collect FAILED task lines
  // -----------------------------------------------------------------------
  const failedTaskRe = /^>\s+Task\s+(\S+)\s+FAILED$/;
  for (const raw of lines) {
    const line = raw.trim();
    const m = failedTaskRe.exec(line);
    if (m) {
      errors.push({
        source: "gradle",
        summary: `Task ${m[1]} FAILED`,
        rawOutput: line,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Pass 2 – extract FAILURE blocks (What went wrong + Caused by chains)
  // -----------------------------------------------------------------------
  const text = output;
  // Match from FAILURE: to the next "* Try:" section or end of string.
  // Use a non-greedy match that stops at "* Try:" or "* Get more" separators.
  const failureBlockRe = /FAILURE:[\s\S]*?(?=\n[*] Try:|\n[*] Get more|$)/g;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = failureBlockRe.exec(text)) !== null) {
    const block = blockMatch[0];

    // Extract "What went wrong" content
    const whatWentWrongRe =
      /\* What went wrong:\n([\s\S]+?)(?=\n\n\*|\n\* Try:|\n\* Get more|$)/;
    const wwwMatch = whatWentWrongRe.exec(block);
    const whatWentWrong = wwwMatch ? wwwMatch[1].trim() : block.trim();

    // Extract all "Caused by:" lines
    const causedByRe = /Caused by: (.+)/g;
    const causedBys: string[] = [];
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = causedByRe.exec(whatWentWrong)) !== null) {
      causedBys.push(cbMatch[1].trim());
    }

    // The root cause is the last "Caused by:" entry, or the whole block
    const rootCause =
      causedBys.length > 0 ? causedBys[causedBys.length - 1] : undefined;

    // Build summary from first non-empty line of What went wrong
    const summaryLine = whatWentWrong
      .split("\n")
      .find((l) => l.trim().length > 0) ?? whatWentWrong;

    const suggestion =
      findSuggestion(whatWentWrong) ?? findSuggestion(block);

    errors.push({
      source: "gradle",
      summary: summaryLine.trim(),
      reason: rootCause,
      rawOutput: block.slice(0, 500), // avoid huge rawOutput
      suggestion,
    });
  }

  // If we found no FAILURE block but there are FAILED tasks, that's fine.
  // De-duplicate by summary (in case FAILED task and FAILURE block overlap)
  const seen = new Set<string>();
  return errors.filter((e) => {
    if (seen.has(e.summary)) return false;
    seen.add(e.summary);
    return true;
  });
}
