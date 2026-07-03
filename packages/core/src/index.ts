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
