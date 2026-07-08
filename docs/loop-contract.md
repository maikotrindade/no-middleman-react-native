# The loop contract — `LoopSpec` + invariants

Every loop is a single typed value: a **`LoopSpec`**. It declares the whole
taxonomy of the loop and its stopping rule, and it must satisfy eight invariants
or it *does not run*. Source of truth:
[packages/core/src/types.ts](../packages/core/src/types.ts) and
[packages/core/src/invariants.ts](../packages/core/src/invariants.ts).

## `LoopSpec` at a glance

```ts
interface LoopSpec {
  id: string;
  taxonomy: {
    trigger: Trigger;                 // axis 1 — how the loop starts
    intake: Intake;                   // axis 2 — the goal + editable scope
    verification: Verifier[];         // axis 3 — composite oracle, cheap→expensive
    stateModel: MemoryRef;            // axis 4 — where state lives
    topology: Topology;               // axis 5 — agent arrangement
    operatingDomain: 'react-native';
  };
  stopping: StoppingRule;             // success condition + hard budget
  agents: { maker: AgentRef; checker: AgentRef; specAuthor?: AgentRef };
  invariants: Invariant[];            // must list all eight; enforced at load time
}
```

### Axis 1 — Trigger

How a loop is kicked off:

```ts
type Trigger =
  | { kind: 'manual' }
  | { kind: 'scheduled'; cadence: string; runner: 'claude-loop' | 'github-actions' | 'cron-print' }
  | { kind: 'event'; hook: 'PostToolUse' | 'Stop' | 'SubagentStop' };
```

- `manual` — a developer runs `/nm-fix` / `/nm-feature`.
- `scheduled` — `/loop` cadence (session-scoped), a GitHub Actions cron, or a
  `claude -p` print run. The overnight workflow is `github-actions`.
- `event` — driven by a Claude Code hook firing.

### Axis 2 — Intake (the goal + scope)

```ts
interface Intake {
  goal: string;                                    // natural-language intent
  spec?: string;                                   // path to written acceptance criteria
  scope: { include: string[]; exclude: string[] }; // globs the maker MAY edit; enforced
}
```

`scope.include` is a positive grant: the maker may edit only files matching an
`include` glob and never an `exclude` glob. An empty `include` is an invariant
violation (`read-only-by-default`).

### Axis 3 — Verification (the oracle)

An ordered array of `Verifier`s, each with a `gate` and a `cost`:

```ts
interface Verifier {
  readonly id: string;
  readonly gate: 'hard' | 'advisory';                 // hard verifiers must pass to stop
  readonly cost: 'cheap' | 'moderate' | 'expensive';  // fail-fast ordering
  run(ctx: LoopContext): Promise<VerifierResult>;
}
```

The composite runs them cheap→expensive and fails fast on the first red *hard*
verifier. Full detail in [verifiers.md](verifiers.md).

### Axis 4 — State model (memory)

```ts
interface MemoryRef {
  workingState: string;             // path to human-readable markdown state
  lineage: string;                  // path to append-only JSONL journal
  adapter: 'file' | 'supabase';     // default 'file'
}
```

Two layers: a human-readable markdown *working state* (rewritten every
transition, for watching the loop live) and the append-only *lineage* JSONL (the
source of truth for audit + replay). See [architecture.md](architecture.md).

### Axis 5 — Topology

```ts
type Topology = 'single-maker' | 'maker-checker' | 'explore-implement-verify';
```

The default loops are `maker-checker`: one agent makes the change, a separate
adversarial agent reviews it.

### Stopping rule

```ts
interface StoppingRule {
  success: 'all-hard-verifiers-green';
  budget: { maxIterations: number; maxTokens: number; maxWallClockMs: number };
  onBudgetExceeded: 'open-draft-pr' | 'abort' | 'escalate';
}
```

Success is unambiguous: *all hard verifiers green*. The budget is a hard,
three-dimensional ceiling (iterations, tokens, wall-clock) — every dimension is
mandatory and must be a positive finite number.

### Agents

```ts
interface AgentRef {
  name: string;                 // maps to .claude/agents/<name>.md
  model: 'claude-opus-4-8';     // Opus, 1M context
  isolation: 'worktree' | 'none';
}
```

## The eight invariants

These are the loop-engineering **anti-patterns turned into enforced rules**. A
`LoopSpec` must declare every one in `spec.invariants`; the structurally
checkable ones are verified at load time by `validateLoopSpec`, and the rest are
declarations the runtime and the checker agent re-check mid-loop.

| Invariant | Meaning | Checked at load time by `validateLoopSpec`? |
|---|---|---|
| `require-verifiable-stop` | No `LoopSpec` without a hard verifier → refuse to run. | ✅ at least one `gate: 'hard'` verifier |
| `bounded-retries` | `maxIterations` + `maxTokens` + `maxWallClockMs` all mandatory. | ✅ each must be positive + finite |
| `maker-neq-checker` | Structurally distinct agents; no self-approval. | ✅ `maker.name !== checker.name` |
| `tests-only-strengthen` | Checker rejects any weakened/deleted/skipped test. | Declared; enforced by the checker agent |
| `external-state-only` | All state in markdown + JSONL; nothing context-only. | ✅ `workingState` + `lineage` paths required |
| `read-only-by-default` | Scope globs gate writes; escalate to write only within `include`. | ✅ `scope.include` non-empty |
| `human-approves-acceptance` | Acceptance flow approved before the loop runs. | Declared; enforced by the `/nm-feature` human gate |
| `pr-not-merge` | The loop opens a PR; it never merges. | Declared; enforced by the skills' terminal step |

### Enforcement flow

```ts
assertValidLoopSpec(spec);   // throws InvariantViolationError if any violation
```

`validateLoopSpec(spec)` returns a list of `InvariantViolation`s;
`assertValidLoopSpec` throws an `InvariantViolationError` aggregating them if the
list is non-empty. `LoopRunner.run()` and `.resume()` both call it before doing
any work — **a spec that fails validation never executes a single iteration.**

The load-time checks cover the mechanically verifiable invariants (a hard
verifier exists, the budget is well-formed, maker ≠ checker, state paths exist,
scope grants at least one glob). The three behavioural invariants
(`tests-only-strengthen`, `human-approves-acceptance`, `pr-not-merge`) can't be
proven from the spec shape alone, so they are enforced downstream — by the
checker agent's review and the skills' human-gate and PR-terminal steps — but
they must still be *declared*, so their absence from `spec.invariants` is itself
a load-time violation.
