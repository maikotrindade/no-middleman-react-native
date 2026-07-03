import type { Verifier, VerifierResult } from '@no-middleman/core';

const COST_RANK = { cheap: 0, moderate: 1, expensive: 2 } as const;

// Stable sort into the fail-fast order the spec mandates: cheap -> expensive.
export function orderByCost(verifiers: Verifier[]): Verifier[] {
  return [...verifiers].sort((a, b) => COST_RANK[a.cost] - COST_RANK[b.cost]);
}

// Bundles verifiers into one, running them cheap -> expensive and stopping at
// the first red HARD child. Advisory reds are recorded but never gate.
export function compositeVerifier(
  id: string,
  children: Verifier[],
  options: { gate?: 'hard' | 'advisory' } = {},
): Verifier {
  const ordered = orderByCost(children);
  return {
    id,
    gate: options.gate ?? 'hard',
    cost: ordered.at(-1)?.cost ?? 'cheap',
    async run(ctx) {
      const aggregate: VerifierResult = {
        passed: true,
        signals: [],
        evidence: { logs: [], artifacts: [] },
      };
      for (const child of ordered) {
        const result = await child.run(ctx);
        aggregate.signals.push(...result.signals);
        aggregate.evidence.logs.push(...result.evidence.logs);
        aggregate.evidence.artifacts.push(...result.evidence.artifacts);
        if (!result.passed && child.gate === 'hard') {
          aggregate.passed = false;
          break;
        }
      }
      return aggregate;
    },
  };
}
