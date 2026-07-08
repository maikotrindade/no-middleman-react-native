import { createServer, type Server } from 'node:http';
import { sendDigest, type ReporterOptions, type RunDigest } from './reporter.js';

export interface ReporterServerHandle {
  port: number;
  close(): Promise<void>;
}

// The HTTP-hook target: the plugin's Stop hook POSTs a RunDigest here.
export function startReporterServer(
  options: ReporterOptions & { port?: number },
): Promise<ReporterServerHandle> {
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'POST only' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const digest = JSON.parse(body) as RunDigest;
      const result = await sendDigest(digest, options);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: result.id }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  });
  return new Promise((resolve) => {
    server.listen(options.port ?? 8787, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 8787);
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
