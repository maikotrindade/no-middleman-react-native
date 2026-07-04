import { describe, expect, it } from 'vitest';
import { renderDigest, sendDigest } from '../src/reporter.js';
import { startReporterServer } from '../src/server.js';

function fakeFetch(captured: { url?: string; init?: RequestInit }, ok = true) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(ok ? JSON.stringify({ id: 'email-123' }) : 'nope', {
      status: ok ? 200 : 422,
    });
  }) as typeof fetch;
}

describe('renderDigest', () => {
  it('renders subject and body from a full digest', () => {
    const { subject, html } = renderDigest({
      loopId: 'fix-tip',
      outcome: 'succeeded',
      iterations: 3,
      tokensSpent: 1200,
      prUrl: 'https://github.com/x/y/pull/1',
      flaky: ['e2e:tip flow'],
    });
    expect(subject).toBe('[no-middleman] fix-tip: succeeded after 3 iteration(s)');
    expect(html).toContain('pull/1');
    expect(html).toContain('Flaky flows');
  });

  it('tolerates an empty digest and escapes HTML', () => {
    const { subject } = renderDigest({});
    expect(subject).toBe('[no-middleman] loop: finished');
    const { html } = renderDigest({ workingState: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sendDigest', () => {
  it('POSTs to resend with auth header and payload', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const result = await sendDigest(
      { loopId: 'l1', outcome: 'succeeded' },
      { apiKey: 'rk_test', from: 'loops@nm.dev', to: 'dev@example.com', fetchImpl: fakeFetch(captured) },
    );
    expect(result.id).toBe('email-123');
    expect(captured.url).toBe('https://api.resend.com/emails');
    expect((captured.init!.headers as Record<string, string>).Authorization).toBe('Bearer rk_test');
    const body = JSON.parse(String(captured.init!.body));
    expect(body.to).toBe('dev@example.com');
    expect(body.subject).toContain('succeeded');
  });

  it('throws when resend rejects', async () => {
    await expect(
      sendDigest({}, { apiKey: 'rk', from: 'a@b.c', to: 'd@e.f', fetchImpl: fakeFetch({}, false) }),
    ).rejects.toThrow(/resend rejected/);
  });
});

describe('startReporterServer', () => {
  it('accepts a POSTed digest and reports the email id', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const server = await startReporterServer({
      apiKey: 'rk',
      from: 'a@b.c',
      to: 'd@e.f',
      port: 0,
      fetchImpl: fakeFetch(captured),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: 'POST',
        body: JSON.stringify({ loopId: 'l1', outcome: 'budgetExceeded' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, id: 'email-123' });

      const bad = await fetch(`http://127.0.0.1:${server.port}/`, { method: 'GET' });
      expect(bad.status).toBe(405);
    } finally {
      await server.close();
    }
  });
});
