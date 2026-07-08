# No Middleman — documentation

Deep reference for the No Middleman codebase. Start with [../CLAUDE.md](../CLAUDE.md)
for a one-page orientation, or the [root README](../README.md) for the product
pitch and quick start.

## Map

1. **[overview.md](overview.md)** — the product model: what Loop Engineering
   means here, the human-bookends design, and why "the agent says it's done"
   actually means done.
2. **[loop-contract.md](loop-contract.md)** — the `LoopSpec` taxonomy (the five
   axes plus stopping rule) and the eight enforced invariants.
3. **[architecture.md](architecture.md)** — the XState runtime, the append-only
   JSONL journal, deterministic replay, resume, and the kill switch.
4. **[verifiers.md](verifiers.md)** — the composite verifier model, the
   typecheck/lint/unit/build presets, and the Detox oracle (build-once/
   reload-many, native-input hashing, flake majority vote, emulator + Metro
   lifecycle).
5. **[workflows.md](workflows.md)** — the Claude Code plugin: the `/nm-fix`,
   `/nm-feature`, `/nm-triage` skills; the maker/checker/spec-author agents; the
   lineage + reporting hooks; and the CI / overnight triggers.
6. **[packages.md](packages.md)** — a per-package reference: role, public
   exports, dependencies, and how the packages compose.
7. **[reference-app.md](reference-app.md)** — the rigged Expo fixture: the
   planted bug, the deliberately missing feature, the Detox flows, and how
   `prove:oracle` exercises the whole oracle end to end.

## Conventions used across these docs

- **`§n`** references point at numbered sections of the internal design doc; you
  will also see them as inline comments in the source (e.g. `// §6.1`). They mark
  the design decision a piece of code implements.
- **Hard vs. advisory** verifier: a *hard* verifier must be green for the loop to
  stop; an *advisory* one is recorded in the signals but never gates.
- **Maker / checker / spec-author** are the three loop agents; they are
  structurally distinct by invariant.
- **Green** always means "the verifier exited 0", never an agent's opinion.
