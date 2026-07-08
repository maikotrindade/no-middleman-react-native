import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Verifier } from '@no-middleman/core';

export interface CommandVerifierOptions {
  id: string;
  command: string;
  args?: string[];
  gate?: 'hard' | 'advisory';
  cost?: 'cheap' | 'moderate' | 'expensive';
  cwd?: string; // defaults to the loop context cwd
  timeoutMs?: number;
}

export interface CommandOutcome {
  code: number | null;
  output: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) output += `\n[no-middleman] command timed out after ${timeoutMs}ms`;
      resolve({ code: timedOut ? null : code, output });
    });
  });
}

function tail(output: string, lines = 20): string {
  return output.trim().split('\n').slice(-lines).join('\n');
}

// Wraps a shell command as a Verifier: exit code 0 = green. The full output
// is written to an evidence log; failures carry the tail as the signal detail.
export function commandVerifier(options: CommandVerifierOptions): Verifier {
  return {
    id: options.id,
    gate: options.gate ?? 'hard',
    cost: options.cost ?? 'cheap',
    async run(ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      let outcome: CommandOutcome;
      try {
        outcome = await runCommand(options.command, options.args ?? [], cwd, options.timeoutMs);
      } catch (err) {
        outcome = { code: -1, output: err instanceof Error ? err.message : String(err) };
      }
      const passed = outcome.code === 0;
      const logPath = join(ctx.cwd, '.nm/evidence', `${options.id}-iter${ctx.iteration}.log`);
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, outcome.output, 'utf8');
      return {
        passed,
        signals: [
          {
            id: options.id,
            passed,
            detail: passed ? undefined : tail(outcome.output),
          },
        ],
        evidence: { logs: [logPath], artifacts: [] },
      };
    },
  };
}
