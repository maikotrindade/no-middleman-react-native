#!/usr/bin/env node
// M3 acceptance: prove the Detox oracle is trustworthy by driving the
// reference app red -> green with scripted edits (no agents involved).
//
//   1. Run the oracle against the planted bug        -> must be RED
//   2. Apply the known-correct fix (use lib/tip.ts)  -> must be GREEN,
//      and the dev-client build must be a cache hit (JS-only reload).
//   3. Restore the planted bug (git checkout).
//
// Requires: Android SDK + AVD (see .detoxrc.js). Run via `pnpm prove:oracle`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { detoxVerifier } from '../packages/verifier-detox/dist/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appDir = join(repoRoot, 'examples/reference-app');
const screenPath = join(appDir, 'src/screens/TipCalculatorScreen.tsx');

const PLANTED = 'setTotal(billValue + billValue * percentValue);';
const FIXED = 'setTotal(calculateTotal(billValue, percentValue));';
const RN_IMPORT = "import { Button, StyleSheet, Text, TextInput, View } from 'react-native';";

const verifier = detoxVerifier({
  configuration: 'android.emu.debug',
  avdName: process.env.NM_AVD ?? 'nm_test',
});
const ctx = { cwd: appDir, iteration: 0, spec: {} };

function assert(condition, message) {
  if (!condition) {
    console.error(`\n✗ ORACLE PROOF FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

const original = readFileSync(screenPath, 'utf8');
assert(original.includes(PLANTED), 'planted bug is present before the proof');

try {
  console.log('\n=== Run 1: planted bug, expecting RED ===');
  const red = await verifier.run(ctx);
  console.log(JSON.stringify(red.signals, null, 2));
  assert(red.passed === false, 'oracle is RED against the planted bug');
  const redFlow = red.signals.find((s) => s.id.includes('correct total'));
  assert(redFlow && !redFlow.passed, 'the tip-total flow specifically is the red one');
  const openFlow = red.signals.find((s) => s.id.includes('opens from the home screen'));
  assert(openFlow?.passed === true, 'the unrelated navigation flow stays green');

  console.log('\n=== Applying scripted fix (use src/lib/tip.ts) ===');
  writeFileSync(
    screenPath,
    original
      .replace(RN_IMPORT, `${RN_IMPORT}\nimport { calculateTotal } from '../lib/tip';`)
      .replace(PLANTED, FIXED),
  );

  console.log('\n=== Run 2: fixed, expecting GREEN via JS-only reload ===');
  const green = await verifier.run(ctx);
  console.log(JSON.stringify(green.signals, null, 2));
  assert(green.passed === true, 'oracle is GREEN after the fix');
  const build = green.signals.find((s) => s.id === 'e2e:dev-client-build');
  assert(build?.detail === 'cache-hit', 'no native rebuild happened (build-once/reload-many)');

  console.log('\n=== ORACLE PROOF PASSED: red -> green, build cached, flake vote active ===');
} finally {
  execFileSync('git', ['checkout', '--', screenPath], { cwd: repoRoot });
  console.log('(planted bug restored)');
}
