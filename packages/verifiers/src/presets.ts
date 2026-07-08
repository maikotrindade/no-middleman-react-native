import type { Verifier } from '@no-middleman/core';
import { commandVerifier, type CommandVerifierOptions } from './command.js';

type PresetOverrides = Partial<CommandVerifierOptions>;

export function typecheckVerifier(overrides: PresetOverrides = {}): Verifier {
  return commandVerifier({
    id: 'typecheck',
    command: 'npx',
    args: ['tsc', '--noEmit'],
    gate: 'hard',
    cost: 'cheap',
    ...overrides,
  });
}

// Advisory by default (§6); pass { gate: 'hard' } to make it gate.
export function lintVerifier(overrides: PresetOverrides = {}): Verifier {
  return commandVerifier({
    id: 'lint',
    command: 'npx',
    args: ['eslint', '.'],
    gate: 'advisory',
    cost: 'cheap',
    ...overrides,
  });
}

export function unitVerifier(overrides: PresetOverrides = {}): Verifier {
  return commandVerifier({
    id: 'unit',
    command: 'npx',
    args: ['jest', '--ci'],
    gate: 'hard',
    cost: 'cheap',
    ...overrides,
  });
}

// No default command: what "build" means is app-specific (M3 wires the
// cached Detox dev-client build through this).
export function buildVerifier(
  options: Pick<CommandVerifierOptions, 'command'> & PresetOverrides,
): Verifier {
  return commandVerifier({
    id: 'build',
    gate: 'hard',
    cost: 'expensive',
    ...options,
  });
}
