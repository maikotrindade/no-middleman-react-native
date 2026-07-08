---
name: nm-fix
description: Fix-until-green No Middleman loop — iterate on a bug with `nm verify` as the oracle, adversarial checker review, then a draft PR. Use when asked to run the fix loop (e.g. "/nm-fix <bug description>") in a repo with nm.config.json.
---

# nm-fix — Fix-until-green loop

You are orchestrating a No Middleman loop. The human approved the goal going
in and reviews the PR coming out; between those bookends there is no human.

## 0. Guardrails — validate before any work

Refuse to start (tell the user what's missing) unless all of these hold:

- `nm.config.json` exists in the target repo (the verifier contract).
- A budget is stated or provided: default **maxIterations: 10**. Announce it.
- A scope is stated: which globs the maker may edit (default: `src/**`,
  excluding `e2e/**` and `**/__tests__/**`). Announce it.
- `nm verify` runs (red is fine — that's the point; a crash is not).

Kill switch: before every iteration, if `.nm/KILL` exists, stop, clean up,
and report. Never merge anything; the loop's terminal action is a **draft PR**.

## 1. Baseline

1. Create/refresh `.nm/working-state.md` with: goal, scope globs, budget,
   iteration 0, and the initial `nm verify` output.
2. Run `nm verify` to capture the red baseline. If everything is already
   green including `--e2e`, report "nothing to fix" and stop.

## 2. Iterate (maker)

Drive iterations with `/goal` if available — goal: the bug description;
validator: `nm verify` (add `--e2e` once the cheap suite is green). Otherwise
loop manually. Either way, each iteration must:

1. Read `.nm/working-state.md`; never repeat a logged hypothesis.
2. Delegate the edit to the **maker** agent (worktree isolation) with the
   scope globs; the maker's rules in `agents/maker.md` are binding.
3. Run `nm verify`; append one line to `.nm/lineage.jsonl`
   (`{ts, iteration, verifier, passed}`) and update the working state.
4. Red and budget left → iterate. Red and budget exhausted → step 4 with a
   draft PR labelled `budget-exceeded`. Green → step 3.

## 3. Adversarial review (checker)

Spawn the **checker** agent (never the maker) with the full diff and the
goal. `REJECT` → write the reasons into the working state and go back to
step 2. `ACCEPT` → step 4.

## 4. Terminal: PR, never merge

1. Commit on a branch (`fix/<slug>`), Conventional Commits message, author
   is the repository owner — never Claude.
2. Open a **draft PR** (`gh pr create --draft`) whose body includes: goal,
   iterations used, tokens/budget notes, final `nm verify` output, checker
   verdict, and flake warnings if any signal was marked FLAKY.
3. Report the PR link and stop. Merging is the human's job.
