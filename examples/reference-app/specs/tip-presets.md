# Spec: Tip preset buttons

The tip calculator currently requires typing the tip percentage by hand.
Add one-tap preset buttons. This feature is **deliberately missing** — it is
the reference target for the `/nm-feature` spec→red→green loop (§11 of the
project README).

## Acceptance criteria

1. The tip calculator screen shows three preset buttons labelled `10%`,
   `15%`, and `20%`, with testIDs `preset-10`, `preset-15`, and `preset-20`.
2. Tapping a preset fills the tip input (`tip-input`) with that percentage,
   replacing any previous value.
3. Calculation uses the preset value: entering `80` as the bill, tapping
   `preset-15`, then tapping Calculate shows `Total: 92.00`.
4. Manual entry keeps working: typing a custom percentage after tapping a
   preset uses the typed value.

## Out of scope

- Persisting a preferred preset.
- Any change to the Home screen or to existing tip math in `src/lib/tip.ts`.
