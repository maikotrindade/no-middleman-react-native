import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_INVARIANTS, LoopRunner, type LoopSpec, type Verifier } from '@no-middleman/core';
import { describe, expect, it } from 'vitest';
import { durableHooks, type DurableStep } from '../src/index.js';

function greenVerifier(): Verifier {
  return {
    id: 'fake',
    gate: 'hard',
    cost: 'cheap',
    run: async () => ({ passed: true, signals: [], evidence: { logs: [], artifacts: [] } }),
  };
}

function makeSpec(): LoopSpec {
  return {
    id: 'durable-loop',
    taxonomy: {
      trigger: { kind: 'manual' },
      intake: { goal: 'g', scope: { include: ['src/**'], exclude: [] } },
      verification: [greenVerifier()],
      stateModel: { workingState: '.nm/ws.md', lineage: '.nm/lineage.jsonl', adapter: 'file' },
      topology: 'maker-checker',
      operatingDomain: 'react-native',
    },
    stopping: {
      success: 'all-hard-verifiers-green',
      budget: { maxIterations: 5, maxTokens: 1000, maxWallClockMs: 60_000 },
      onBudgetExceeded: 'open-draft-pr',
    },
    agents: {
      maker: { name: 'maker', model: 'claude-opus-4-8', isolation: 'worktree' },
      checker: { name: 'checker', model: 'claude-opus-4-8', isolation: 'none' },
    },
    invariants: [...ALL_INVARIANTS],
  };
}

describe('durableHooks', () => {
  it('routes every hook call through step.run with deterministic ids', async () => {
    const stepIds: string[] = [];
    const step: DurableStep = {
      run: async (id, fn) => {
        stepIds.push(id);
        return fn();
      },
    };
    const hooks = durableHooks(
      {
        plan: () => {},
        build: () => {},
        makerStep: () => ({ diffHash: 'd', tokensSpent: 1 }),
        checker: () => ({ accepted: true }),
        report: () => {},
      },
      step,
    );

    const cwd = mkdtempSync(join(tmpdir(), 'nm-durable-'));
    const outcome = await new LoopRunner(makeSpec(), hooks, { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    expect(stepIds).toEqual(['plan', 'build', 'maker-iteration-1', 'checker-iteration-1', 'report']);
  });

  it('passes hook return values through the step wrapper', async () => {
    const step: DurableStep = { run: async (_id, fn) => fn() };
    const hooks = durableHooks(
      {
        makerStep: () => ({ diffHash: 'abc', tokensSpent: 7 }),
        checker: () => ({ accepted: false, reasons: ['weak test'] }),
      },
      step,
    );
    const result = await hooks.makerStep({ cwd: '.', iteration: 0, spec: makeSpec() });
    expect(result).toEqual({ diffHash: 'abc', tokensSpent: 7 });
  });
});
