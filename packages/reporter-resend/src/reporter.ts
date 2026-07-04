// Everything optional: the Stop hook sends whatever it could scrape from
// .nm/ working state, and a partial digest is better than none.
export interface RunDigest {
  loopId?: string;
  outcome?: string;
  iterations?: number;
  tokensSpent?: number;
  prUrl?: string;
  flaky?: string[];
  workingState?: string; // raw markdown
  lineageTail?: unknown[];
}

export interface ReporterOptions {
  apiKey: string;
  from: string;
  to: string | string[];
  fetchImpl?: typeof fetch;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderDigest(digest: RunDigest): { subject: string; html: string } {
  const subject = `[no-middleman] ${digest.loopId ?? 'loop'}: ${digest.outcome ?? 'finished'}${
    digest.iterations !== undefined ? ` after ${digest.iterations} iteration(s)` : ''
  }`;
  const rows: string[] = [];
  if (digest.outcome) rows.push(`<li><b>Outcome:</b> ${escapeHtml(digest.outcome)}</li>`);
  if (digest.iterations !== undefined) rows.push(`<li><b>Iterations:</b> ${digest.iterations}</li>`);
  if (digest.tokensSpent !== undefined) rows.push(`<li><b>Tokens spent:</b> ${digest.tokensSpent}</li>`);
  if (digest.prUrl) rows.push(`<li><b>PR:</b> <a href="${escapeHtml(digest.prUrl)}">${escapeHtml(digest.prUrl)}</a></li>`);
  if (digest.flaky?.length)
    rows.push(`<li><b>Flaky flows:</b> ${digest.flaky.map(escapeHtml).join(', ')}</li>`);
  const workingState = digest.workingState
    ? `<h3>Working state</h3><pre>${escapeHtml(digest.workingState)}</pre>`
    : '';
  const lineage = digest.lineageTail?.length
    ? `<h3>Lineage tail</h3><pre>${escapeHtml(
        digest.lineageTail.map((r) => JSON.stringify(r)).join('\n'),
      )}</pre>`
    : '';
  const html = `<h2>${escapeHtml(subject)}</h2><ul>${rows.join('')}</ul>${workingState}${lineage}`;
  return { subject, html };
}

export async function sendDigest(
  digest: RunDigest,
  options: ReporterOptions,
): Promise<{ id?: string }> {
  const { subject, html } = renderDigest(digest);
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: options.from, to: options.to, subject, html }),
  });
  if (!response.ok) {
    throw new Error(`resend rejected digest: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { id?: string };
}
