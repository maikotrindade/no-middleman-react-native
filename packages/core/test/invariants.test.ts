import { describe, expect, it } from 'vitest';
import {
  ALL_INVARIANTS,
  InvariantViolationError,
  assertValidLoopSpec,
  validateLoopSpec,
} from '../src/invariants.js';
import type { LoopSpec, Verifier } from '../src/types.js';

function fakeVerifier(overrides: Partial<Pick<Verifier, 'id' | 'gate' | 'cost'>> = {}): Verifier {
  return {
    id: 'fake',
    gate: 'hard',
    cost: 'cheap',
    run: async () => ({ passed: true, signals: [], evidence: { logs: [], artifacts: [] } }),
    ...overrides,
  };
}

function validSpec(): LoopSpec {
  return {
    id: 'test-loop',
    taxonomy: {
      trigger: { kind: 'manual' },
      intake: {
        goal: 'fix the planted bug',
        scope: { include: ['src/**'], exclude: ['e2e/**'] },
      },
      verification: [fakeVerifier()],
      stateModel: {
        workingState: '.nm/working-state.md',
        lineage: '.nm/lineage.jsonl',
        adapter: 'file',
      },
      context: { instructions: ['CLAUDE.md'], docs: [] },
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

describe('validateLoopSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateLoopSpec(validSpec())).toEqual([]);
  });

  it('rejects a spec missing a declared invariant', () => {
    const spec = validSpec();
    spec.invariants = spec.invariants.filter((i) => i !== 'pr-not-merge');
    const violations = validateLoopSpec(spec);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.invariant).toBe('pr-not-merge');
  });

  it('rejects a spec with no hard verifier (require-verifiable-stop)', () => {
    const spec = validSpec();
    spec.taxonomy.verification = [fakeVerifier({ gate: 'advisory' })];
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('require-verifiable-stop');
  });

  it('rejects a spec with an empty verifier list (require-verifiable-stop)', () => {
    const spec = validSpec();
    spec.taxonomy.verification = [];
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('require-verifiable-stop');
  });

  it.each([
    ['maxIterations', 0],
    ['maxTokens', -1],
    ['maxWallClockMs', Infinity],
  ] as const)('rejects non-positive or infinite budget.%s (bounded-retries)', (key, value) => {
    const spec = validSpec();
    spec.stopping.budget[key] = value;
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('bounded-retries');
  });

  it('accepts a reserve smaller than the budget', () => {
    const spec = validSpec();
    spec.stopping.reserve = { tokens: 50_000, wallClockMs: 60_000 };
    expect(validateLoopSpec(spec)).toEqual([]);
  });

  it.each([
    ['tokens', { tokens: 1_000_000, wallClockMs: 60_000 }],
    ['wallClockMs', { tokens: 50_000, wallClockMs: 3_600_000 }],
    ['negative', { tokens: -1, wallClockMs: 60_000 }],
  ] as const)('rejects a reserve that swallows the budget: %s (bounded-retries)', (_label, reserve) => {
    const spec = validSpec();
    spec.stopping.reserve = reserve;
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('bounded-retries');
  });

  it('rejects maker and checker being the same agent (maker-neq-checker)', () => {
    const spec = validSpec();
    spec.agents.checker = { ...spec.agents.maker };
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('maker-neq-checker');
  });

  it('rejects missing state paths (external-state-only)', () => {
    const spec = validSpec();
    spec.taxonomy.stateModel.lineage = '';
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('external-state-only');
  });

  it('rejects an empty write scope (read-only-by-default)', () => {
    const spec = validSpec();
    spec.taxonomy.intake.scope.include = [];
    expect(validateLoopSpec(spec).map((v) => v.invariant)).toContain('read-only-by-default');
  });

  it('reports every violation, not just the first', () => {
    const spec = validSpec();
    spec.taxonomy.verification = [];
    spec.agents.checker = { ...spec.agents.maker };
    const invariants = validateLoopSpec(spec).map((v) => v.invariant);
    expect(invariants).toContain('require-verifiable-stop');
    expect(invariants).toContain('maker-neq-checker');
  });
});

describe('assertValidLoopSpec', () => {
  it('does not throw for a valid spec', () => {
    expect(() => assertValidLoopSpec(validSpec())).not.toThrow();
  });

  it('throws InvariantViolationError listing violations for an invalid spec', () => {
    const spec = validSpec();
    spec.taxonomy.verification = [];
    try {
      assertValidLoopSpec(spec);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvariantViolationError);
      const e = err as InvariantViolationError;
      expect(e.violations.map((v) => v.invariant)).toContain('require-verifiable-stop');
      expect(e.message).toContain('require-verifiable-stop');
    }
  });
});
