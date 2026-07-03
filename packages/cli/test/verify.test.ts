import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVerify } from '../src/verify.js';

const appDir = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../examples/reference-app',
);

describe('nm verify', () => {
  it('exits 0 on the reference app cheap suite (baseline green)', { timeout: 180_000 }, async () => {
    expect(await runVerify(['--cwd', appDir])).toBe(0);
  });

  it('exits 1 when a hard verifier fails', { timeout: 180_000 }, async () => {
    // Point at a directory with no tsconfig/jest: typecheck fails hard.
    expect(await runVerify(['--cwd', fileURLToPath(new URL('.', import.meta.url))])).toBe(1);
  });
});
