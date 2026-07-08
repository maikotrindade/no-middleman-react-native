#!/usr/bin/env bash
# Append one lineage record per file edit (PostToolUse). External state only:
# nothing about the loop lives solely in agent context.
set -euo pipefail
input=$(cat)
dir="${CLAUDE_PROJECT_DIR:-$PWD}/.nm"
mkdir -p "$dir"
node -e '
  const input = JSON.parse(process.argv[1]);
  const record = {
    ts: new Date().toISOString(),
    event: "tool",
    tool: input.tool_name ?? "unknown",
    file: input.tool_input?.file_path ?? null,
  };
  require("fs").appendFileSync(process.argv[2], JSON.stringify(record) + "\n");
' "$input" "$dir/lineage.jsonl"
