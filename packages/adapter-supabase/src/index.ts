import { readJournal, type JournalRecord } from '@no-middleman/core';

// Deliberately SDK-free: talks to Supabase's PostgREST endpoint with fetch,
// so the adapter adds zero dependencies. Expected table (default `nm_lineage`):
//   loop_id text, ts timestamptz, state text, record jsonb
export interface SupabaseLineageOptions {
  url: string; // https://<project>.supabase.co
  serviceKey: string;
  table?: string;
  fetchImpl?: typeof fetch;
}

export interface SupabaseLineageSink {
  append(record: JournalRecord): Promise<void>;
  readAll(loopId: string): Promise<JournalRecord[]>;
}

export function createSupabaseLineageSink(options: SupabaseLineageOptions): SupabaseLineageSink {
  const table = options.table ?? 'nm_lineage';
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${options.url.replace(/\/$/, '')}/rest/v1/${table}`;
  const headers = {
    apikey: options.serviceKey,
    Authorization: `Bearer ${options.serviceKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async append(record) {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify([
          { loop_id: record.loopId, ts: record.ts, state: record.state, record },
        ]),
      });
      if (!response.ok) {
        throw new Error(`supabase lineage append failed: ${response.status} ${await response.text()}`);
      }
    },
    async readAll(loopId) {
      const response = await doFetch(
        `${endpoint}?loop_id=eq.${encodeURIComponent(loopId)}&order=ts.asc&select=record`,
        { headers },
      );
      if (!response.ok) {
        throw new Error(`supabase lineage read failed: ${response.status} ${await response.text()}`);
      }
      const rows = (await response.json()) as { record: JournalRecord }[];
      return rows.map((row) => row.record);
    },
  };
}

// One-shot sync of an existing JSONL journal into Supabase — for backfilling
// or end-of-run archival when live mirroring wasn't enabled.
export async function mirrorJournal(
  journalPath: string,
  sink: SupabaseLineageSink,
): Promise<number> {
  const records = readJournal(journalPath);
  for (const record of records) {
    await sink.append(record);
  }
  return records.length;
}
