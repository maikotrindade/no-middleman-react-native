import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LoopEvent } from './machine.js';
import type { VerifierResult } from './types.js';

// One record per state transition. Append-only: the journal is the audit
// trail and the resume source.
export interface JournalRecord {
  ts: string;
  loopId: string;
  iteration: number;
  state: string; // machine state AFTER the event was processed
  event: LoopEvent;
  tokensSpent: number;
  verifier?: VerifierResult;
  diffHash?: string;
  worktree?: string;
}

export function appendRecord(path: string, record: JournalRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
}

export function readJournal(path: string): JournalRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}
