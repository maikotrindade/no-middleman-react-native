# CLAUDE.md

Project context for Claude Code working in this repository. Read this first; the
deep documentation lives under [docs/](docs/).

## What this is

**No Middleman** is *Loop Engineering for React Native*: the developer writes an
acceptance test, Claude Code writes the feature until that test passes, and no
human sits inside the loop. The human owns the two ends — approve the test going
in, review the pull request coming out — and the interior (edit → reload → run
suite → repeat) is autonomous.

The product is **a Claude Code plugin plus a thin TypeScript verifier**. It rides
the native `/goal` loop rather than reinventing an agent loop. The TypeScript
side is a trustworthy oracle (`nm verify`); the plugin side is the orchestration
(skills, agents, hooks).

See [docs/overview.md](docs/overview.md) for the full mental model.

## Repository shape

pnpm + Turborepo monorepo. Node ≥ 20, `pnpm@9.15.9`, TypeScript ESM
(`NodeNext`, `strict`). All library packages are scoped `@no-middleman/*`; the
CLI binary is `no-middleman` (alias `nm`); the plugin's slash commands are
`/nm-*`.

```
packages/
  core/              LoopSpec types, invariants, XState runtime, JSONL journal
  verifiers/         command/composite verifiers + typecheck/lint/unit/build presets
  verifier-detox/    Detox oracle: build-once/reload-many, flake vote, emulator + Metro
  cli/               `nm verify [--e2e]` — the validator /goal iterates against
  plugin/            Claude Code plugin: /nm-* skills, maker/checker/spec-author agents, hooks
  reporter-resend/   HTTP-hook target that emails run digests via Resend
  adapter-supabase/  opt-in lineage mirror (PostgREST, no SDK)
  adapter-inngest/   opt-in durable-execution wrapper (step.run) for loop hooks
examples/reference-app/   rigged Expo app: planted bug + missing feature + Detox flows (CI fixture)
scripts/prove-oracle.mjs  live red→green proof of the Detox oracle
.github/workflows/        ci.yml (unit/integration) + overnight-loop.yml (live loop)
```

Per-package detail: [docs/packages.md](docs/packages.md).

## Commands

```sh
pnpm install
pnpm build        # turbo run build (respects ^build dependency order)
pnpm test         # turbo run test — unit + integration, no emulator needed
pnpm typecheck    # turbo run typecheck
pnpm prove:oracle # drives the fixture app red→green on a real emulator (needs Android SDK + AVD)
```

`prove:oracle` needs an AVD; the repo's default AVD name is `nm_test` (override
with `NM_AVD`). Package-level test runner is **vitest**; the reference app uses
**jest** + **Detox**.

## Non-negotiable invariants

Every `LoopSpec` must declare all eight anti-pattern invariants or it **refuses
to run** (enforced in [packages/core/src/invariants.ts](packages/core/src/invariants.ts)).
When you touch anything in the loop path, do not weaken these:

- `require-verifiable-stop` — at least one hard verifier, or no run.
- `bounded-retries` — `maxIterations` + `maxTokens` + `maxWallClockMs` all required, all positive.
- `maker-neq-checker` — maker and checker are structurally distinct agents; no self-approval.
- `tests-only-strengthen` — the checker rejects any weakened/deleted/skipped test.
- `external-state-only` — all state lives in the markdown working-state file + JSONL lineage; nothing context-only.
- `read-only-by-default` — scope globs gate writes; the maker escalates to write only within `include`.
- `human-approves-acceptance` — the acceptance flow is approved before the loop runs.
- `pr-not-merge` — the loop opens a draft PR; it never merges.

Full rationale: [docs/loop-contract.md](docs/loop-contract.md).

## How the loop actually runs

1. The `LoopSpec` (typed taxonomy: trigger, intake, verification, state model,
   topology, stopping rule) is validated against the invariants. Invalid → throw.
2. An **XState v5** machine drives the states
   `idle → planning → building → iterating → verifying → evaluating → reviewing → succeeded|budgetExceeded|failed → reporting → done`.
3. Every consumed event is appended to an **append-only JSONL journal**. Replay =
   re-send the recorded events into a fresh machine and assert the state sequence
   matches exactly. The machine reads no clock or ambient state — that is what
   makes runs reproducible.
4. Verification is a **composite** run cheap→expensive, failing fast on the first
   red *hard* verifier. Advisory reds are recorded but never gate.
5. Green → the **checker** (a separate Opus agent) hunts for gamed tests. Accept →
   draft PR. Budget exceeded → draft PR + escalate. The loop never merges.

Machine + replay detail: [docs/architecture.md](docs/architecture.md).
Verifier system + Detox oracle: [docs/verifiers.md](docs/verifiers.md).

## Working conventions in this repo

- **Match the existing dense-comment style.** Source files carry short comments
  that tie code to a numbered section of the design (e.g. `§6.1`). Keep them.
- **The verifier's exit code is the only source of truth for green** — never an
  agent's own judgment. `nm verify` exits 0 only when all hard verifiers pass.
- **State is external.** Anything the loop needs to survive a resume goes in the
  JSONL lineage (source of truth) or the markdown working state (human-readable
  mirror), never in agent context.
- **Fixtures are rigged on purpose.** `examples/reference-app` ships a *planted
  bug* (`billValue + billValue * percentValue`) and a *deliberately missing
  feature* (tip presets). Don't "fix" them casually — `prove:oracle` and the
  overnight workflow depend on them being red. See [docs/reference-app.md](docs/reference-app.md).
- **Commits:** Conventional Commits, short (≤15 words), authored by the repo
  owner — never Claude. Branches are descriptive kebab-case, never `claude/`.
- Only commit or push when explicitly asked.

## Where to read more

| Topic | File |
|---|---|
| Product model, bookends, the "middleman" | [docs/overview.md](docs/overview.md) |
| LoopSpec taxonomy + the eight invariants | [docs/loop-contract.md](docs/loop-contract.md) |
| XState machine, journal, replay, resume, kill switch | [docs/architecture.md](docs/architecture.md) |
| Composite verifiers + the Detox oracle internals | [docs/verifiers.md](docs/verifiers.md) |
| Plugin skills, agents, hooks, CI, triggers | [docs/workflows.md](docs/workflows.md) |
| Every package, its exports and role | [docs/packages.md](docs/packages.md) |
| The reference app fixture | [docs/reference-app.md](docs/reference-app.md) |
