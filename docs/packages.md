# Packages — per-package reference

pnpm + Turborepo workspace. `pnpm-workspace.yaml` globs `packages/*` and
`examples/*`. Turbo tasks (`turbo.json`): `build` (outputs `dist/**`, depends on
`^build`), `test` and `typecheck` (both depend on `^build`). Every library is ESM
(`type: module`), TypeScript `NodeNext`/`strict` from
[tsconfig.base.json](../tsconfig.base.json), built with `tsc`, tested with
**vitest**.

## Dependency graph

```
core  ─────────────┬──────────────┬───────────────┬──────────────┐
  ▲                │              │               │              │
  │            verifiers ──► verifier-detox ──► cli          adapter-supabase
  │                                              (also core)  (reads core journal)
  │
adapter-inngest (types only)      reporter-resend (standalone)
plugin (ships skills/agents/hooks; no TS build dependency)
```

`core` has no internal deps. `verifiers` depends on `core`. `verifier-detox`
depends on `core` + `verifiers` (it reuses `runCommand`). `cli` depends on all
three. The adapters and the reporter depend only on `core` (or nothing).

---

## `@no-middleman/core` {#core}

`LoopSpec` types, invariants, the XState runtime, and the lineage journal. The
deterministic heart. Depends on `xstate@^5`.

| Module | Exports | Role |
|---|---|---|
| [types.ts](../packages/core/src/types.ts) | `LoopSpec`, `Trigger`, `Intake`, `Verifier`, `VerifierResult`, `VerifierSignal`, `Evidence`, `LoopContext`, `MemoryRef`, `Topology`, `StoppingRule`, `AgentRef` | The taxonomy. See [loop-contract.md](loop-contract.md). |
| [invariants.ts](../packages/core/src/invariants.ts) | `ALL_INVARIANTS`, `Invariant`, `validateLoopSpec`, `assertValidLoopSpec`, `InvariantViolation`, `InvariantViolationError` | The eight enforced invariants. |
| [machine.ts](../packages/core/src/machine.ts) | `loopMachine`, `LoopEvent`, `LoopMachineContext`, `LoopOutcomeKind` | The XState v5 state machine. |
| [journal.ts](../packages/core/src/journal.ts) | `JournalRecord`, `appendRecord`, `readJournal` | Append-only JSONL lineage. |
| [runtime.ts](../packages/core/src/runtime.ts) | `LoopRunner`, `LoopHooks`, `LoopOutcome`, `LoopRunnerOptions`, `replayJournal`, `ReplayMismatchError`, `MakerStepResult`, `CheckerVerdict` | The driver + replay/resume. |
| [working-state.ts](../packages/core/src/working-state.ts) | `writeWorkingState` | Human-readable markdown mirror. |

Deep dive: [architecture.md](architecture.md).

## `@no-middleman/verifiers` {#verifiers}

Generic command/composite verifiers + the cheap-suite presets. Depends on `core`.

- [command.ts](../packages/verifiers/src/command.ts) — `commandVerifier`,
  `runCommand`, `CommandVerifierOptions`, `CommandOutcome`. Wraps a shell command
  as a `Verifier`; exit 0 = green; captures an evidence log; SIGKILLs on timeout.
- [composite.ts](../packages/verifiers/src/composite.ts) — `compositeVerifier`,
  `orderByCost`. Fail-fast cheap→expensive bundling.
- [presets.ts](../packages/verifiers/src/presets.ts) — `typecheckVerifier`,
  `lintVerifier` (advisory by default), `unitVerifier`, `buildVerifier`.

Deep dive: [verifiers.md](verifiers.md).

## `@no-middleman/verifier-detox` {#verifier-detox}

The Detox E2E oracle — the expensive tail of the composite. Depends on `core` +
`verifiers`.

- [index.ts](../packages/verifier-detox/src/index.ts) — `detoxVerifier`,
  `DetoxVerifierOptions`, and re-exports of the pieces below.
- [native-hash.ts](../packages/verifier-detox/src/native-hash.ts) —
  `nativeInputsHash`: SHA-256 of deps + app config + `android/`/`ios/` trees
  (minus build outputs); JS deliberately excluded.
- [build-cache.ts](../packages/verifier-detox/src/build-cache.ts) — `ensureBuild`,
  `readCacheMarker`: build-once/reload-many with a hash-keyed marker.
- [detox-run.ts](../packages/verifier-detox/src/detox-run.ts) — `runDetoxSuite`,
  `majorityVote`, `parseJestJson`: per-flow flake majority vote; broken-oracle
  guards.
- [emulator.ts](../packages/verifier-detox/src/emulator.ts) — `ensureEmulator`,
  `reversePort`, `shutdownEmulator`.
- [metro.ts](../packages/verifier-detox/src/metro.ts) — `startMetro`.

Deep dive: [verifiers.md](verifiers.md#the-detox-oracle-no-middlemanverifier-detox).

## `@no-middleman/cli` {#cli}

The `nm` binary. `bin`: `no-middleman` and `nm`, both → `dist/main.js`. Depends on
`core` + `verifiers` + `verifier-detox`.

- [main.ts](../packages/cli/src/main.ts) — the `#!/usr/bin/env node` entrypoint; a
  `switch` on the subcommand. Only `verify` is implemented; anything else prints
  usage.
- [verify.ts](../packages/cli/src/verify.ts) — `runVerify`, `loadConfig`,
  `NmConfig`. Assembles verifiers from `nm.config.json`, runs them fail-fast,
  prints per-signal lines, exits 0 iff every hard verifier is green. This is the
  validator surface `/goal` iterates against.

## `@no-middleman/plugin` {#plugin}

The Claude Code plugin: `/nm-*` skills, maker/checker/spec-author agents, and the
lineage + reporting hooks. No TypeScript build — it ships markdown + JSON.

- [.claude-plugin/plugin.json](../packages/plugin/.claude-plugin/plugin.json) — manifest.
- `skills/nm-fix`, `skills/nm-feature`, `skills/nm-triage` — the three loops.
- `agents/maker.md`, `agents/checker.md`, `agents/spec-author.md` — the agents.
- `hooks/hooks.json` — `PostToolUse` (iteration lineage) + `Stop` (reporting).

Deep dive: [workflows.md](workflows.md).

## `@no-middleman/reporter-resend` {#reporter-resend}

The HTTP-hook target that emails run digests via Resend. Standalone (no internal
deps).

- [reporter.ts](../packages/reporter-resend/src/reporter.ts) — `RunDigest`,
  `renderDigest`, `sendDigest`, `ReporterOptions`. Renders a digest to
  subject+HTML (everything optional — a partial digest beats none; HTML-escaped)
  and POSTs to `https://api.resend.com/emails`.
- [server.ts](../packages/reporter-resend/src/server.ts) — `startReporterServer`:
  an HTTP server that accepts `POST` of a `RunDigest` and forwards it via
  `sendDigest` (default port 8787).
- [main.ts](../packages/reporter-resend/src/main.ts) — `nm-reporter` entrypoint;
  requires `RESEND_API_KEY`, `NM_DIGEST_FROM`, `NM_DIGEST_TO` (comma-splits
  `TO`). The plugin's `Stop` hook POSTs here.

## `@no-middleman/adapter-supabase` {#adapter-supabase}

Opt-in lineage mirror. Deliberately **SDK-free** — talks to Supabase's PostgREST
endpoint with `fetch`, zero added deps. Depends on `core` (reads the journal).

- [index.ts](../packages/adapter-supabase/src/index.ts) —
  `createSupabaseLineageSink` (`append` / `readAll`), `mirrorJournal`,
  `SupabaseLineageOptions`. Expected table (default `nm_lineage`): `loop_id text,
  ts timestamptz, state text, record jsonb`. Wired as the `LoopRunner`'s
  fire-and-forget `lineageSink`, or used one-shot via `mirrorJournal` to backfill
  an existing JSONL journal.

## `@no-middleman/adapter-inngest` {#adapter-inngest}

Opt-in durable-execution wrapper for the loop hooks. Types-only dep on `core`.

- [index.ts](../packages/adapter-inngest/src/index.ts) — `durableHooks`,
  `DurableStep`. Wraps every `LoopHooks` callback in `step.run(id, fn)` with
  deterministic ids (`plan`, `build`, `maker-iteration-<n>`,
  `checker-iteration-<n>`, `report`), so any engine exposing a `step.run`
  primitive (Inngest, a Temporal shim, a test recorder) can checkpoint and resume
  the side-effectful steps. The XState journal stays the source of truth for
  state replay; this only makes side effects durable.

---

## `examples/reference-app` {#reference-app}

A rigged Expo app used as the CI fixture and the oracle's proving ground — a
planted bug, a deliberately missing feature, and Detox flows. Documented on its
own page: [reference-app.md](reference-app.md).
