# Verifiers — the composite oracle

Green is decided by the **verifier's exit code, never an agent's judgment**. This
is what makes "the agent says it's done" trustworthy. Two packages implement it:
`@no-middleman/verifiers` (the generic composite + command presets) and
`@no-middleman/verifier-detox` (the expensive E2E oracle). The CLI
(`@no-middleman/cli`) assembles them from `nm.config.json` and exposes
`nm verify`.

## The `Verifier` contract

```ts
interface Verifier {
  readonly id: string;
  readonly gate: 'hard' | 'advisory';                 // hard must pass to stop
  readonly cost: 'cheap' | 'moderate' | 'expensive';  // fail-fast ordering
  run(ctx: LoopContext): Promise<VerifierResult>;
}

interface VerifierResult {
  passed: boolean;
  signals: VerifierSignal[];         // per-check breakdown, e.g. { id: 'e2e:login', passed, detail? }
  evidence: { logs: string[]; artifacts: string[] };  // paths to captured output
}
```

- **`gate`** — a *hard* red stops the loop; an *advisory* red is recorded in the
  signals but never gates. Lint is advisory by default.
- **`cost`** — used to order the composite cheap→expensive so cheap checks
  fail fast before an expensive emulator ever boots.

## `commandVerifier` — wrap any shell command

[command.ts](../packages/verifiers/src/command.ts). Exit code 0 = green. The full
stdout+stderr is written to an evidence log
(`.nm/evidence/<id>-iter<n>.log`); on failure the last ~20 lines become the
signal's `detail`. It spawns with a timeout (default 10 min), captures both
streams, and on timeout `SIGKILL`s the child and reports `code: null`.

```ts
commandVerifier({ id, command, args?, gate?, cost?, cwd?, timeoutMs? }): Verifier
```

`runCommand(command, args, cwd, timeoutMs)` is also exported directly — the Detox
package reuses it to shell out to Gradle/Detox.

## The presets

[presets.ts](../packages/verifiers/src/presets.ts) — the cheap suite most loops
start from:

| Preset | Command | gate | cost |
|---|---|---|---|
| `typecheckVerifier()` | `npx tsc --noEmit` | hard | cheap |
| `lintVerifier()` | `npx eslint .` | **advisory** | cheap |
| `unitVerifier()` | `npx jest --ci` | hard | cheap |
| `buildVerifier({ command })` | *(app-specific, no default)* | hard | expensive |

All accept overrides (`{ gate: 'hard' }` to make lint gate, a different `command`,
etc.). `buildVerifier` has no default command because "build" is app-specific —
the Detox package wires the cached dev-client build through this slot.

## `compositeVerifier` — fail-fast bundling

[composite.ts](../packages/verifiers/src/composite.ts). Bundles children into one
verifier that runs them cheap→expensive (`orderByCost`, a stable sort by
`{cheap:0, moderate:1, expensive:2}`) and **stops at the first red hard child**.
Advisory reds accumulate in the signals but never flip `passed`. The composite's
own `cost` is the cost of its most expensive child.

The `LoopRunner.runVerifiers()` in core implements the identical fail-fast rule
directly over `spec.taxonomy.verification`; `compositeVerifier` is the standalone
equivalent for building one nested verifier.

## The Detox oracle (`@no-middleman/verifier-detox`)

The expensive tail of the composite. `detoxVerifier(options)`
([index.ts](../packages/verifier-detox/src/index.ts)) is a hard, expensive
verifier that, on each `run`:

1. **Boots the emulator** (`ensureEmulator`, unless `manageEmulator: false`).
2. **Starts Metro** to serve JS (`startMetro`, unless `manageMetro: false`).
3. **Ensures the cached dev-client build** (`ensureBuild`) — build-once/
   reload-many.
4. **Reverses the Metro port** to the device (`adb reverse`).
5. **Runs the Detox suite** with the flake majority vote (`runDetoxSuite`).
6. Reports **one signal per flow**, plus an `e2e:dev-client-build` signal saying
   `cache-hit` or `rebuilt (hash …)`.
7. In `finally`: stops Metro and shuts the emulator down.

```ts
detoxVerifier({
  appDir?, configuration, avdName,   // e.g. 'android.emu.debug', 'nm_test'
  bootTimeoutMs?, binaryPaths?, buildCommand?, buildArgs?,
  maxRuns?, metroPort?, manageEmulator?, manageMetro?, id?
})
```

### Build-once / reload-many

The single most important performance property: the native dev client is
compiled **once**, then every loop iteration reloads only JS. What forces a
rebuild is a change to **native inputs**, captured by a content hash.

`nativeInputsHash(appDir)` ([native-hash.ts](../packages/verifier-detox/src/native-hash.ts))
hashes:

- `dependencies` + `devDependencies` from `package.json`,
- the Expo app config (`app.json` / `app.config.js` / `app.config.ts`),
- the entire `android/` and `ios/` trees — **excluding** output dirs
  (`build`, `.gradle`, `.cxx`, `node_modules`, `Pods`, `DerivedData`).

**JS source is deliberately not hashed** — that is the whole point. Files are
walked in sorted order and each contributes its repo-relative path + its bytes to
a SHA-256, so the hash is stable and path-order-independent.

`ensureBuild(options)` ([build-cache.ts](../packages/verifier-detox/src/build-cache.ts)):

- Computes the hash → marker path `.nm/detox-build/<hash>.json`.
- **Cache hit** = the marker exists *and* every expected binary exists → returns
  `{ rebuilt: false }` without building.
- Otherwise runs the build command, writes an evidence log, and — importantly —
  treats a **successful build with missing binaries** as an error (the build
  lied). Only on real success does it write the cache marker (`{ hash,
  binaryPaths, builtAt }`).

The default binaries are the debug APK + the androidTest APK. The overnight CI
workflow caches `android/app/build/outputs/apk` + `.nm/detox-build` keyed by the
same native inputs, so build-once/reload-many holds *across CI runs* too.

### Flake handling — majority vote

[detox-run.ts](../packages/verifier-detox/src/detox-run.ts). Detox flows can be
flaky; a single red must not fail an otherwise-good run, and a single green must
not hide a real failure. So each flow gets a **majority vote** across up to
`maxRuns` runs (default 3):

1. **Run 1** covers the whole suite. Its `jest --json` output is parsed
   (`parseJestJson`) into per-flow pass/fail by `assertionResults`.
2. For runs 2..`maxRuns`, only the **files containing an undecided flow** (any
   flow that has voted `false` at least once) are re-run. If nothing is
   undecided, it stops early.
3. Each flow's fate is the majority of its votes: `passed = passes * 2 >
   votes.length`; `flaky = 0 < passes < votes.length`.

The suite passes iff **every** flow's majority is green. Flaky-but-passing flows
are reported with a `FLAKY: passed k/n runs` detail so they surface in the digest
even when they don't fail the run.

### Broken oracle ≠ red oracle

A crucial distinction, enforced in two places:

- If a run produces **no jest JSON file at all** → throw: "the oracle is broken,
  not red".
- If the first run yields **zero flows** (a setup crash, a bad config) → throw:
  "detox ran zero flows — oracle is broken, not green".

A broken oracle must never be reported as a green (or even an honest red) — it
outranks anything it might have found. `/nm-triage` follows the same rule at the
skill level: an `nm verify` crash is reported as the single finding.

### Emulator + Metro lifecycle

`ensureEmulator` / `reversePort` / `shutdownEmulator`
([emulator.ts](../packages/verifier-detox/src/emulator.ts)) and `startMetro`
([metro.ts](../packages/verifier-detox/src/metro.ts)) manage the device and the
JS server. Both are opt-out (`manageEmulator: false` / `manageMetro: false`) for
environments that already have them running. The `detoxVerifier` always tears
them down in a `finally`, so a thrown build/suite error still cleans up.

## `nm verify` — the CLI surface for `/goal`

[verify.ts](../packages/cli/src/verify.ts). This is the validator the `/goal`
loop iterates against.

```sh
nm verify [--e2e] [--cwd <dir>]
```

- Loads `nm.config.json` from the cwd (`loadConfig`):

  ```jsonc
  {
    "verifiers": ["typecheck", "lint", "unit"],  // default if omitted
    "lintGate": "hard",                          // optional; lint is advisory otherwise
    "e2e": { "configuration": "android.emu.debug", "avdName": "nm_test",
             "maxRuns": 3, "bootTimeoutMs": 120000 }
  }
  ```

- Builds the verifier list from the named presets, appends the Detox verifier
  when `--e2e` is passed (erroring if there is no `e2e` section), and orders them
  cheap→expensive.
- Runs them fail-fast, printing one line per signal — `✓` green, `✗` red hard,
  `⚠` red advisory — and on the first red *hard* verifier prints
  `RED: … stopping (fail-fast).` and stops.
- **Exit code 0 iff every hard verifier is green** (prints `GREEN: all hard
  verifiers passed.`). That exit code is the only thing that decides "green".

The maker runs `nm verify` (adding `--e2e` once the cheap suite is green); the
checker never overrides it. Green is the exit code, full stop.
