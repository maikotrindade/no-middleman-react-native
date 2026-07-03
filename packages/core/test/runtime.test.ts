import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJournal, type JournalRecord } from '../src/journal.js';
import { LoopRunner, ReplayMismatchError, replayJournal, type LoopHooks } from '../src/runtime.js';
import type { Verifier } from '../src/types.js';
import { fakeResult, makeSpec, seqVerifier } from './helpers.js';

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), 'nm-test-'));
}

function defaultHooks(overrides: Partial<LoopHooks> = {}): LoopHooks {
  let step = 0;
  return {
    makerStep: () => ({ diffHash: `diff-${++step}`, tokensSpent: 10 }),
    checker: () => ({ accepted: true }),
    ...overrides,
  };
}

describe('LoopRunner', () => {
  it('closes the loop on a green fake verifier and accepting checker', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    const outcome = await new LoopRunner(spec, defaultHooks(), { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    expect(outcome.iterations).toBe(1);
    expect(outcome.tokensSpent).toBe(10);

    const states = readJournal(join(cwd, '.nm/lineage.jsonl')).map((r) => r.state);
    expect(states).toEqual([
      'planning',
      'building',
      'iterating',
      'verifying',
      'reviewing',
      'succeeded',
      'reporting',
      'done',
    ]);
  });

  it('iterates while a hard verifier is red, then succeeds', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false, false, true])];
    const outcome = await new LoopRunner(spec, defaultHooks(), { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    expect(outcome.iterations).toBe(3);
    expect(outcome.tokensSpent).toBe(30);
  });

  it('stops at maxIterations with a budgetExceeded outcome', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false])];
    spec.stopping.budget.maxIterations = 2;
    let reported: string | undefined;
    const hooks = defaultHooks({
      report: (outcome) => {
        reported = outcome.kind;
      },
    });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('budgetExceeded');
    expect(outcome.iterations).toBe(2);
    expect(reported).toBe('budgetExceeded');
  });

  it('stops when maxTokens is exhausted', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false])];
    spec.stopping.budget.maxTokens = 100;
    const hooks = defaultHooks({ makerStep: () => ({ diffHash: 'd', tokensSpent: 60 }) });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('budgetExceeded');
    expect(outcome.iterations).toBe(2);
    expect(outcome.tokensSpent).toBe(120);
  });

  it('stops when maxWallClockMs is exhausted', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false])];
    spec.stopping.budget.maxWallClockMs = 1;
    const hooks = defaultHooks({
      makerStep: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { diffHash: 'd', tokensSpent: 1 };
      },
    });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('budgetExceeded');
    expect(outcome.iterations).toBe(1);
  });

  it('sends the loop back to iterating when the checker rejects', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    const verdicts = [
      { accepted: false, reasons: ['assertion was weakened'] },
      { accepted: true },
    ];
    const hooks = defaultHooks({ checker: () => verdicts.shift()! });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    expect(outcome.iterations).toBe(2);
    const workingState = readFileSync(join(cwd, '.nm/working-state.md'), 'utf8');
    expect(workingState).toContain('succeeded');
  });

  it('halts between iterations when the kill switch sentinel appears', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false])];
    const hooks = defaultHooks({
      makerStep: () => {
        writeFileSync(join(cwd, '.nm/KILL'), '');
        return { diffHash: 'd', tokensSpent: 1 };
      },
    });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('failed');
    expect(outcome.failureReason).toBe('kill switch engaged');
    expect(outcome.iterations).toBe(1);
    // Always leaves a written state file; sentinel is consumed.
    expect(readFileSync(join(cwd, '.nm/working-state.md'), 'utf8')).toContain('failed');
    expect(existsSync(join(cwd, '.nm/KILL'))).toBe(false);
  });

  it('records a hook crash as a failed outcome, not an exception', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    const hooks = defaultHooks({
      makerStep: () => {
        throw new Error('maker exploded');
      },
    });
    const outcome = await new LoopRunner(spec, hooks, { cwd }).run();

    expect(outcome.kind).toBe('failed');
    expect(outcome.failureReason).toBe('maker exploded');
  });

  it('refuses to run a spec that violates invariants', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [];
    await expect(new LoopRunner(spec, defaultHooks(), { cwd }).run()).rejects.toThrow(
      /require-verifiable-stop/,
    );
    expect(existsSync(join(cwd, '.nm/lineage.jsonl'))).toBe(false);
  });

  it('does not gate on advisory verifiers but records their signals', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    const advisoryRed: Verifier = {
      id: 'lint',
      gate: 'advisory',
      cost: 'cheap',
      run: async () => fakeResult(false, 'lint'),
    };
    spec.taxonomy.verification = [advisoryRed, seqVerifier([true], 'unit')];
    const outcome = await new LoopRunner(spec, defaultHooks(), { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    const verified = readJournal(join(cwd, '.nm/lineage.jsonl')).find((r) => r.verifier);
    expect(verified!.verifier!.passed).toBe(true);
    expect(verified!.verifier!.signals).toEqual([
      expect.objectContaining({ id: 'lint', passed: false }),
      expect.objectContaining({ id: 'unit', passed: true }),
    ]);
  });

  it('fails fast: a red hard verifier stops later verifiers from running', async () => {
    const cwd = tmpCwd();
    const spec = makeSpec();
    let expensiveRuns = 0;
    const expensive: Verifier = {
      id: 'e2e',
      gate: 'hard',
      cost: 'expensive',
      run: async () => {
        expensiveRuns++;
        return fakeResult(true, 'e2e');
      },
    };
    spec.taxonomy.verification = [seqVerifier([false, true], 'typecheck'), expensive];
    const outcome = await new LoopRunner(spec, defaultHooks(), { cwd }).run();

    expect(outcome.kind).toBe('succeeded');
    expect(outcome.iterations).toBe(2);
    expect(expensiveRuns).toBe(1); // skipped on the red iteration
  });
});

describe('replay and resume', () => {
  async function completedJournal(): Promise<{ cwd: string; records: JournalRecord[] }> {
    const cwd = tmpCwd();
    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false, true])];
    await new LoopRunner(spec, defaultHooks(), { cwd }).run();
    return { cwd, records: readJournal(join(cwd, '.nm/lineage.jsonl')) };
  }

  it('replays a completed journal to the exact same state sequence', async () => {
    const { records } = await completedJournal();
    const actor = replayJournal(makeSpec(), records);
    expect(String(actor.getSnapshot().value)).toBe('done');
    expect(actor.getSnapshot().context.iteration).toBe(2);
  });

  it('throws ReplayMismatchError when the journal is tampered with', async () => {
    const { records } = await completedJournal();
    records[3]!.state = 'reviewing';
    expect(() => replayJournal(makeSpec(), records)).toThrow(ReplayMismatchError);
  });

  it('resumes an interrupted run from the journal and completes it', async () => {
    const { records } = await completedJournal();
    // Simulate a crash mid-run: keep the journal only up to the first
    // ITERATED record (machine parked in 'verifying').
    const cut = records.findIndex((r) => r.state === 'verifying') + 1;
    const truncated = records.slice(0, cut);
    const cwd = tmpCwd();
    const journalPath = join(cwd, '.nm/lineage.jsonl');
    mkdirSync(join(cwd, '.nm'), { recursive: true });
    writeFileSync(journalPath, truncated.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const spec = makeSpec();
    spec.taxonomy.verification = [seqVerifier([false, true])];
    const outcome = await new LoopRunner(spec, defaultHooks(), { cwd }).resume();

    expect(outcome.kind).toBe('succeeded');
    expect(outcome.iterations).toBe(2);
    const states = readJournal(journalPath).map((r) => r.state);
    expect(states.slice(0, cut)).toEqual(truncated.map((r) => r.state));
    expect(states.at(-1)).toBe('done');
  });

  it('returns the recorded outcome when resuming an already-completed journal', async () => {
    const { cwd, records } = await completedJournal();
    const outcome = await new LoopRunner(makeSpec(), defaultHooks(), { cwd }).resume();

    expect(outcome.kind).toBe('succeeded');
    // No re-driving: the journal did not grow.
    expect(readJournal(join(cwd, '.nm/lineage.jsonl'))).toHaveLength(records.length);
  });

  it('falls back to a fresh run when there is no journal to resume', async () => {
    const cwd = tmpCwd();
    const outcome = await new LoopRunner(makeSpec(), defaultHooks(), { cwd }).resume();
    expect(outcome.kind).toBe('succeeded');
  });
});
