import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoopContext, LoopSpec } from '@no-middleman/core';
import { describe, expect, it } from 'vitest';
import { commandVerifier } from '../src/command.js';
import { compositeVerifier, orderByCost } from '../src/composite.js';

export function fakeCtx(cwd: string): LoopContext {
  return { cwd, iteration: 1, spec: {} as LoopSpec };
}

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), 'nm-verifiers-'));
}

describe('commandVerifier', () => {
  it('passes on exit code 0 and writes an evidence log', async () => {
    const cwd = tmpCwd();
    const verifier = commandVerifier({
      id: 'echo',
      command: 'node',
      args: ['-e', "console.log('all good')"],
    });
    const result = await verifier.run(fakeCtx(cwd));

    expect(result.passed).toBe(true);
    expect(result.signals).toEqual([{ id: 'echo', passed: true, detail: undefined }]);
    const log = result.evidence.logs[0]!;
    expect(log).toBe(join(cwd, '.nm/evidence/echo-iter1.log'));
    expect(readFileSync(log, 'utf8')).toContain('all good');
  });

  it('fails on a non-zero exit code with the output tail as detail', async () => {
    const cwd = tmpCwd();
    const verifier = commandVerifier({
      id: 'boom',
      command: 'node',
      args: ['-e', "console.error('type error in App.tsx'); process.exit(2)"],
    });
    const result = await verifier.run(fakeCtx(cwd));

    expect(result.passed).toBe(false);
    expect(result.signals[0]!.detail).toContain('type error in App.tsx');
  });

  it('fails (not throws) when the command does not exist', async () => {
    const cwd = tmpCwd();
    const verifier = commandVerifier({ id: 'ghost', command: 'nm-definitely-not-a-binary' });
    const result = await verifier.run(fakeCtx(cwd));

    expect(result.passed).toBe(false);
    expect(existsSync(join(cwd, '.nm/evidence/ghost-iter1.log'))).toBe(true);
  });

  it('fails when the command exceeds its timeout', async () => {
    const cwd = tmpCwd();
    const verifier = commandVerifier({
      id: 'slow',
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100,
    });
    const result = await verifier.run(fakeCtx(cwd));

    expect(result.passed).toBe(false);
    expect(result.signals[0]!.detail).toContain('timed out');
  });
});

describe('composite', () => {
  it('orders verifiers cheap -> expensive, stable within a cost tier', () => {
    const mk = (id: string, cost: 'cheap' | 'moderate' | 'expensive') =>
      commandVerifier({ id, command: 'true', cost });
    const ordered = orderByCost([
      mk('e2e', 'expensive'),
      mk('typecheck', 'cheap'),
      mk('build', 'moderate'),
      mk('unit', 'cheap'),
    ]);
    expect(ordered.map((v) => v.id)).toEqual(['typecheck', 'unit', 'build', 'e2e']);
  });

  it('fails fast on the first red hard child', async () => {
    const cwd = tmpCwd();
    let expensiveRan = false;
    const red = commandVerifier({ id: 'red', command: 'node', args: ['-e', 'process.exit(1)'] });
    const expensive = {
      id: 'e2e',
      gate: 'hard' as const,
      cost: 'expensive' as const,
      run: async () => {
        expensiveRan = true;
        return { passed: true, signals: [], evidence: { logs: [], artifacts: [] } };
      },
    };
    const result = await compositeVerifier('all', [expensive, red]).run(fakeCtx(cwd));

    expect(result.passed).toBe(false);
    expect(expensiveRan).toBe(false); // red cheap verifier short-circuited it
  });

  it('does not gate on advisory reds', async () => {
    const cwd = tmpCwd();
    const advisoryRed = commandVerifier({
      id: 'lint',
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      gate: 'advisory',
    });
    const green = commandVerifier({ id: 'unit', command: 'node', args: ['-e', ''] });
    const result = await compositeVerifier('all', [advisoryRed, green]).run(fakeCtx(cwd));

    expect(result.passed).toBe(true);
    expect(result.signals.map((s) => s.passed)).toEqual([false, true]);
  });

  it('takes its cost from the most expensive child', () => {
    const cheap = commandVerifier({ id: 'a', command: 'true', cost: 'cheap' });
    const expensive = commandVerifier({ id: 'b', command: 'true', cost: 'expensive' });
    expect(compositeVerifier('all', [expensive, cheap]).cost).toBe('expensive');
  });
});
