# Architecture — runtime, journal, replay

The runtime that drives a `LoopSpec` lives in `@no-middleman/core`. It is a small,
deterministic core: an **XState v5 state machine** ([machine.ts](../packages/core/src/machine.ts)),
an **append-only JSONL journal** ([journal.ts](../packages/core/src/journal.ts)),
a **driver** that ties them together ([runtime.ts](../packages/core/src/runtime.ts)),
and a **human-readable working-state writer** ([working-state.ts](../packages/core/src/working-state.ts)).

## The state machine

```
idle ──START──► planning ──PLANNED──► building ──BUILT──► iterating
                                                              │ ITERATED
                                                              ▼
                                                          verifying
                                                              │ VERIFIED
                                                              ▼
                                                        evaluating  (transient)
                                          ┌───────────────────┼───────────────────┐
                              allHardGreen│           budgetHit│          (default)│
                                          ▼                    ▼                   ▼
                                      reviewing          budgetExceeded        iterating
                          CHECKER_ACCEPTED│ │CHECKER_REJECTED
                                          ▼ └──────────────► iterating
                                      succeeded
                                          │
   (succeeded│budgetExceeded│failed) ─REPORT─► reporting ─REPORTED─► done (final)
```

Key states:

- **`iterating`** — the maker makes one edit (`ITERATED` carries `diffHash`,
  `tokensSpent`, `elapsedMs`). The kill switch is checked *before* this step, so
  a loop is never interrupted mid-edit.
- **`verifying`** — the composite verifier runs; `VERIFIED` carries the full
  `VerifierResult`.
- **`evaluating`** — a *transient* state: it resolves synchronously via `always`
  guards, so it never appears in the journal. It routes to `reviewing`
  (all hard green), `budgetExceeded` (budget hit), or back to `iterating`.
- **`reviewing`** — the checker runs. `CHECKER_ACCEPTED` → `succeeded`;
  `CHECKER_REJECTED` records the reasons and loops back to `iterating`.
- **Terminal outcomes** — `succeeded`, `budgetExceeded`, `failed` each set
  `context.outcome`, then flow through `reporting` to the final `done`.

### Determinism is the whole point

Two rules make the machine replayable:

1. **Every consumed event is recorded with its full payload** in the journal.
2. **Nothing inside the machine reads the clock or any ambient state.** Elapsed
   time and tokens arrive *in the events* (`elapsedMs`, `tokensSpent`), computed
   by the driver and frozen into the record. Guards (`allHardGreen`, `budgetHit`)
   are pure functions of accumulated context.

The budget guard is the stopping enforcement:

```ts
budgetHit: iteration >= maxIterations
        || tokensSpent >= maxTokens
        || wallClockMs >= maxWallClockMs
```

## The journal (lineage)

One `JournalRecord` per state transition, appended as a single JSON line:

```ts
interface JournalRecord {
  ts: string;            // ISO timestamp (audit only — NOT read on replay)
  loopId: string;
  iteration: number;
  state: string;         // machine state AFTER the event was processed
  event: LoopEvent;      // the full event payload — this is what replay re-sends
  tokensSpent: number;
  verifier?: VerifierResult;
  diffHash?: string;
  worktree?: string;
}
```

`appendRecord` creates the parent dir and appends `JSON.stringify(record) + '\n'`.
`readJournal` splits on newlines and parses each non-empty line. The file is the
**audit trail and the resume source** — never rewritten, only appended.

## Replay and resume

**Replay** re-sends every recorded event into a fresh machine and asserts the
resulting state sequence matches the journal exactly:

```ts
replayJournal(spec, records): actor
// for each record: actor.send(record.event); assert(state === record.state
//                  && context.tokensSpent === record.tokensSpent)
// mismatch → ReplayMismatchError(index, expected, actual)
```

Because the machine is clock-free, replay is exact — any divergence is a real
bug, surfaced immediately as a `ReplayMismatchError` naming the diverging record
index.

**Resume** (`LoopRunner.resume()`) is replay + continue:

1. `assertValidLoopSpec(spec)` (invariants still enforced on resume).
2. Read the journal, filter to this `loopId`. Empty → fall back to a fresh `run()`.
3. `replayJournal` to reconstruct the machine at its last state.
4. If already `done`, return the outcome; otherwise keep driving.

## The driver (`LoopRunner`)

`LoopRunner` owns the imperative outer loop that reads the machine's current
state and performs the corresponding side effect via a **hook**:

```ts
interface LoopHooks {
  plan?:  (ctx) => void | Promise<void>;
  build?: (ctx) => void | Promise<void>;
  makerStep: (ctx) => MakerStepResult | Promise<MakerStepResult>;   // { diffHash, tokensSpent }
  checker:   (ctx, result) => CheckerVerdict | Promise<CheckerVerdict>; // { accepted, reasons? }
  report?: (outcome) => void | Promise<void>;
}
```

The hooks are the seam between the deterministic machine and the messy outside
world. In tests they are fakes (so the machine closes over pure functions); in
production (`M4+`) they bind to the Claude Code maker/checker agents.

`drive()` is a `switch` on the current state that, for each state, runs the hook
inside `step()` and sends the resulting event. Every `send()`:

1. sends the event to the actor,
2. builds a `JournalRecord` from the *resulting* snapshot,
3. appends it to the JSONL journal,
4. optionally fire-and-forgets it to a `lineageSink` (e.g. the Supabase mirror —
   a failing sink never breaks the loop; the JSONL stays the source of truth),
5. rewrites the human-readable working-state markdown.

**Hook failures are loop failures, not crashes.** `step()` wraps every hook call
in try/catch and, on error, sends `FAILED` — which lands in the journal — instead
of throwing out of the driver.

### Composite verification inside the driver

`runVerifiers()` walks `spec.taxonomy.verification` in declared (cheap→expensive)
order, accumulating signals and evidence, and breaks on the first red **hard**
verifier — `aggregate.passed = false`. Advisory reds accumulate in the signals
but never flip `passed`. (The `@no-middleman/verifiers` `compositeVerifier`
implements the same fail-fast rule for standalone use; see [verifiers.md](verifiers.md).)

## The working-state file

`writeWorkingState` rewrites a markdown file on every transition so a developer
can watch the loop live via `git diff` or an editor tab:

```markdown
# Loop: <id>

**Goal:** <goal>

- State: <state>
- Iteration: <n> / <maxIterations>
- Tokens spent: <n> / <maxTokens>
- Wall clock: <ms> / <maxWallClockMs>ms
- Last verification: green | red | not run yet

## Failing checks        (only if any signal is red)
- <signal id>: <detail>

## Checker rejection reasons   (only if the checker rejected)
- <reason>

**Outcome:** <outcome>      (only once terminal)
```

This is layer 1 (human-readable, single-run, disposable). The lineage JSONL is
layer 2 (machine-readable, append-only, the actual source of truth). Only the
lineage is used for replay.

## The kill switch

`touch .nm/KILL` (path overridable via `LoopRunnerOptions.killSwitchPath`) halts
the loop **between iterations, never mid-edit**:

- `shouldKill()` returns true if `.nm/KILL` exists *or* a `SIGINT` was received
  (the driver installs a `SIGINT` handler that flips `killRequested`).
- It is checked at the top of `iterating` and `reviewing`. On kill, the driver
  sends `KILLED` (a loop *failure* with the reason recorded), which flows to the
  `failed` outcome and then normal `reporting`.
- When the machine reaches `done`, the driver removes the `.nm/KILL` file so the
  next run starts clean.

Because a kill is an ordinary event through the journal, a killed run leaves a
clean worktree, a complete lineage, and a written working-state file — and can be
resumed.

## Durable execution (optional)

`@no-middleman/adapter-inngest` wraps each hook in a `step.run(id, fn)` with
deterministic ids (`maker-iteration-<n>`, `checker-iteration-<n>`, `plan`,
`build`, `report`). This lets a durable engine (Inngest, or anything exposing a
`DurableStep` interface) checkpoint the side-effectful steps and resume them.
The XState journal remains the source of truth for *state* replay; the durable
wrapper only makes the *side effects* resumable. See [packages.md](packages.md#adapter-inngest).
