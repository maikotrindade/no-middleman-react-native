# @no-middleman/plugin

Claude Code plugin for No Middleman loops. Ships two loop presets
(`/nm-fix`, `/nm-feature`), the maker/checker/spec-author agents, and the
lineage + reporting hooks.

## Triggers

- **Manual:** `/nm-fix <bug>` or `/nm-feature <goal> --spec <path>` in a repo
  with `nm.config.json`.
- **In-session cadence:** `/loop 2h /nm-fix` — note `/loop` is session-scoped
  and expires after three days; it is for supervised runs only.
- **Real overnight runs:** the emitted GitHub Actions workflow
  (`.github/workflows/overnight-loop.yml`) — cron-triggered `claude -p`
  with the Detox dev-client binary cached between runs.

## Reporting

The `Stop` hook POSTs a `RunDigest` (working state + lineage tail) to
`$NM_REPORTER_URL`. Run the target with:

```sh
RESEND_API_KEY=... NM_DIGEST_FROM=loops@you.dev NM_DIGEST_TO=you@you.dev npx nm-reporter
```

Unset `NM_REPORTER_URL` and the hook is a silent no-op.

## Kill switch

Create `.nm/KILL` in the target repo; the loop halts between iterations and
leaves the worktree clean.
