#!/bin/bash
# 把云函数侧 analyticsLimits.js（采样上限单一真源）同步到所有会读
# `analytics_daily` / `user_behaviors` 的云函数。
#
# 云函数之间不能跨目录 require，故每个函数各留一份**完全一致**的副本。
# 与 sync-order-summary.sh / sync-source-origin.sh / sync-staff-guard.sh 同一惯例。
#
# 真源：cloudfunctions/getAnalyticsDashboard/analyticsLimits.js
#
# 用法：
#   bash miniprogram/scripts/sync-analytics-limits.sh          # 同步
#   bash miniprogram/scripts/sync-analytics-limits.sh --check  # 只检查（不一致退出 1）
set -e
cd "$(dirname "$0")/.."

SRC="cloudfunctions/getAnalyticsDashboard/analyticsLimits.js"
# 所有读取受管埋点集合（analytics_daily / user_behaviors）做聚合或取样的云函数
DIRS="getAnalyticsDashboard getHotSearchKeywords manageMemberCrm"

CHECK=0
[ "$1" = "--check" ] && CHECK=1
[ -f "$SRC" ] || { echo "✗ 缺少真源 $SRC"; exit 1; }

n=0; drift=""
for d in $DIRS; do
  [ -d "cloudfunctions/$d" ] || { echo "跳过（无此函数）: $d"; continue; }
  dst="cloudfunctions/$d/analyticsLimits.js"
  if [ -f "$dst" ] && cmp -s "$SRC" "$dst"; then continue; fi
  if [ "$CHECK" = "1" ]; then drift="$drift $d"; continue; fi
  cp "$SRC" "$dst"
  n=$((n+1))
  echo "  同步 → $dst"
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ analyticsLimits.js 与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-analytics-limits.sh"
    exit 1
  fi
  echo "✓ analyticsLimits.js 全部副本与真源一致"
  exit 0
fi
echo "analyticsLimits.js 已同步 $n 份"
