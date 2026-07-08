#!/usr/bin/env bash
# Stop hook: POST a RunDigest to the reporter (Resend digest). No-op unless
# NM_REPORTER_URL is set; never fails the session.
set -uo pipefail
cat > /dev/null # consume hook payload
[ -z "${NM_REPORTER_URL:-}" ] && exit 0
dir="${CLAUDE_PROJECT_DIR:-$PWD}/.nm"
node -e '
  const fs = require("fs");
  const dir = process.argv[1];
  const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return undefined; } };
  const ws = read(dir + "/working-state.md");
  const lineage = (read(dir + "/lineage.jsonl") ?? "")
    .trim().split("\n").filter(Boolean).slice(-20)
    .map((l) => { try { return JSON.parse(l); } catch { return l; } });
  process.stdout.write(JSON.stringify({
    loopId: require("path").basename(process.cwd()),
    workingState: ws,
    lineageTail: lineage,
  }));
' "$dir" | curl -sf -X POST -H 'Content-Type: application/json' --data-binary @- "$NM_REPORTER_URL" > /dev/null || true
exit 0
