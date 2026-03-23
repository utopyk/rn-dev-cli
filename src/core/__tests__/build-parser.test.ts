import { describe, it, expect } from "vitest";
import { parseXcodebuildErrors, parseGradleErrors } from "../build-parser.js";

// ---------------------------------------------------------------------------
// parseXcodebuildErrors
// ---------------------------------------------------------------------------

describe("parseXcodebuildErrors", () => {
  it("returns empty array for clean build output", () => {
    const output = `
Build succeeded.
** BUILD SUCCEEDED **
`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toEqual([]);
  });

  it("extracts error: lines with file and line number", () => {
    const output = `/path/to/MyApp/ViewController.swift:42:8: error: use of undeclared identifier 'foo'`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe("xcodebuild");
    expect(errors[0].file).toBe("/path/to/MyApp/ViewController.swift");
    expect(errors[0].line).toBe(42);
    expect(errors[0].summary).toContain("use of undeclared identifier");
    expect(errors[0].rawOutput).toBe(output.trim());
  });

  it("extracts multiple error: lines", () => {
    const output = `
/app/src/Foo.swift:10:5: error: cannot find type 'Bar' in scope
/app/src/Baz.swift:20:3: error: missing return in function
`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe("/app/src/Foo.swift");
    expect(errors[0].line).toBe(10);
    expect(errors[1].file).toBe("/app/src/Baz.swift");
    expect(errors[1].line).toBe(20);
  });

  it("extracts fatal error: lines", () => {
    const output = `/app/src/Main.swift:1:1: fatal error: 'SomeModule/Header.h' file not found`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].summary).toContain("fatal error");
  });

  it("extracts linker errors (ld: lines)", () => {
    const output = `ld: framework not found MyFramework for architecture arm64`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe("xcodebuild");
    expect(errors[0].summary).toContain("framework not found");
    expect(errors[0].file).toBeUndefined();
  });

  it("extracts No such module errors", () => {
    const output = `/app/src/App.swift:3:8: error: no such module 'Alamofire'`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].summary).toContain("no such module");
    expect(errors[0].suggestion).toContain("pod install");
  });

  it("attaches suggestion for signing errors", () => {
    const output = `/app/src/App.swift:1:1: error: Signing requires a development team`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].suggestion).toContain("DEVELOPMENT_TEAM");
  });

  it("attaches suggestion for framework not found linker error", () => {
    const output = `ld: framework not found MyFramework for architecture arm64`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].suggestion).toContain("pod deintegrate");
  });

  it("attaches suggestion for sandbox rsync error", () => {
    const output = `error: Sandbox: rsync denied access to the following paths`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].suggestion).toContain("ENABLE_USER_SCRIPT_SANDBOXING");
  });

  it("extracts Reason: lines as reason field", () => {
    const output = `
/app/src/App.swift:1:1: error: something failed
Reason: The binary is not signed with a valid certificate
`;
    const errors = parseXcodebuildErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    // The reason should be captured somewhere
    const withReason = errors.find((e) => e.reason !== undefined);
    expect(withReason).toBeDefined();
    expect(withReason!.reason).toContain("not signed with a valid certificate");
  });

  it("sets source to xcodebuild for all returned errors", () => {
    const output = `
/app/src/Foo.swift:1:1: error: boom
ld: linker error happened
`;
    const errors = parseXcodebuildErrors(output);
    for (const error of errors) {
      expect(error.source).toBe("xcodebuild");
    }
  });
});

// ---------------------------------------------------------------------------
// parseGradleErrors
// ---------------------------------------------------------------------------

describe("parseGradleErrors", () => {
  it("returns empty array for successful gradle output", () => {
    const output = `
> Task :app:compileDebugJavaWithJavac
> Task :app:bundleDebugJsAndAssets
BUILD SUCCESSFUL in 42s
`;
    const errors = parseGradleErrors(output);
    expect(errors).toEqual([]);
  });

  it("extracts FAILURE block and What went wrong section", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileDebugJavaWithJavac'.
> Could not resolve com.android.support:appcompat-v7:28.0.0.

* Try:
Run with --info or --debug option for more details.
`;
    const errors = parseGradleErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe("gradle");
    expect(errors[0].summary).toContain("Execution failed");
  });

  it("extracts Caused by: chains and uses last one as root cause", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:bundleReleaseJsAndAssets'.
> Process 'command 'node'' finished with non-zero exit value 1
   Caused by: Could not find file 'index.js'
   Caused by: No such file or directory: /app/index.js

* Try:
Run with --stacktrace.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    const withReason = errors.find((e) => e.reason !== undefined);
    expect(withReason).toBeDefined();
    expect(withReason!.reason).toContain("No such file or directory");
  });

  it("extracts FAILED tasks", () => {
    const output = `
> Task :app:compileDebugKotlin FAILED
> Task :app:mergeDebugResources FAILED

FAILURE: Build failed with an exception.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    const taskErrors = errors.filter((e) => e.summary.includes("FAILED"));
    expect(taskErrors.length).toBeGreaterThan(0);
  });

  it("attaches suggestion for sdk location not found", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    const withSuggestion = errors.find((e) => e.suggestion !== undefined);
    expect(withSuggestion).toBeDefined();
    expect(withSuggestion!.suggestion).toContain("ANDROID_HOME");
  });

  it("attaches suggestion for could not resolve dependencies", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
Could not resolve dependencies for project ':app'.
> Could not resolve com.example:library:1.0.0.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    const withSuggestion = errors.find((e) => e.suggestion !== undefined);
    expect(withSuggestion).toBeDefined();
    expect(withSuggestion!.suggestion).toContain("gradle repositories");
  });

  it("attaches suggestion for java_home not set", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
JAVA_HOME is not set and no 'java' command could be found in your PATH.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    const withSuggestion = errors.find((e) => e.suggestion !== undefined);
    expect(withSuggestion).toBeDefined();
    expect(withSuggestion!.suggestion).toContain("preflight fix");
  });

  it("sets source to gradle for all returned errors", () => {
    const output = `
> Task :app:compileDebugKotlin FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileDebugKotlin'.
`;
    const errors = parseGradleErrors(output);
    for (const error of errors) {
      expect(error.source).toBe("gradle");
    }
  });

  it("rawOutput is populated for each error", () => {
    const output = `
FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileDebugKotlin'.
`;
    const errors = parseGradleErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(typeof error.rawOutput).toBe("string");
      expect(error.rawOutput.length).toBeGreaterThan(0);
    }
  });
});
