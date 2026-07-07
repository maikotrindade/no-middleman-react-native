# No Middleman

**Loop Engineering for React Native. You write the acceptance test; Claude Code writes the feature until it passes — no human in the middle.**

Describe a feature. Approve the Detox flow that defines "done." Then step away. Claude Code builds it in your real RN app, looping on its own — edit, reload, run the suite, repeat — and only comes back to you with a pull request that a full E2E run already vouched for.

The middleman it removes is *you*, standing in the loop's interior babysitting each assess-act-verify cycle. What it keeps is you at the two ends: you own the test going in, you review the diff coming out. Autonomous interior, human bookends.

What makes "the agent says it's done" actually mean done:

- **The test is the contract, and you own it.** The agent never grades its own work — maker and adversarial checker are separate, and tests can only be strengthened, never weakened to reach green.
- **E2E is the headline gate, not the only one.** Typecheck, unit, build, and your full regression suite all stay green too. One weak flow can't wave the loop through.
- **Every run is reproducible.** Append-only execution lineage, a hard iteration/token budget, a kill switch, and a PR at the end — it opens, it never merges.

Built as a Claude Code plugin plus a thin TypeScript verifier, so it rides the native `/goal` loop instead of reinventing it.

> **Repo:** https://github.com/maikotrindade/no-middleman-react-native
> **Tagline:** *You write the test. Claude writes until it passes.*
> **Package scope:** `@no-middleman/*` · **CLI:** `no-middleman` (alias `nm`) · **Slash commands:** `/nm-*`

---

## Quick start

```sh
pnpm install
pnpm build      # all packages
pnpm test       # unit + integration suites (no emulator needed)

# Live oracle proof: drives the fixture app red -> green on a real emulator
# (needs the Android SDK and an AVD; see examples/reference-app/.detoxrc.js)
pnpm prove:oracle
```

## What ships

| Package | Role |
|---|---|
| `@no-middleman/core` | `LoopSpec` types, XState v5 runtime, JSONL lineage journal, invariants |
| `@no-middleman/verifiers` | typecheck/lint/unit/build command verifiers + fail-fast composite |
| `@no-middleman/verifier-detox` | Detox oracle: build-once/reload-many, flake majority-vote, emulator lifecycle |
| `@no-middleman/cli` | `nm verify [--e2e]` — the validator `/goal` iterates against |
| `@no-middleman/plugin` | Claude Code plugin: `/nm-fix`, `/nm-feature`, `/nm-triage` skills, maker/checker/spec-author agents, lineage + reporting hooks |
| `@no-middleman/reporter-resend` | HTTP-hook target that emails run digests via Resend |
| `@no-middleman/adapter-supabase` | opt-in lineage mirror (PostgREST, no SDK) |
| `@no-middleman/adapter-inngest` | opt-in durable-execution wrapper (`step.run`) for loop hooks |
| `examples/reference-app` | rigged Expo app: planted bug + missing feature + Detox flows (CI fixture) |

## The loop contract

Every loop is a typed `LoopSpec` — trigger, intake (goal + scope globs),
composite verification ordered cheap→expensive, external state (markdown
working state + append-only JSONL lineage), the durable context it loads each
run (`CLAUDE.md`/`SKILL.md`/docs), topology, and a stopping rule with a hard
budget (`maxIterations` + `maxTokens` + `maxWallClockMs`) plus an optional
escalation `reserve` — headroom the loop never spends on iteration so it can
always package a clean handoff (final digest + draft PR).

A spec that violates an invariant **does not run**:

`require-verifiable-stop` · `bounded-retries` · `maker-neq-checker` ·
`tests-only-strengthen` · `external-state-only` · `read-only-by-default` ·
`human-approves-acceptance` · `pr-not-merge`

## The developer workflow (bookends)

1. `/nm-feature "add biometric login" --spec ./specs/biometric.md` in your real RN app.
2. The `spec-author` agent drafts a Detox acceptance flow. **You approve it.** That red test is the contract.
3. The dev client compiles once (cached by a hash of native inputs); iterations reload JS only.
4. `/goal` drives the maker in a worktree against `nm verify --e2e`. Red → iterate with lineage recorded. Green → adversarial checker (separate Opus agent) hunts for weakened tests, self-serving mocks, masked timing, scope drift.
5. Checker accepts → **draft PR**. Budget exceeded → draft PR + escalate. The loop never merges.
6. The `Stop` hook emails you a digest: outcome, iterations, flake notes, PR link.

Between steps 3 and 5 there's no human. That's the point — and the name.

## Triggers

- **Manual:** `/nm-fix <bug>` · `/nm-feature <goal> --spec <path>` · `/nm-triage`
- **In-session cadence:** `/loop 2h /nm-fix` (session-scoped; supervised use)
- **Overnight:** `.github/workflows/overnight-loop.yml` — cron-triggered `claude -p` with the Detox binary cached between runs

## Kill switch

`touch .nm/KILL` — the loop halts between iterations, leaves a clean worktree
and a written working-state file.

## Sources

- Addy Osmani — *Loop Engineering*: https://addyo.substack.com/p/loop-engineering
- awesome-loop-engineering (taxonomy + anti-patterns): https://huggingface.co/datasets/cy0307/awesome-loop-engineering
- *Stop Hand-Holding Your Coding Agent*: https://arxiv.org/abs/2607.00038
- *From Agent Loops to Deterministic Graphs*: https://arxiv.org/abs/2605.06365
- Claude Code — skills / hooks / `/goal` / `/loop`: https://docs.claude.com/en/docs/claude-code/overview
