import { assign, setup } from 'xstate';
import type { LoopSpec, VerifierResult } from './types.js';

export type LoopOutcomeKind = 'succeeded' | 'budgetExceeded' | 'failed';

// Every event the machine consumes is recorded in the journal with its full
// payload, so replaying the journal reproduces the exact same state sequence.
// Nothing inside the machine reads the clock or any other ambient state.
export type LoopEvent =
  | { type: 'START' }
  | { type: 'PLANNED' }
  | { type: 'BUILT' }
  | { type: 'ITERATED'; diffHash: string; tokensSpent: number; elapsedMs: number }
  | { type: 'VERIFIED'; result: VerifierResult; elapsedMs: number }
  | { type: 'CHECKER_ACCEPTED' }
  | { type: 'CHECKER_REJECTED'; reasons: string[] }
  | { type: 'KILLED'; reason: string }
  | { type: 'FAILED'; reason: string }
  | { type: 'REPORT' }
  | { type: 'REPORTED' };

export interface LoopMachineContext {
  spec: LoopSpec;
  iteration: number;
  tokensSpent: number;
  wallClockMs: number;
  lastResult?: VerifierResult;
  lastDiffHash?: string;
  checkerReasons: string[];
  outcome?: LoopOutcomeKind;
  failureReason?: string;
}

export const loopMachine = setup({
  types: {
    context: {} as LoopMachineContext,
    events: {} as LoopEvent,
    input: {} as { spec: LoopSpec },
  },
  actions: {
    recordFailure: assign({
      failureReason: ({ event }) =>
        event.type === 'KILLED' || event.type === 'FAILED' ? event.reason : undefined,
    }),
  },
  guards: {
    allHardGreen: ({ context }) => context.lastResult?.passed === true,
    budgetHit: ({ context }) => {
      const { budget, reserve } = context.spec.stopping;
      // Iteration must stop with the reserve still unspent, so the escalation
      // handoff (report + draft PR) always has headroom.
      const tokenCap = budget.maxTokens - (reserve?.tokens ?? 0);
      const wallCap = budget.maxWallClockMs - (reserve?.wallClockMs ?? 0);
      return (
        context.iteration >= budget.maxIterations ||
        context.tokensSpent >= tokenCap ||
        context.wallClockMs >= wallCap
      );
    },
  },
}).createMachine({
  id: 'nm-loop',
  initial: 'idle',
  context: ({ input }) => ({
    spec: input.spec,
    iteration: 0,
    tokensSpent: 0,
    wallClockMs: 0,
    checkerReasons: [],
  }),
  states: {
    idle: {
      on: { START: 'planning' },
    },
    planning: {
      on: {
        PLANNED: 'building',
        FAILED: { target: 'failed', actions: 'recordFailure' },
      },
    },
    building: {
      on: {
        BUILT: 'iterating',
        FAILED: { target: 'failed', actions: 'recordFailure' },
      },
    },
    iterating: {
      on: {
        ITERATED: {
          target: 'verifying',
          actions: assign({
            iteration: ({ context }) => context.iteration + 1,
            tokensSpent: ({ context, event }) => context.tokensSpent + event.tokensSpent,
            wallClockMs: ({ context, event }) => context.wallClockMs + event.elapsedMs,
            lastDiffHash: ({ event }) => event.diffHash,
          }),
        },
        KILLED: { target: 'failed', actions: 'recordFailure' },
        FAILED: { target: 'failed', actions: 'recordFailure' },
      },
    },
    verifying: {
      on: {
        VERIFIED: {
          target: 'evaluating',
          actions: assign({
            lastResult: ({ event }) => event.result,
            wallClockMs: ({ context, event }) => context.wallClockMs + event.elapsedMs,
          }),
        },
        FAILED: { target: 'failed', actions: 'recordFailure' },
      },
    },
    // Transient: resolves synchronously, so it never appears in the journal.
    evaluating: {
      always: [
        { guard: 'allHardGreen', target: 'reviewing' },
        { guard: 'budgetHit', target: 'budgetExceeded' },
        { target: 'iterating' },
      ],
    },
    reviewing: {
      on: {
        CHECKER_ACCEPTED: 'succeeded',
        CHECKER_REJECTED: {
          target: 'iterating',
          actions: assign({ checkerReasons: ({ event }) => event.reasons }),
        },
        KILLED: { target: 'failed', actions: 'recordFailure' },
        FAILED: { target: 'failed', actions: 'recordFailure' },
      },
    },
    succeeded: {
      entry: assign({ outcome: 'succeeded' as const }),
      on: { REPORT: 'reporting' },
    },
    budgetExceeded: {
      entry: assign({ outcome: 'budgetExceeded' as const }),
      on: { REPORT: 'reporting' },
    },
    failed: {
      entry: assign({ outcome: 'failed' as const }),
      on: { REPORT: 'reporting' },
    },
    reporting: {
      on: { REPORTED: 'done' },
    },
    done: {
      type: 'final',
    },
  },
});
