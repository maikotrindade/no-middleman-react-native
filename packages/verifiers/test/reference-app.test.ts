import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { LoopContext, LoopSpec } from '@no-middleman/core';
import { describe, expect, it } from 'vitest';
import { compositeVerifier } from '../src/composite.js';
import { lintVerifier, typecheckVerifier, unitVerifier } from '../src/presets.js';

// Integration: the real tools against the real fixture app. The reference
// app's baseline must be green for typecheck/lint/unit — the planted bug is
// only visible to the Detox flow (M3).
const appDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../examples/reference-app');
const ctx: LoopContext = { cwd: appDir, iteration: 0, spec: {} as LoopSpec };
const TIMEOUT = 180_000;

describe('reference-app baseline', () => {
  it('typecheck is green', { timeout: TIMEOUT }, async () => {
    const result = await typecheckVerifier().run(ctx);
    expect(result.signals[0]!.detail ?? '').toBe('');
    expect(result.passed).toBe(true);
  });

  it('lint is green', { timeout: TIMEOUT }, async () => {
    const result = await lintVerifier().run(ctx);
    expect(result.signals[0]!.detail ?? '').toBe('');
    expect(result.passed).toBe(true);
  });

  it('unit is green', { timeout: TIMEOUT }, async () => {
    const result = await unitVerifier().run(ctx);
    expect(result.signals[0]!.detail ?? '').toBe('');
    expect(result.passed).toBe(true);
  });

  it('the cheap composite is green end to end', { timeout: TIMEOUT }, async () => {
    const composite = compositeVerifier('cheap-suite', [
      typecheckVerifier(),
      lintVerifier(),
      unitVerifier(),
    ]);
    const result = await composite.run(ctx);
    expect(result.passed).toBe(true);
    expect(result.signals.map((s) => s.id)).toEqual(['typecheck', 'lint', 'unit']);
  });
});
