import React from 'react';
import type { BuildError } from '../types';
import './ErrorSummary.css';

interface ErrorSummaryProps {
  errors: BuildError[];
}

/** Noise patterns to filter out of error display */
const NOISE_PATTERNS = [
  /^error export /i,                    // env var dumps
  /\\=/,                                 // escaped equals in compiler flags
  /^\s*\^~+\s*$/,                       // pointer lines like ^~~~
  /DerivedData/,                        // Xcode derived data paths
  /^\s*debug\b/i,                       // debug lines
  /^.{0,9}$/,                           // very short lines (symbols only)
];

/** Patterns that indicate a real error worth keeping */
const ERROR_PATTERNS: Array<{ pattern: RegExp; extract?: (match: RegExpMatchArray, line: string) => Partial<BuildError> }> = [
  {
    // "error: Something went wrong" with optional file path
    pattern: /^(.+?):(\d+):?\d*:?\s*error:\s*(.+)/,
    extract: (m) => ({ file: m[1], line: parseInt(m[2], 10), message: m[3].trim() }),
  },
  {
    // Generic "error: message" without file
    pattern: /^\s*error:\s*(.+)/i,
    extract: (m) => ({ message: m[1].trim() }),
  },
  {
    pattern: /ld:\s*symbol\(s\)\s*not found/i,
    extract: () => ({ message: 'Linker error: symbol(s) not found for architecture' }),
  },
  {
    pattern: /linker command failed/i,
    extract: () => ({ message: 'Linker command failed with exit code 1' }),
  },
  {
    pattern: /Failed to build ios project/i,
    extract: () => ({ message: 'Failed to build iOS project' }),
  },
  {
    pattern: /Failed to build android project/i,
    extract: () => ({ message: 'Failed to build Android project' }),
  },
  {
    pattern: /PhaseScriptExecution.*failed/i,
    extract: (m) => ({ message: `Build phase script failed: ${m[0].trim().slice(0, 120)}` }),
  },
  {
    // "Undefined symbols for architecture" with symbol list
    pattern: /Undefined symbols? for architecture (\w+)/i,
    extract: (m) => ({ message: `Undefined symbols for architecture ${m[1]}` }),
  },
  {
    pattern: /(\d+)\s+undefined symbols?/i,
    extract: (m) => ({ message: `${m[1]} undefined symbols`, count: parseInt(m[1], 10) }),
  },
];

/** Check if a line is noise that should be filtered */
function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(line));
}

/** Extract structured errors from raw log lines */
export function extractErrors(lines: string[]): BuildError[] {
  const errors: BuildError[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isNoise(line)) continue;

    for (const { pattern, extract } of ERROR_PATTERNS) {
      const match = line.match(pattern);
      if (match && extract) {
        const parsed = extract(match, line);
        const key = `${parsed.message ?? ''}|${parsed.file ?? ''}`;

        if (seen.has(key)) {
          // Increment count of existing grouped error
          const existing = errors.find(e => `${e.message}|${e.file ?? ''}` === key);
          if (existing) existing.count = (existing.count ?? 1) + 1;
        } else {
          seen.add(key);
          errors.push({ message: parsed.message ?? line, ...parsed, count: parsed.count ?? 1 });
        }
        break;
      }
    }
  }

  return errors;
}

function openInEditor(file: string, line?: number) {
  const lineArg = line ? `:${line}` : '';
  // Attempt to open in VS Code via the code CLI
  if (window.rndev) {
    window.rndev.invoke('open:editor', `${file}${lineArg}`).catch(() => {});
  }
}

export function ErrorSummary({ errors }: ErrorSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div className="error-summary">
      <div className="error-summary-header">
        <span className="error-summary-icon">{'\u2716'}</span>
        <span className="error-summary-title">
          Build failed with {errors.length} error{errors.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="error-summary-list">
        {errors.map((err, i) => (
          <div key={i} className="error-summary-item">
            <div className="error-message">
              {err.message}
              {(err.count ?? 1) > 1 && (
                <span className="error-count">({err.count}x)</span>
              )}
            </div>
            {err.file && (
              <div
                className="error-file"
                onClick={() => openInEditor(err.file!, err.line)}
                title="Click to open in editor"
              >
                {err.file}{err.line ? `:${err.line}` : ''}
              </div>
            )}
            {err.suggestion && (
              <div className="error-suggestion">
                Fix: {err.suggestion}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
