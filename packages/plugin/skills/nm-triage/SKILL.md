---
name: nm-triage
description: Scheduled read-only discovery — run the composite verifier, catalogue red and flaky flows into a triage report, optionally open issues. Never fixes anything. Use for "/nm-triage", typically on a /loop cadence or the overnight workflow.
---

# nm-triage — discovery, no fixes

A tag-along loop that embodies `read-only-by-default`: it observes and
reports, and is structurally forbidden from editing code or tests. Fixing is
`/nm-fix`'s job, and only when a human asks for it.

## Protocol (single pass, no iteration)

1. **Verify.** Run `nm verify` in the target repo; if `nm.config.json` has an
   `e2e` section and an emulator/AVD is available, run `nm verify --e2e` too.
2. **Catalogue.** From the printed signals and `.nm/evidence/` logs collect:
   red hard verifiers (with the failing detail), advisory reds, and any
   signal marked `FLAKY` (chronic-flake candidates).
3. **Report.** Write `.nm/triage/<YYYY-MM-DD>.md`: one section per finding —
   signal id, first relevant error lines, evidence log path, and a suggested
   next action (`/nm-fix "<goal>"` one-liner the human can paste).
4. **Optionally file issues.** If the user asked for issues (or the config
   sets `"triage": { "openIssues": true }`), `gh issue create` one issue per
   *new* red — search existing open issues by the signal id first; never
   duplicate, never close anything.
5. **Stop.** Report the triage file path and a one-paragraph summary.

## Hard limits

- No file edits outside `.nm/triage/`. No commits, no branches, no PRs.
- No re-runs to "confirm" a red beyond what the verifier's own flake vote
  already did — the oracle owns flake handling.
- If `nm verify` itself crashes (as opposed to failing), report that as the
  single finding: a broken oracle outranks everything it would have found.
