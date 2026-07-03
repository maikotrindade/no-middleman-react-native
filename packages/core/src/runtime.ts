import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createActor } from 'xstate';
import { assertValidLoopSpec } from './invariants.js';
import { appendRecord, readJournal, type JournalRecord } from './journal.js';
import { loopMachine, type LoopEvent, type LoopOutcomeKind } from './machine.js';
import { writeWorkingState } from './working-state.js';
import type { LoopContext, LoopSpec, VerifierResult } from './types.js';

export interface MakerStepResult {
  diffHash: string;
  tokensSpent: number;
}

export interface CheckerVerdict {
  accepted: boolean;
  reasons?: string[];
}

// M1 hooks: the maker/checker are callbacks so the machine closes on fakes.
// M4+ binds them to the Claude Code maker/checker agents.
export interface LoopHooks {
  plan?: (ctx: LoopContext) => void | Promise<void>;
  build?: (ctx: LoopContext) => void | Promise<void>;
  makerStep: (ctx: LoopContext) => MakerStepResult | Promise<MakerStepResult>;
  checker: (ctx: LoopContext, result: VerifierResult) => CheckerVerdict | Promise<CheckerVerdict>;
  report?: (outcome: LoopOutcome) => void | Promise<void>;
}

export interface LoopRunnerOptions {
  cwd: string;
  worktree?: string;
  killSwitchPath?: string; // default <cwd>/.nm/KILL
}

export interface LoopOutcome {
  kind: LoopOutcomeKind;
  iterations: number;
  tokensSpent: number;
  wallClockMs: number;
  failureReason?: string;
}

export class ReplayMismatchError extends Error {
  constructor(index: number, expected: string, actual: string) {
    super(`journal replay diverged at record ${index}: expected state '${expected}', got '${actual}'`);
    this.name = 'ReplayMismatchError';
  }
}

type LoopActor = ReturnType<typeof createActor<typeof loopMachine>>;

// Replay = re-send every recorded event into a fresh machine and assert the
// resulting state sequence matches the journal exactly.
export function replayJournal(spec: LoopSpec, records: JournalRecord[]): LoopActor {
  const actor = createActor(loopMachine, { input: { spec } });
  actor.start();
  for (const [index, record] of records.entries()) {
    actor.send(record.event);
    const snapshot = actor.getSnapshot();
    const state = String(snapshot.value);
    if (state !== record.state) {
      throw new ReplayMismatchError(index, record.state, state);
    }
    if (snapshot.context.tokensSpent !== record.tokensSpent) {
      throw new ReplayMismatchError(
        index,
        `tokensSpent=${record.tokensSpent}`,
        `tokensSpent=${snapshot.context.tokensSpent}`,
      );
    }
  }
  return actor;
}

export class LoopRunner {
  private readonly journalPath: string;
  private readonly workingStatePath: string;
  private readonly killSwitchPath: string;
  private actor: LoopActor;
  private killRequested = false;

  constructor(
    private readonly spec: LoopSpec,
    private readonly hooks: LoopHooks,
    private readonly options: LoopRunnerOptions,
  ) {
    this.journalPath = resolve(options.cwd, spec.taxonomy.stateModel.lineage);
    this.workingStatePath = resolve(options.cwd, spec.taxonomy.stateModel.workingState);
    this.killSwitchPath = options.killSwitchPath ?? resolve(options.cwd, '.nm/KILL');
    this.actor = createActor(loopMachine, { input: { spec } });
  }

  // Fresh run from idle.
  async run(): Promise<LoopOutcome> {
    assertValidLoopSpec(this.spec);
    this.actor.start();
    this.send({ type: 'START' });
    return this.drive();
  }

  // Resume = replay the journal into a fresh machine, then continue driving.
  async resume(): Promise<LoopOutcome> {
    assertValidLoopSpec(this.spec);
    const records = readJournal(this.journalPath).filter((r) => r.loopId === this.spec.id);
    if (records.length === 0) return this.run();
    this.actor = replayJournal(this.spec, records);
    if (String(this.actor.getSnapshot().value) === 'done') return this.outcome();
    return this.drive();
  }

  // Sends an event and appends the resulting transition to the journal.
  private send(event: LoopEvent): void {
    this.actor.send(event);
    const snapshot = this.actor.getSnapshot();
    const state = String(snapshot.value);
    appendRecord(this.journalPath, {
      ts: new Date().toISOString(),
      loopId: this.spec.id,
      iteration: snapshot.context.iteration,
      state,
      event,
      tokensSpent: snapshot.context.tokensSpent,
      verifier: event.type === 'VERIFIED' ? event.result : undefined,
      diffHash: snapshot.context.lastDiffHash,
      worktree: this.options.worktree,
    });
    writeWorkingState(this.workingStatePath, state, snapshot.context);
  }

  private loopContext(): LoopContext {
    return {
      cwd: this.options.cwd,
      spec: this.spec,
      iteration: this.actor.getSnapshot().context.iteration,
    };
  }

  private outcome(): LoopOutcome {
    const { context } = this.actor.getSnapshot();
    return {
      kind: context.outcome ?? 'failed',
      iterations: context.iteration,
      tokensSpent: context.tokensSpent,
      wallClockMs: context.wallClockMs,
      failureReason: context.failureReason,
    };
  }

  private shouldKill(): boolean {
    return this.killRequested || existsSync(this.killSwitchPath);
  }

  // Composite verification: run in declared (cheap -> expensive) order,
  // fail fast on the first red HARD verifier. Advisory reds are recorded
  // in the signals but never gate.
  private async runVerifiers(): Promise<VerifierResult> {
    const ctx = this.loopContext();
    const aggregate: VerifierResult = {
      passed: true,
      signals: [],
      evidence: { logs: [], artifacts: [] },
    };
    for (const verifier of this.spec.taxonomy.verification) {
      const result = await verifier.run(ctx);
      aggregate.signals.push(...result.signals);
      aggregate.evidence.logs.push(...result.evidence.logs);
      aggregate.evidence.artifacts.push(...result.evidence.artifacts);
      if (!result.passed && verifier.gate === 'hard') {
        aggregate.passed = false;
        break;
      }
    }
    return aggregate;
  }

  private async drive(): Promise<LoopOutcome> {
    const onSigint = () => {
      this.killRequested = true;
    };
    process.on('SIGINT', onSigint);
    try {
      for (;;) {
        const state = String(this.actor.getSnapshot().value);
        switch (state) {
          case 'idle':
            this.send({ type: 'START' });
            break;
          case 'planning':
            await this.step(async () => {
              await this.hooks.plan?.(this.loopContext());
              this.send({ type: 'PLANNED' });
            });
            break;
          case 'building':
            await this.step(async () => {
              await this.hooks.build?.(this.loopContext());
              this.send({ type: 'BUILT' });
            });
            break;
          case 'iterating': {
            // Kill switch is honored between iterations, never mid-edit.
            if (this.shouldKill()) {
              this.send({ type: 'KILLED', reason: 'kill switch engaged' });
              break;
            }
            await this.step(async () => {
              const startedAt = Date.now();
              const result = await this.hooks.makerStep(this.loopContext());
              this.send({ type: 'ITERATED', ...result, elapsedMs: Date.now() - startedAt });
            });
            break;
          }
          case 'verifying':
            await this.step(async () => {
              const startedAt = Date.now();
              const result = await this.runVerifiers();
              this.send({ type: 'VERIFIED', result, elapsedMs: Date.now() - startedAt });
            });
            break;
          case 'reviewing': {
            if (this.shouldKill()) {
              this.send({ type: 'KILLED', reason: 'kill switch engaged' });
              break;
            }
            await this.step(async () => {
              const snapshot = this.actor.getSnapshot();
              const verdict = await this.hooks.checker(this.loopContext(), snapshot.context.lastResult!);
              if (verdict.accepted) {
                this.send({ type: 'CHECKER_ACCEPTED' });
              } else {
                this.send({ type: 'CHECKER_REJECTED', reasons: verdict.reasons ?? [] });
              }
            });
            break;
          }
          case 'succeeded':
          case 'budgetExceeded':
          case 'failed':
            this.send({ type: 'REPORT' });
            break;
          case 'reporting':
            await this.hooks.report?.(this.outcome());
            this.send({ type: 'REPORTED' });
            break;
          case 'done':
            if (existsSync(this.killSwitchPath)) {
              rmSync(this.killSwitchPath, { force: true });
            }
            return this.outcome();
          default:
            throw new Error(`loop runner reached unexpected state '${state}'`);
        }
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
  }

  // Hook failures are loop failures, not crashes: they land in the journal.
  private async step(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.send({ type: 'FAILED', reason: err instanceof Error ? err.message : String(err) });
    }
  }
}
