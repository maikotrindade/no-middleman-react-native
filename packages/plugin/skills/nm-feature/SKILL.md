---
name: nm-feature
description: Spec→red→green flagship loop — draft a Detox acceptance flow from a written spec, get explicit human approval, then build the feature until the full composite verifier is green. Use for "/nm-feature <goal> --spec <path>" in a repo with nm.config.json.
---

# nm-feature — Spec → red → green

The flagship No Middleman loop. The human owns the two ends: they approve the
acceptance flow going in and review the PR coming out. Everything between is
autonomous.

## 0. Guardrails

All of `nm-fix` §0 applies (nm.config.json, budget, scope, kill switch,
never merge). Additionally:

- A written spec is required (`--spec <path>` or a detailed goal). If the
  acceptance criteria are ambiguous, ask the human **now**, not mid-loop.
- `human-approves-acceptance` is a hard invariant: no implementation work of
  any kind before step 2's explicit approval.

## 1. Draft the contract (spec-author)

Spawn the **spec-author** agent with the spec and read access to the app.
It adds exactly one Detox flow under `e2e/` encoding every criterion, plus
the list of new testIDs the feature must expose. It never touches app code.

## 2. Human gate — the one blocking step

Present to the user: the flow source, the criterion-by-criterion summary,
and why it is red today. Ask for explicit approval (use AskUserQuestion).

- Approved → the flow is **frozen**: from here on, any change to it by any
  agent is an automatic loop failure.
- Amendments → apply via spec-author, re-present. Never self-approve; if the
  user is unavailable, stop — do not proceed on silence.

## 3. Red baseline

1. `nm verify` (cheap suite) must be green — the loop starts from a healthy app.
2. `nm verify --e2e` must be red **only** on the new flow. If the new flow
   already passes, the spec is already implemented or the flow is weak —
   stop and tell the human. If pre-existing flows are red, stop: fix loops
   (`/nm-fix`) come first.

## 4. Iterate (maker) — same engine as nm-fix §2

Drive the **maker** agent via `/goal` with validator `nm verify --e2e`.
Scope for this loop always excludes `e2e/**` and `**/__tests__/**` except
that the maker may **add** new unit tests. The maker implements the testIDs
and behavior the approved flow demands. Lineage and working state exactly as
in nm-fix.

## 5. Adversarial review (checker)

Spawn the **checker** agent. Beyond its standard checks, it must confirm the
approved acceptance flow is byte-identical to what the human approved —
`git diff` on that file must be empty apart from its original addition.

## 6. Terminal: draft PR, never merge

As nm-fix §4, with the PR body additionally linking the spec file and
including the approved flow's criterion summary. The human reviews; the loop
never merges.
