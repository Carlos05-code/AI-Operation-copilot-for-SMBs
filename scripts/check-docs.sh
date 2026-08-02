#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Validate the documentation layer: internal markdown links.
# Runs locally and in CI (docs workflow).
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

error=0

for file in "${REPO_ROOT}"/docs/**/*.md "${REPO_ROOT}"/docs/*.md "${REPO_ROOT}"/*.md; do
  [[ -f "$file" ]] || continue
  dir="$(dirname "$file")"
  while read -r target; do
    [[ -z "$target" ]] && continue
    clean="${target%%#*}"
    resolved="${dir}/${clean}"
    if [[ ! -e "$resolved" ]]; then
      echo "MISSING: ${file##$REPO_ROOT/} -> ${clean}"
      error=1
    fi
  done < <(grep -oE '\]\(\.\.[^\\)]*\)' "$file" | sed 's/^](//; s/)$//' || true)
done

if [[ "$error" != 0 ]]; then
  echo "Internal link check FAILED."
  exit 1
fi

echo "[ok] Internal links valid."
echo "Diagrams in docs: $(grep -rlE '```mermaid|```flowchart' "$REPO_ROOT/docs" | wc -l) files"