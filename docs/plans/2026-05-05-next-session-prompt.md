---
title: Next-session prompt — verify post-fix kimoby flow + plan H3
type: handoff
status: active
date: 2026-05-05
predecessor: docs/plans/2026-05-04-next-session-real-e2e-before-h3.md
---

# Next-session prompt — verify post-fix kimoby flow + plan H3

H1 + H2 + the middle phase + the real-kimoby fixes are landed locally
on `claude/zen-nash-73c0a1` (66 commits ahead of `origin/main`, not
pushed). The 12-minute end-to-end build run against the user's actual
iPhone 15 already succeeded — Electron → daemon → react-native run-ios
→ xcodebuild → Kimoby.app installed → app launched → JS bundle served.
The probe assertion that previously reported "build event tally: 0"
was a DOM-detection bug; commit `41acb8c` fixed the probe.

This session's job is to **re-run the live verification cleanly**
against all the post-fix code, then plan H3.

Copy-paste the section below into a fresh Claude Code session.

---

## Self-contained prompt for next session

You are continuing the rn-dev-cli hook system + electron flip work.
The unified branch is `claude/zen-nash-73c0a1` (66 commits ahead of
`origin/main`, not pushed). Worktree:
`/Users/martincouso/Downloads/rn-dev-cli/.claude/worktrees/h1-handoff`.

The user is `martincouso@kimoby.com`. iPhone is connected and on the
same network. Profile lives at
`/Users/martincouso/Documents/GitHub/kimoby-mobile-app/.rn-dev/profiles/profile-1777926131792.json`
(dirty mode, port 8081, branch `feat/camera-mode-memory`, UDID
`00008130-001A653A3E11001C`). The user's existing kimoby dev CLI
flow works; ours should match it.

### Where to start

1. **Read these in order:**
   - `memory/real_kimoby_verification_complete.md` — full status of
     the 66 commits + what works + what's left.
   - `memory/h2_complete.md`, `memory/h1_complete.md` — H1+H2 ledger
     for context on the hook system.
   - `memory/middle_phase_complete.md` — the bug-fix phase.
   - `memory/feedback_review_weighting.md` — how the user weights
     review findings.
   - `memory/workflow_local_only_personal_account.md` — local-only
     account; do NOT push, do NOT run `kimoby-reviewer:*` skills.
   - `docs/plans/2026-05-05-build-bundle-hook-design.md` — the
     `build/discover-bundles` hook design that the next phase
     implements.
   - The H1+H2+middle commits: `git log --oneline origin/main..HEAD`.

2. **Use the existing worktree** at `.claude/worktrees/h1-handoff`.
   Clean at session end. `bun install` is current.

### Step 1 — Re-run probe-real-build.spec.ts cleanly

The fixes landed in this order over the last session:

  - `e32c6fd` connectToDaemon spawn budget 5s → 30s
  - `526fef2` resolve bun's absolute path so Electron can spawn daemon
  - `355a409` versioned bun (not nodenv shim) for any-cwd spawn
  - `98441f9` `--mode` (not `--configuration`) for run-ios
  - `1c9608d` versioned-bun for vitest setup
  - `52cba9b` codesign-prompt polling
  - `41acb8c` probe DOM read across every panel-content

The 12-min successful run was BEFORE all these were stable. Re-run:

```bash
# Clean slate
pkill -9 -f "src/index.tsx daemon /Users/martincouso/Documents/GitHub/kimoby" 2>&1; sleep 1
rm -f /Users/martincouso/Documents/GitHub/kimoby-mobile-app/.rn-dev/sock \
      /Users/martincouso/Documents/GitHub/kimoby-mobile-app/.rn-dev/pid

# Verify iPhone connected
xcrun xctrace list devices 2>&1 | grep -i "iPhone 15"
# Should NOT show under "Devices Offline" — if it does, plug the
# phone in / unlock it / trust this Mac.

# Run the probe
PROBE=1 npx playwright test \
  --config tests/electron-real-e2e/playwright.config.ts \
  tests/electron-real-e2e/probe-real-build.spec.ts
```

Expected: end-to-end build succeeds, Kimoby.app installs on the
iPhone, JS bundle requested from Metro on :8099. Probe should pass
its assertions now (DOM read across all panels + broader regex).

If it fails:
  - Read `~/.rn-dev/logs/daemon-kimoby-mobile-app-*.log` for the
    daemon-side trace.
  - Read `/tmp/rn-dev-logs/build-ios.log` for the build subprocess
    output.
  - Read `/tmp/probe-real-build-screens/*.png` for the visual state.

### Step 2 — Implement `build/discover-bundles` hook

`docs/plans/2026-05-05-build-bundle-hook-design.md` is the ready-to-
implement contract. Order of work:

1. **Hook contract type** under `src/core/hooks/contracts/`. Mirror
   the existing `build/pre` contract. Input + output types match the
   plan doc verbatim.
2. **Default implementation** for `ios`: parse
   `<projectRoot>/ios/*.xcodeproj/xcshareddata/xcschemes/*.xcscheme`,
   return one `BundleDescriptor` per shared scheme with its
   `<BuildConfiguration>` entries as `configurations`. For
   `android`: parse `<projectRoot>/android/app/build.gradle{,.kts}`
   `buildTypes` + `productFlavors` permutations.
3. **Wizard step** under `renderer/views/Wizard.tsx`: call the
   hook, render dropdowns for scheme + configuration, persist to
   `profile.scheme` + `profile.configuration`.
4. **`signingStyle` gate** in `electron/ipc/services.ts::settleCodeSigning`:
   if the discovered bundle's `signingStyle === "manual"`, skip the
   prompt entirely (the project HAS Manual signing intentionally).
5. **Probe** drives the wizard end-to-end, verifies kimoby's two
   schemes (Kimoby + Kimoby-beta) appear in the picker, and that
   selecting Kimoby + Manual signing does NOT surface the rewrite
   prompt.

### Step 3 — Plan H3

Only after Steps 1-2 are green. Use the same a–k sub-phase pattern
H1+H2 used. H3 is `docs/plans/2026-04-30-feat-hook-system-plan.md`
§H3 — Clean / Metro / DevTools / Preflight built-in module wraps.

### Things that landed but want one more verification pass

- **2nd-tab clean-mode** — probe confirms no "did not reach running"
  error after the watchdog fix. But never confirmed that the 2nd
  attached daemon-session reaches `running`. Drive that further.
- **Bug E (close-tab UX)** — user reported it "still doesn't work"
  even after the wording + visual fix. Unit + Playwright tests pass.
  Worth a screenshot review with the user.
- **`registry.test.ts > findActiveDaemons …`** flaked once
  (1295/1296). Likely a same-host registry race; pin or relax.

### What NOT to do this session

- Do NOT push. Do NOT open PRs.
- Do NOT run `kimoby-reviewer:*` skills.
- Do NOT auto-flip code signing or modify project.pbxproj. The
  prompt is now Skip-by-default; keep that contract.
- Do NOT re-introduce `--configuration` for run-ios — it crashes
  with `unknown option`. The CLI flag is `--mode` (`98441f9`).
- Do NOT use `bun` from `~/.nodenv/shims/`; the daemon spawn needs
  the versioned binary (`355a409`).

### Watch out for (lessons to carry forward)

- **The whole flow works against the user's real iPhone.** The
  probe assertions can be wrong even when the product is fine. Read
  the renderer DOM across every panel + watch for `Successfully
  launched` in any visible surface. Visual confirmation (screenshot)
  is the ground truth.
- **`react-native run-ios` calls it `--mode`, not `--configuration`.**
  The CLI rejects `--configuration` with `unknown option` before
  xcodebuild ever runs. This bit a release-variant build for
  months; covered by `--mode` in the BuildOptions → CLI mapping
  but the BuildOptions field is still semantically named
  `configuration` (Xcode's term).
- **`bun` is a versioned binary, not a shim.** `~/.nodenv/shims/bun`
  re-resolves `.node-version` against the spawned cwd, which fails
  when Electron spawns the daemon from a project root that doesn't
  have rn-dev-cli's `.node-version` file. Resolve the absolute path
  to the versioned bun once, on Electron boot.
- **Codesign prompt defaults are dangerous.** Pre-fix the prompt
  offered "Switch to Automatic" as the FIRST option, with a
  muscle-memory click rewriting `project.pbxproj`. The user-reported
  damage was real. The prompt now says Skip-recommended and
  "Rewrite project.pbxproj" on the dangerous option. Don't reverse
  this without a hook-driven `signingStyle` per bundle.
- **Profile timeout strategy is progress-based, not wall-clock.**
  Slow machines + heavy builds NEVER hit a wall-clock kill. Only
  true daemon silence does. Don't reintroduce the mode-based
  timeout — it was wrong on its own terms.

Today is 2026-05-05.

---

## Notes for the resumer

- **Branch state:** `claude/zen-nash-73c0a1` is 66 commits ahead of
  `origin/main`. Not pushed. Local-only.
- **Sibling branches:** all deleted. The unified branch is the one
  source of truth.
- **The user's iPhone is connected** and on the same network as the
  Mac. The profile points at it (UDID
  `00008130-001A653A3E11001C`).
- **Test-fixture daemons leak protection** is in place across all
  three Playwright suites — pgrep should always return 0 between
  runs.
