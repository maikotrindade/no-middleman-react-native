import type { LoopSpec, Verifier, VerifierResult } from '../src/types.js';
import { ALL_INVARIANTS } from '../src/invariants.js';

export function fakeResult(passed: boolean, id = 'fake'): VerifierResult {
  return {
    passed,
    signals: [{ id, passed, detail: passed ? undefined : `${id} is red` }],
    evidence: { logs: [], artifacts: [] },
  };
}

// A verifier scripted with a sequence of outcomes; repeats the last one.
export function seqVerifier(outcomes: boolean[], id = 'fake'): Verifier {
  let call = 0;
  return {
    id,
    gate: 'hard',
    cost: 'cheap',
    run: async () => fakeResult(outcomes[Math.min(call++, outcomes.length - 1)] ?? false, id),
  };
}

// Fresh valid spec per call; tests mutate the returned object as needed.
export function makeSpec(): LoopSpec {
  return {
    id: 'test-loop',
    taxonomy: {
      trigger: { kind: 'manual' },
      intake: {
        goal: 'fix the planted bug',
        scope: { include: ['src/**'], exclude: ['e2e/**'] },
      },
      verification: [seqVerifier([true])],
      stateModel: {
        workingState: '.nm/working-state.md',
        lineage: '.nm/lineage.jsonl',
        adapter: 'file',
      },
      topology: 'maker-checker',
      operatingDomain: 'react-native',
    },
    stopping: {
      success: 'all-hard-verifiers-green',
      budget: { maxIterations: 10, maxTokens: 1_000_000, maxWallClockMs: 3_600_000 },
      onBudgetExceeded: 'open-draft-pr',
    },
    agents: {
      maker: { name: 'maker', model: 'claude-opus-4-8', isolation: 'worktree' },
      checker: { name: 'checker', model: 'claude-opus-4-8', isolation: 'none' },
    },
    invariants: [...ALL_INVARIANTS],
  };
}
