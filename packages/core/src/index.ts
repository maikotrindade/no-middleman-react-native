export type {
  Trigger,
  Intake,
  Verifier,
  VerifierSignal,
  Evidence,
  VerifierResult,
  LoopContext,
  MemoryRef,
  Topology,
  StoppingRule,
  AgentRef,
  LoopSpec,
} from './types.js';

export {
  ALL_INVARIANTS,
  InvariantViolationError,
  validateLoopSpec,
  assertValidLoopSpec,
} from './invariants.js';
export type { Invariant, InvariantViolation } from './invariants.js';

export { loopMachine } from './machine.js';
export type { LoopEvent, LoopMachineContext, LoopOutcomeKind } from './machine.js';

export { appendRecord, readJournal } from './journal.js';
export type { JournalRecord } from './journal.js';

export { LoopRunner, ReplayMismatchError, replayJournal } from './runtime.js';
export type {
  CheckerVerdict,
  LoopHooks,
  LoopOutcome,
  LoopRunnerOptions,
  MakerStepResult,
} from './runtime.js';

export { writeWorkingState } from './working-state.js';
