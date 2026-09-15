#!/usr/bin/env bash
# 将权威 staffGuard / approvalRules / approvalBridge 同步到各云函数副本目录
# 权威源：manageStaff/staffGuard.js、manageApprovals/approvalRules.js + approvalBridge.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD_SRC="$ROOT/cloudfunctions/manageStaff/staffGuard.js"
RULES_SRC="$ROOT/cloudfunctions/manageApprovals/approvalRules.js"
BRIDGE_SRC="$ROOT/cloudfunctions/manageApprovals/approvalBridge.js"

if [[ ! -f "$GUARD_SRC" ]]; then
  echo "missing $GUARD_SRC" >&2
  exit 1
fi

copied_guard=0
copied_rules=0
copied_bridge=0

while IFS= read -r -d '' f; do
  dir="$(dirname "$f")"
  if [[ "$f" != "$GUARD_SRC" ]]; then
    cp "$GUARD_SRC" "$f"
    copied_guard=$((copied_guard + 1))
  fi
  if [[ -f "$RULES_SRC" && -f "$dir/approvalRules.js" && "$dir/approvalRules.js" != "$RULES_SRC" ]]; then
    cp "$RULES_SRC" "$dir/approvalRules.js"
    copied_rules=$((copied_rules + 1))
  fi
  if [[ -f "$BRIDGE_SRC" && -f "$dir/approvalBridge.js" && "$dir/approvalBridge.js" != "$BRIDGE_SRC" ]]; then
    cp "$BRIDGE_SRC" "$dir/approvalBridge.js"
    copied_bridge=$((copied_bridge + 1))
  fi
done < <(find "$ROOT/cloudfunctions" -name staffGuard.js -print0)

echo "synced staffGuard -> $copied_guard copies"
echo "synced approvalRules -> $copied_rules copies"
echo "synced approvalBridge -> $copied_bridge copies"

# 一致性校验
md5_list=$(find "$ROOT/cloudfunctions" -name staffGuard.js -exec md5 -q {} \; | sort -u | wc -l | tr -d ' ')
if [[ "$md5_list" != "1" ]]; then
  echo "WARN: staffGuard.md5 not unique ($md5_list variants)" >&2
  exit 2
fi
echo "staffGuard MD5 unique: OK"
