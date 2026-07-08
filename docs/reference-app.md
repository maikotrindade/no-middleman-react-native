# The reference app — `examples/reference-app`

A small, deliberately **rigged** Expo app that serves two purposes: it is the CI
fixture the library is proved green against, and it is the proving ground where
the Detox oracle demonstrates it can drive an app red→green. Expo `~52`, React
Native `0.76.9`, TypeScript, Detox `^20`.

Two things are wrong *on purpose*. Don't casually "fix" either — `prove:oracle`,
the CI, and the overnight loop all depend on them staying as-is.

## Rig 1 — the planted bug (target of `/nm-fix`)

[src/screens/TipCalculatorScreen.tsx](../examples/reference-app/src/screens/TipCalculatorScreen.tsx)
computes the total with hand-rolled, wrong math instead of using the correct
`src/lib/tip.ts`:

```ts
// PLANTED BUG (§11): percentage applied as a multiplier without dividing by 100.
setTotal(billValue + billValue * percentValue);   // 100 + 100*10 = 1100
```

The correct library ([src/lib/tip.ts](../examples/reference-app/src/lib/tip.ts))
does `bill + roundToCents(bill * (tipPercent / 100))` → `110`.

**Why it can only be caught by E2E:** the unit tests
([src/lib/\_\_tests\_\_/tip.test.ts](../examples/reference-app/src/lib/__tests__/tip.test.ts))
cover the *library*, and the library is correct — so unit + typecheck + lint are
all green while the app is still visibly wrong. Only the Detox flow, which drives
the actual UI, is red. This is the whole argument for E2E being the headline gate.

The Detox acceptance flow
([e2e/tip-calculator.test.ts](../examples/reference-app/e2e/tip-calculator.test.ts))
asserts:

- `opens from the home screen` — taps `open-tip-calculator`, expects `bill-input`
  visible. (Unrelated navigation — stays **green**.)
- `shows the correct total for a 10% tip on $100` — types `100` + `10`, taps
  Calculate, expects `total-text` == `Total: 110.00`. **Red** against the planted
  bug (which shows `1100.00`).

The fix a `/nm-fix` loop should converge on is to route the screen through
`calculateTotal` from `src/lib/tip.ts`.

## Rig 2 — the missing feature (target of `/nm-feature`)

[specs/tip-presets.md](../examples/reference-app/specs/tip-presets.md) describes a
tip-preset-buttons feature that is **deliberately not implemented**. It is the
reference target for the spec→red→green loop. Acceptance criteria:

1. Three preset buttons `10%` / `15%` / `20%` with testIDs `preset-10`,
   `preset-15`, `preset-20`.
2. Tapping a preset fills `tip-input` with that percentage, replacing any prior
   value.
3. Calculation uses the preset: bill `80`, tap `preset-15`, Calculate → `Total:
   92.00`.
4. Manual entry still works: a custom percentage typed after a preset uses the
   typed value.

Out of scope (stated in the spec): persisting a preferred preset; any change to
the Home screen or to the existing tip math. A `/nm-feature` run would have the
spec-author draft a Detox flow encoding criteria 1–4 (red today), get human
approval, then have the maker implement the buttons until green.

## Detox configuration

[.detoxrc.js](../examples/reference-app/.detoxrc.js):

- Test runner: jest with `e2e/jest.config.js`, `setupTimeout: 180000`.
- App `android.debug`: debug APK + androidTest APK; build command
  `cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug`.
- Device `emulator`: `android.emulator`, `avdName: 'nm_test'`, `headless: true`.
- Configuration `android.emu.debug` = that device + that app. This matches
  `nm.config.json`'s `e2e.configuration` / `e2e.avdName`.

## `nm.config.json`

[examples/reference-app/nm.config.json](../examples/reference-app/nm.config.json):

```json
{
  "verifiers": ["typecheck", "lint", "unit"],
  "e2e": { "configuration": "android.emu.debug", "avdName": "nm_test" }
}
```

So `nm verify` runs typecheck + lint + unit (all green even with the planted bug);
`nm verify --e2e` adds the Detox oracle (red).

## `prove:oracle` — the end-to-end oracle proof

[scripts/prove-oracle.mjs](../scripts/prove-oracle.mjs), run via
`pnpm prove:oracle`. It proves the Detox oracle is *trustworthy* by driving the
reference app red→green with **scripted edits and no agents involved**:

1. Assert the planted bug is present.
2. **Run 1 (planted bug) → must be RED.** Additionally assert that the
   *tip-total* flow specifically is the red one and the unrelated *navigation*
   flow stays green — i.e. the oracle is precise, not just failing.
3. Apply the known-correct fix (import + use `calculateTotal`).
4. **Run 2 (fixed) → must be GREEN**, and the `e2e:dev-client-build` signal must
   be `cache-hit` — proving the fix was a **JS-only reload with no native
   rebuild** (build-once/reload-many).
5. `finally`: `git checkout` the screen to restore the planted bug.

Requires the Android SDK + an AVD. The AVD name defaults to `nm_test`, overridable
with `NM_AVD`. This script is the living proof behind the "red→green, build
cached, flake vote active" claim.

## What CI does with it

- **`ci.yml`** (every push/PR): `pnpm build` + `pnpm test` — proves the library
  green against this fixture *without* an emulator. The unit/integration tests in
  each package exercise the verifiers against this app's shape.
- **`overnight-loop.yml`** (cron): runs a live `/nm-fix` loop against the fixture,
  caching the Detox dev-client binary between runs and uploading the `.nm/`
  lineage as an artifact. See [workflows.md](workflows.md#triggers).

## The `.nm/` directory

At runtime the app accumulates a `.nm/` tree (git-ignored) that is the loop's
external state and evidence:

- `.nm/working-state.md` — the human-readable single-run state (layer 1).
- `.nm/lineage.jsonl` — the append-only journal (layer 2, source of truth).
- `.nm/detox-build/<hash>.json` — build cache markers keyed by the native-inputs hash.
- `.nm/evidence/` — captured logs and jest JSON per verifier run
  (`typecheck-iter0.log`, `detox-run-1.json`, `detox-build-<hash>.log`, …).
- `.nm/triage/<date>.md` — written by `/nm-triage`.
- `.nm/KILL` — the kill-switch sentinel (delete-on-done).
