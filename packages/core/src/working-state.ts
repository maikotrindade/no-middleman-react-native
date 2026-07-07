import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LoopMachineContext } from './machine.js';

// Human-readable single-run working state (§8 layer 1). Rewritten on every
// transition so a developer can watch the loop live via `git diff` or an
// editor tab. The lineage journal, not this file, is the source of truth.
export function writeWorkingState(path: string, state: string, context: LoopMachineContext): void {
  const failedSignals = context.lastResult?.signals.filter((s) => !s.passed) ?? [];
  const lines = [
    `# Loop: ${context.spec.id}`,
    '',
    `**Goal:** ${context.spec.taxonomy.intake.goal}`,
    '',
    `- State: ${state}`,
    `- Iteration: ${context.iteration} / ${context.spec.stopping.budget.maxIterations}`,
    `- Tokens spent: ${context.tokensSpent} / ${context.spec.stopping.budget.maxTokens}`,
    `- Wall clock: ${context.wallClockMs}ms / ${context.spec.stopping.budget.maxWallClockMs}ms`,
    ...(context.spec.stopping.reserve
      ? [
          `- Escalation reserve: ${context.spec.stopping.reserve.tokens} tokens / ${context.spec.stopping.reserve.wallClockMs}ms (kept for handoff)`,
        ]
      : []),
    `- Last verification: ${
      context.lastResult ? (context.lastResult.passed ? 'green' : 'red') : 'not run yet'
    }`,
  ];
  if (failedSignals.length > 0) {
    lines.push('', '## Failing checks', '');
    for (const signal of failedSignals) {
      lines.push(`- ${signal.id}${signal.detail ? `: ${signal.detail}` : ''}`);
    }
  }
  if (context.checkerReasons.length > 0) {
    lines.push('', '## Checker rejection reasons', '');
    for (const reason of context.checkerReasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (context.outcome) {
    lines.push('', `**Outcome:** ${context.outcome}`);
    if (context.failureReason) {
      lines.push('', `**Failure reason:** ${context.failureReason}`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}
