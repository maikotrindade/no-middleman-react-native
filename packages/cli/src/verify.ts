import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LoopContext, LoopSpec, Verifier } from '@no-middleman/core';
import { lintVerifier, orderByCost, typecheckVerifier, unitVerifier } from '@no-middleman/verifiers';
import { detoxVerifier } from '@no-middleman/verifier-detox';

export interface NmConfig {
  verifiers?: ('typecheck' | 'lint' | 'unit')[];
  lintGate?: 'hard' | 'advisory';
  e2e?: {
    configuration: string;
    avdName: string;
    maxRuns?: number;
    bootTimeoutMs?: number;
  };
}

export function loadConfig(cwd: string): NmConfig {
  const path = join(cwd, 'nm.config.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as NmConfig;
}

function buildVerifiers(config: NmConfig, includeE2e: boolean): Verifier[] {
  const names = config.verifiers ?? ['typecheck', 'lint', 'unit'];
  const verifiers: Verifier[] = names.map((name) => {
    switch (name) {
      case 'typecheck':
        return typecheckVerifier();
      case 'lint':
        return lintVerifier(config.lintGate ? { gate: config.lintGate } : {});
      case 'unit':
        return unitVerifier();
      default:
        throw new Error(`unknown verifier '${String(name)}' in nm.config.json`);
    }
  });
  if (includeE2e) {
    if (!config.e2e) throw new Error('--e2e requested but nm.config.json has no "e2e" section');
    verifiers.push(detoxVerifier(config.e2e));
  }
  return orderByCost(verifiers);
}

// The validator surface for /goal: run the composite fail-fast, print one
// line per signal, exit 0 only when every hard verifier is green.
export async function runVerify(args: string[]): Promise<number> {
  const includeE2e = args.includes('--e2e');
  const cwdFlag = args.indexOf('--cwd');
  const cwd = resolve(cwdFlag >= 0 ? (args[cwdFlag + 1] ?? '.') : '.');

  const config = loadConfig(cwd);
  const verifiers = buildVerifiers(config, includeE2e);
  const ctx: LoopContext = { cwd, iteration: 0, spec: {} as LoopSpec };

  let allHardGreen = true;
  for (const verifier of verifiers) {
    const result = await verifier.run(ctx);
    for (const signal of result.signals) {
      const mark = signal.passed ? '✓' : verifier.gate === 'hard' ? '✗' : '⚠';
      console.log(`${mark} [${verifier.gate}] ${signal.id}${signal.detail ? ` — ${signal.detail}` : ''}`);
    }
    if (!result.passed && verifier.gate === 'hard') {
      allHardGreen = false;
      console.log(`\nRED: hard verifier '${verifier.id}' failed — stopping (fail-fast).`);
      break;
    }
  }
  if (allHardGreen) console.log('\nGREEN: all hard verifiers passed.');
  return allHardGreen ? 0 : 1;
}
