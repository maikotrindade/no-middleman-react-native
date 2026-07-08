# Workflows — the Claude Code plugin

`@no-middleman/plugin` is the Claude Code plugin that turns the runtime and the
oracle into an operable product. It ships:

- three **skills** (slash commands): `/nm-fix`, `/nm-feature`, `/nm-triage`,
- three **agents**: `maker`, `checker`, `spec-author`,
- two **hooks**: iteration lineage (`PostToolUse`) and the reporting `Stop` hook.

Plugin manifest: [.claude-plugin/plugin.json](../packages/plugin/.claude-plugin/plugin.json).

## Skills

### `/nm-fix` — fix-until-green {#nm-fix}

[skills/nm-fix/SKILL.md](../packages/plugin/skills/nm-fix/SKILL.md). Iterate on a
bug with `nm verify` as the oracle, then adversarial review, then a draft PR.

- **§0 Guardrails (refuse to start unless all hold):** `nm.config.json` exists; a
  budget is stated (default `maxIterations: 10`, announced); a scope is stated
  (default `src/**`, excluding `e2e/**` and `**/__tests__/**`, announced);
  `nm verify` runs (red is fine — that's the point; a *crash* is not). Kill
  switch checked before every iteration. Terminal action is a draft PR, never a
  merge.
- **§1 Baseline:** create/refresh `.nm/working-state.md` (goal, scope, budget,
  iteration 0, initial `nm verify` output); capture the red baseline. If already
  fully green including `--e2e`, report "nothing to fix" and stop.
- **§2 Iterate (maker):** drive with `/goal` (goal = bug description, validator =
  `nm verify`, adding `--e2e` once the cheap suite is green). Each iteration:
  read the working state (never repeat a logged hypothesis), delegate the edit to
  the **maker** in a worktree with the scope globs, run `nm verify`, append a
  lineage line, update the working state. Budget exhausted while red → §4 with a
  PR labelled `budget-exceeded`.
- **§3 Review (checker):** spawn the **checker** (never the maker) with the full
  diff + goal. `REJECT` → write reasons to the working state, back to §2.
  `ACCEPT` → §4.
- **§4 Terminal:** commit on `fix/<slug>` (Conventional Commits, author = repo
  owner, never Claude); `gh pr create --draft` with a body containing goal,
  iterations, budget notes, final `nm verify` output, checker verdict, and any
  flake warnings; report the PR link. Merging is the human's job.

### `/nm-feature` — spec → red → green {#nm-feature}

[skills/nm-feature/SKILL.md](../packages/plugin/skills/nm-feature/SKILL.md). The
flagship loop. Inherits all of `nm-fix §0`, and adds the human-approval gate.

- **§0:** a written spec is required (`--spec <path>` or a detailed goal); if the
  acceptance criteria are ambiguous, ask **now**, not mid-loop.
  `human-approves-acceptance` is a hard invariant — no implementation work of any
  kind before approval.
- **§1 Draft the contract (spec-author):** spawn the **spec-author** with read
  access to the app; it adds exactly one Detox flow under `e2e/` encoding every
  criterion, plus the list of new testIDs the feature must expose. It never
  touches app code.
- **§2 Human gate — the one blocking step:** present the flow source, a
  criterion-by-criterion summary, and why it's red today; ask for explicit
  approval (AskUserQuestion). Approved → the flow is **frozen** (any later change
  by any agent = automatic loop failure). Amendments go back through
  spec-author. Never self-approve; on silence, stop.
- **§3 Red baseline:** cheap `nm verify` must be green (start from a healthy app);
  `nm verify --e2e` must be red **only** on the new flow. If the new flow already
  passes → the spec is already implemented or the flow is weak → stop and tell the
  human. Pre-existing red flows → stop; fix loops come first.
- **§4 Iterate (maker):** as `nm-fix §2`, with scope always excluding `e2e/**` and
  `**/__tests__/**` *except* that the maker may **add** new unit tests. The maker
  implements the testIDs and behaviour the approved flow demands.
- **§5 Review (checker):** beyond the standard checks, the checker confirms the
  approved acceptance flow is byte-identical to what the human approved (`git
  diff` on that file empty apart from its original addition).
- **§6 Terminal:** as `nm-fix §4`, with the PR body additionally linking the spec
  file and including the approved flow's criterion summary. The loop never merges.

### `/nm-triage` — read-only discovery {#nm-triage}

[skills/nm-triage/SKILL.md](../packages/plugin/skills/nm-triage/SKILL.md). A
tag-along loop embodying `read-only-by-default`: it observes and reports and is
structurally forbidden from editing code or tests. Single pass, no iteration:

1. **Verify** — `nm verify` (and `nm verify --e2e` if there's an `e2e` section
   and an AVD).
2. **Catalogue** — from the signals and `.nm/evidence/` logs, collect red hard
   verifiers (with failing detail), advisory reds, and any `FLAKY` signal
   (chronic-flake candidates).
3. **Report** — write `.nm/triage/<YYYY-MM-DD>.md`: one section per finding with
   the signal id, first relevant error lines, evidence log path, and a suggested
   `/nm-fix "<goal>"` one-liner the human can paste.
4. **Optionally file issues** — only if asked (or config `"triage": {
   "openIssues": true }`): `gh issue create` one issue per *new* red, searching
   existing open issues by signal id first; never duplicate, never close.
5. **Stop** — report the triage file path and a one-paragraph summary.

Hard limits: no edits outside `.nm/triage/`; no commits/branches/PRs; no re-runs
to "confirm" a red (the verifier's flake vote owns that); a crashing `nm verify`
is reported as the single finding — a broken oracle outranks everything.

## Agents

All three are Opus (`claude-opus-4-8`) and structurally distinct (the
`maker-neq-checker` invariant). Definitions under
[packages/plugin/agents/](../packages/plugin/agents/).

### `maker` {#maker}

[agents/maker.md](../packages/plugin/agents/maker.md). Implements the fix/feature
in an isolated worktree; its one job is to make the composite verifier green with
the smallest correct change. Hard rules (any violation ends the loop as failed):

1. **Scope** — edit only files matching `include`; never `exclude`.
2. **Never touch tests to get green** — no editing/deleting/weakening/skipping
   anything under `e2e/` or `__tests__/`; no mocks for the unit under test, no
   sleeps, no retries to mask failures. The checker reads the full diff.
3. **External state only** — read `.nm/working-state.md` at the start (never
   repeat a logged hypothesis); append the attempt + verifier outcome at the end.
4. **Verify with `nm verify`** (`--e2e` once the cheap suite is green) — only the
   exit code decides green.
5. **Stop conditions** — `.nm/KILL` → stop immediately, worktree clean; respect
   the iteration budget.

### `checker` {#checker}

[agents/checker.md](../packages/plugin/agents/checker.md). Adversarial reviewer,
tools `Read, Grep, Glob, Bash` — never writes code, never merges. Runs *after*
all verifiers are green and tries to prove the green is a lie. Answers explicitly:

1. **tests-only-strengthen** — any test weakened/deleted/skipped/loosened? Any
   non-additive change to `e2e/` or `__tests__/` = automatic REJECT.
2. **No self-serving mocks** — is the unit under test mocked/stubbed/bypassed?
3. **No masked timing** — sleeps/artificial waits/retry loops that could hide a
   failure?
4. **Spec fidelity** — does the diff implement the stated goal without scope
   drift beyond `include`?

Verdict is exactly one of `ACCEPT: <justification>` or `REJECT: <numbered
reasons, each tied to file+line>`. When in doubt, REJECT — a false green is worse
than an extra iteration.

### `spec-author` {#spec-author}

[agents/spec-author.md](../packages/plugin/agents/spec-author.md). Test author
only, tools `Read, Grep, Glob, Write` — never implements, never edits app code or
existing tests. Turns a written spec into the loop's contract:

1. **Only adds tests** — exactly one new file under `e2e/`.
2. **Encodes every acceptance criterion** as a concrete assertion; if a criterion
   can't be asserted through the UI, says so.
3. **The flow must be red today** because the feature is missing (not typos/wrong
   testIDs/timing); follows existing testID conventions and lists any new testIDs
   as requirements for the maker.
4. **No sleeps, retries, or conditional assertions** — Detox synchronizes.

Delivers: the new file path, a one-line-per-criterion summary, the new testIDs
the maker must implement, and why the flow is red. A human approves or amends
before any implementation.

## Hooks

[hooks/hooks.json](../packages/plugin/hooks/hooks.json).

- **`PostToolUse`** (matcher `Edit|Write|MultiEdit`) → `hooks/on-iteration.sh`:
  records iteration lineage as the maker edits.
- **`Stop`** → `hooks/on-stop.sh`: scrapes whatever it can from `.nm/` working
  state and POSTs a `RunDigest` to `$NM_REPORTER_URL`. Unset `NM_REPORTER_URL`
  and it is a silent no-op. See the reporter in [packages.md](packages.md#reporter-resend).

## Triggers

- **Manual:** `/nm-fix <bug>` · `/nm-feature <goal> --spec <path>` · `/nm-triage`
  in a repo with `nm.config.json`.
- **In-session cadence:** `/loop 2h /nm-fix` — session-scoped (expires after
  three days); supervised use only.
- **Real overnight runs:** [.github/workflows/overnight-loop.yml](../.github/workflows/overnight-loop.yml)
  — a cron (`0 3 * * *`) / `workflow_dispatch` job that runs
  `npx @anthropic-ai/claude-code -p "/nm-fix <goal>" --permission-mode acceptEdits
  --max-turns 200`. It caches the Detox dev-client binary between runs (keyed by
  the native inputs), always uploads the `.nm/` lineage as an artifact (red or
  green), and the 120-minute job timeout is the outer wall-clock kill switch.
  Requires the `ANTHROPIC_API_KEY` secret (and optional `NM_REPORTER_URL`).

## Continuous integration

[.github/workflows/ci.yml](../.github/workflows/ci.yml) — on every push to
`main`/`feat/**`/`fix/**` and every PR: `pnpm install --frozen-lockfile`,
`pnpm build`, `pnpm test`. This proves the library green against the reference
fixture without an emulator. The *live* Detox loop lives in the overnight
workflow, not here.
