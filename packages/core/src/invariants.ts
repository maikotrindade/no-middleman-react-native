import type { LoopSpec } from './types.js';

// Anti-patterns as enforced invariants. All eight are mandatory: a LoopSpec
// must declare every one, and the structurally checkable ones are verified at
// load time. The rest are declarations the runtime re-checks mid-loop.
export const ALL_INVARIANTS = [
  'require-verifiable-stop',   // no LoopSpec without a hard verifier -> refuse to run
  'bounded-retries',           // maxIterations + maxTokens + maxWallClock mandatory
  'maker-neq-checker',         // structurally distinct agents; no self-approval
  'tests-only-strengthen',     // checker rejects any weakened/deleted test
  'external-state-only',       // all state in md + JSONL; nothing context-only
  'read-only-by-default',      // scope globs + auto-mode perms; escalate to write
  'human-approves-acceptance', // acceptance flow approved before the loop runs
  'pr-not-merge',              // loop opens a PR; it never merges
] as const;

export type Invariant = (typeof ALL_INVARIANTS)[number];

export interface InvariantViolation {
  invariant: Invariant;
  message: string;
}

export class InvariantViolationError extends Error {
  constructor(public readonly violations: InvariantViolation[]) {
    super(
      'LoopSpec failed invariant validation:\n' +
        violations.map((v) => `- [${v.invariant}] ${v.message}`).join('\n'),
    );
    this.name = 'InvariantViolationError';
  }
}

export function validateLoopSpec(spec: LoopSpec): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const declared = new Set(spec.invariants);

  for (const invariant of ALL_INVARIANTS) {
    if (!declared.has(invariant)) {
      violations.push({
        invariant,
        message: `invariant '${invariant}' must be declared in spec.invariants`,
      });
    }
  }

  if (!spec.taxonomy.verification.some((v) => v.gate === 'hard')) {
    violations.push({
      invariant: 'require-verifiable-stop',
      message: 'at least one hard verifier is required',
    });
  }

  const { budget } = spec.stopping;
  for (const key of ['maxIterations', 'maxTokens', 'maxWallClockMs'] as const) {
    const value = budget[key];
    if (!Number.isFinite(value) || value <= 0) {
      violations.push({
        invariant: 'bounded-retries',
        message: `budget.${key} must be a positive finite number`,
      });
    }
  }

  if (spec.agents.maker.name === spec.agents.checker.name) {
    violations.push({
      invariant: 'maker-neq-checker',
      message: 'maker and checker must be structurally distinct agents',
    });
  }

  if (!spec.taxonomy.stateModel.workingState || !spec.taxonomy.stateModel.lineage) {
    violations.push({
      invariant: 'external-state-only',
      message: 'stateModel.workingState and stateModel.lineage paths are required',
    });
  }

  if (spec.taxonomy.intake.scope.include.length === 0) {
    violations.push({
      invariant: 'read-only-by-default',
      message: 'intake.scope.include must explicitly grant write access to at least one glob',
    });
  }

  return violations;
}

// A LoopSpec that fails invariant validation does not run.
export function assertValidLoopSpec(spec: LoopSpec): void {
  const violations = validateLoopSpec(spec);
  if (violations.length > 0) {
    throw new InvariantViolationError(violations);
  }
}
