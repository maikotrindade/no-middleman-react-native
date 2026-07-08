#!/usr/bin/env node
import { runVerify } from './verify.js';

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'verify':
    process.exit(await runVerify(rest));
  // eslint-disable-next-line no-fallthrough -- process.exit never falls through
  default:
    console.log('no-middleman (nm) — loop verifier CLI');
    console.log('');
    console.log('Usage:');
    console.log('  nm verify [--e2e] [--cwd <dir>]   run the composite verifier (exit 0 = green)');
    process.exit(command === undefined || command === 'help' ? 0 : 1);
}
