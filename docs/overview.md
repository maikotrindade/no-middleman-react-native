# Overview — the product model

## The one sentence

> You write the acceptance test. Claude Code writes the feature until it passes.
> No human in the middle.

No Middleman is **Loop Engineering** applied to React Native. A developer
describes a feature or a bug, approves the Detox flow that defines "done", and
steps away. Claude Code then builds it inside the developer's real RN app,
looping on its own — edit, reload, run the suite, repeat — and comes back only
with a pull request that a full end-to-end run already vouched for.

## The middleman that gets removed

The "middleman" is **you, standing in the loop's interior**, babysitting each
assess–act–verify cycle. No Middleman removes exactly that — and keeps you at the
two ends:

- **Going in:** you own the acceptance test. That red Detox flow is the contract.
- **Coming out:** you review the diff on a draft PR.

Autonomous interior, human bookends. That is the whole design, and the name.

```
  human            ┌─────────── autonomous interior ───────────┐            human
 ───────►  approve │ plan → build → (edit → reload → verify)*   │ draft PR ►───────►
  writes    test   │              → checker review              │  opens    reviews
  the test         └────────────────────────────────────────────┘           the diff
```

## Why "done" actually means done

Four properties make an agent's "it's green" trustworthy:

1. **The test is the contract, and the human owns it.** The agent never grades
   its own work. The *maker* (who writes code) and the *checker* (an adversarial
   reviewer) are structurally separate agents — enforced by the
   `maker-neq-checker` invariant. And tests can only be *strengthened*, never
   weakened to reach green (`tests-only-strengthen`): the checker rejects any
   diff that deletes, skips, or loosens a test.

2. **E2E is the headline gate, not the only one.** Typecheck, unit, build, and
   the full regression suite must all stay green too. The verification is a
   *composite*, run cheap→expensive, and one weak flow cannot wave the loop
   through. See [verifiers.md](verifiers.md).

3. **Every run is reproducible.** Execution lineage is an append-only JSONL
   journal; replaying it reconstructs the exact state sequence because the state
   machine reads no clock or ambient state. There is a hard iteration/token/
   wall-clock budget and a kill switch. See [architecture.md](architecture.md).

4. **The loop opens a PR; it never merges.** `pr-not-merge` is an invariant. The
   terminal action is always a *draft* PR — the merge decision stays human.

## The developer workflow (the bookends in practice)

Taken from the reference workflow the plugin implements:

1. `/nm-feature "add biometric login" --spec ./specs/biometric.md` in your real
   RN app.
2. The **spec-author** agent drafts a Detox acceptance flow encoding every
   criterion. **You approve it.** That red test is now frozen — any later change
   to it by any agent is an automatic loop failure.
3. The dev client compiles **once** (cached by a hash of native inputs);
   subsequent iterations reload JS only. This is what makes the interior fast
   enough to be unattended.
4. `/goal` drives the **maker** in a worktree against `nm verify --e2e`. Red →
   iterate, with each attempt recorded in the lineage. Green → the adversarial
   **checker** (a separate Opus agent) hunts for weakened tests, self-serving
   mocks, masked timing, and scope drift.
5. Checker accepts → **draft PR**. Budget exceeded → draft PR + escalate. The
   loop never merges.
6. The `Stop` hook emails a digest: outcome, iterations, flake notes, PR link.

Between steps 3 and 5 there is no human. That is the point.

## Two loop shapes

- **`/nm-fix <bug>`** — fix-until-green. `nm verify` is the oracle; no new
  acceptance flow, the existing suite defines "done". See
  [workflows.md](workflows.md#nm-fix).
- **`/nm-feature <goal> --spec <path>`** — spec→red→green. The spec-author drafts
  a *new* acceptance flow, the human approves it, then the maker builds until the
  whole composite is green. See [workflows.md](workflows.md#nm-feature).
- **`/nm-triage`** — read-only discovery. Runs the verifier, catalogues red and
  flaky flows, optionally opens issues, and *never fixes anything*.

## Build philosophy

Rather than reinvent an agent loop, No Middleman rides Claude Code's native
`/goal` loop and supplies the two things a trustworthy loop needs that a raw
agent lacks:

- a **deterministic, replayable runtime** with enforced stopping rules
  (`@no-middleman/core`), and
- a **trustworthy composite oracle** whose exit code — not the agent's opinion —
  decides green (`@no-middleman/verifiers` + `@no-middleman/verifier-detox`,
  surfaced as `nm verify`).

The plugin (`@no-middleman/plugin`) wires those into Claude Code as skills,
agents, and hooks.

## Sources / prior art

- Addy Osmani — *Loop Engineering*: <https://addyo.substack.com/p/loop-engineering>
- awesome-loop-engineering (taxonomy + anti-patterns):
  <https://huggingface.co/datasets/cy0307/awesome-loop-engineering>
- *Stop Hand-Holding Your Coding Agent*: <https://arxiv.org/abs/2607.00038>
- *From Agent Loops to Deterministic Graphs*: <https://arxiv.org/abs/2605.06365>
- Claude Code — skills / hooks / `/goal` / `/loop`:
  <https://docs.claude.com/en/docs/claude-code/overview>
