// Per-test setup file — runs after the test environment is created.
//
// jsdom (used by `@vitest-environment jsdom` in renderer tests) does not
// implement `Element.prototype.scrollIntoView`. Production renderer code
// calls it in normal effects (e.g. SearchableList active-row tracking),
// so without a stub those effects throw inside React's commit phase and
// crash otherwise-correct tests. Stubbing here keeps the production call
// unguarded — guarding `scrollIntoView` in source would be test-shaped
// noise leaking into runtime code.
//
// The check ensures we only define the stub when the global is missing,
// so node-env tests (no Element) and any future jsdom version that ships
// scrollIntoView remain untouched.
if (typeof globalThis.Element !== "undefined" && !globalThis.Element.prototype.scrollIntoView) {
  globalThis.Element.prototype.scrollIntoView = function (): void {
    // no-op stub for jsdom; tests don't need real scrolling.
  };
}
