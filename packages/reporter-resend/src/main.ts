#!/usr/bin/env node
import { startReporterServer } from './server.js';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.NM_DIGEST_FROM;
const to = process.env.NM_DIGEST_TO;
if (!apiKey || !from || !to) {
  console.error('nm-reporter requires RESEND_API_KEY, NM_DIGEST_FROM, NM_DIGEST_TO');
  process.exit(1);
}
const handle = await startReporterServer({
  apiKey,
  from,
  to: to.includes(',') ? to.split(',').map((s) => s.trim()) : to,
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
});
console.log(`nm-reporter listening on :${handle.port} (POST a RunDigest to send an email)`);
