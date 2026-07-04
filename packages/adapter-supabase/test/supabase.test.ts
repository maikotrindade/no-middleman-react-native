import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalRecord } from '@no-middleman/core';
import { describe, expect, it } from 'vitest';
import { createSupabaseLineageSink, mirrorJournal } from '../src/index.js';

const record = (iteration: number): JournalRecord => ({
  ts: `2026-07-04T00:0${iteration}:00.000Z`,
  loopId: 'loop-1',
  iteration,
  state: 'verifying',
  event: { type: 'ITERATED', diffHash: `d${iteration}`, tokensSpent: 5, elapsedMs: 10 },
  tokensSpent: 5 * iteration,
});

interface Captured {
  url: string;
  init?: RequestInit;
}

function fakeFetch(calls: Captured[], responseBody: unknown = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responseBody), { status: 200 });
  }) as typeof fetch;
}

describe('createSupabaseLineageSink', () => {
  it('appends records via PostgREST with auth headers', async () => {
    const calls: Captured[] = [];
    const sink = createSupabaseLineageSink({
      url: 'https://proj.supabase.co/',
      serviceKey: 'sk',
      fetchImpl: fakeFetch(calls),
    });
    await sink.append(record(1));

    expect(calls[0]!.url).toBe('https://proj.supabase.co/rest/v1/nm_lineage');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.apikey).toBe('sk');
    expect(headers.Authorization).toBe('Bearer sk');
    const body = JSON.parse(String(calls[0]!.init!.body)) as [{ loop_id: string; record: JournalRecord }];
    expect(body[0].loop_id).toBe('loop-1');
    expect(body[0].record.iteration).toBe(1);
  });

  it('reads back records filtered by loop id', async () => {
    const calls: Captured[] = [];
    const sink = createSupabaseLineageSink({
      url: 'https://proj.supabase.co',
      serviceKey: 'sk',
      table: 'custom_lineage',
      fetchImpl: fakeFetch(calls, [{ record: record(1) }, { record: record(2) }]),
    });
    const records = await sink.readAll('loop-1');

    expect(calls[0]!.url).toBe(
      'https://proj.supabase.co/rest/v1/custom_lineage?loop_id=eq.loop-1&order=ts.asc&select=record',
    );
    expect(records.map((r) => r.iteration)).toEqual([1, 2]);
  });

  it('throws on a rejected append', async () => {
    const sink = createSupabaseLineageSink({
      url: 'https://proj.supabase.co',
      serviceKey: 'sk',
      fetchImpl: (async () => new Response('denied', { status: 401 })) as typeof fetch,
    });
    await expect(sink.append(record(1))).rejects.toThrow(/append failed: 401/);
  });
});

describe('mirrorJournal', () => {
  it('pushes every JSONL record and returns the count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nm-supabase-'));
    mkdirSync(join(dir, '.nm'), { recursive: true });
    const journalPath = join(dir, '.nm/lineage.jsonl');
    writeFileSync(journalPath, [record(1), record(2)].map((r) => JSON.stringify(r)).join('\n') + '\n');

    const calls: Captured[] = [];
    const sink = createSupabaseLineageSink({
      url: 'https://proj.supabase.co',
      serviceKey: 'sk',
      fetchImpl: fakeFetch(calls),
    });
    expect(await mirrorJournal(journalPath, sink)).toBe(2);
    expect(calls).toHaveLength(2);
  });
});
