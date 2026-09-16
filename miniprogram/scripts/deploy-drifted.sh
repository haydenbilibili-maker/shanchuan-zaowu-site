#!/usr/bin/env bash
# 只部署「线上与仓库不一致」的云函数。
#
# 为什么需要：仓库已有 `scripts/check-cloud-functions-sync.cjs`（线上 vs 仓库全量比对），
# 但部署侧只有「部署单个」与「部署全部」两种脚本 —— 结果历史上一度出现
# **129 个云函数里 30 个跑的是旧代码**（改完只部署自己改的那个，从上没做过全量比对）。
# 本脚本把比对结果直接当作部署清单，两者永远同源。
#
# 前置：`tcb` CLI 已登录（`tcb fn list -e <env>` 能列出函数）。
# 注意：本脚本从 `miniprogram/` 目录调用 tcb，以便它读取 `miniprogram/cloudbaserc.json`
#       （其中 functionRoot=./cloudfunctions，且**没有** envVariables → 不会覆盖线上环境变量）。
#
# 用法：
#   bash miniprogram/scripts/deploy-drifted.sh              # 只读比对后、逐个部署
#   bash miniprogram/scripts/deploy-drifted.sh --dry-run    # 只打印清单
#   bash miniprogram/scripts/deploy-drifted.sh a b c        # 只部署指定函数（仍会先比对）
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"
TMP_DIR="$ROOT/miniprogram/scripts/.tmp"
mkdir -p "$TMP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$TMP_DIR/deploy-drifted-$STAMP.log"
OK_LOG="$TMP_DIR/deploy-drifted-ok-$STAMP.txt"
FAIL_LOG="$TMP_DIR/deploy-drifted-fail-$STAMP.txt"
: > "$OK_LOG"; : > "$FAIL_LOG"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
shift || true

echo "== 1/3 比对线上与仓库（只读）==" | tee "$LOG"
node "$ROOT/scripts/check-cloud-functions-sync.cjs" --json > "$TMP_DIR/fn-drift.json" 2>>"$LOG" || true
ALL_DRIFT="$(node -e '
  const fs=require("fs");
  try{
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write((j.inconsistent||[]).map(r=>r.name).join(" "));
  }catch(e){ process.stdout.write(""); }
' "$TMP_DIR/fn-drift.json")"

if [ -n "${1:-}" ]; then
  TARGETS="$*"
else
  TARGETS="$ALL_DRIFT"
fi

if [ -z "$TARGETS" ]; then
  echo "✓ 线上与仓库一致，无需部署" | tee -a "$LOG"
  exit 0
fi

COUNT="$(echo $TARGETS | wc -w | tr -d ' ')"
echo "漂移函数 ${COUNT} 个：$TARGETS" | tee -a "$LOG"
if [ "$DRY" = "1" ]; then
  echo "（--dry-run，未部署）" | tee -a "$LOG"
  exit 0
fi

echo "== 2/3 逐个部署（env=${ENV_ID}）==" | tee -a "$LOG"
rc_all=0
for name in $TARGETS; do
  dir="$ROOT/miniprogram/cloudfunctions/$name"
  if [ ! -f "$dir/index.js" ] && [ ! -f "$dir/package.json" ]; then
    echo "✖ 跳过：$name 目录不存在" | tee -a "$LOG"
    echo "$name" >> "$FAIL_LOG"; rc_all=1; continue
  fi
  echo "→ 部署 $name" | tee -a "$LOG"
  out="$(cd "$ROOT/miniprogram" && tcb fn deploy "$name" -e "$ENV_ID" --force 2>&1)"
  rc=$?
  echo "$out" >> "$LOG"
  if [ $rc -ne 0 ] || ! echo "$out" | grep -q "deployed successfully"; then
    echo "✖ $name 部署失败（rc=${rc}）" | tee -a "$LOG"
    echo "$name" >> "$FAIL_LOG"; rc_all=1
  else
    echo "✔ $name" | tee -a "$LOG"
    echo "$name" >> "$OK_LOG"
  fi
done

echo "== 3/3 复比（只读，仅本次目标）==" | tee -a "$LOG"
# 必须带上 ${TARGETS}：不带函数名时它会下载全部 ~130 个函数做比对，
# 单函数部署会被这一步拖到十几分钟（实测一次 manageWishWall 部署因此超时被杀）。
node "$ROOT/scripts/check-cloud-functions-sync.cjs" $TARGETS --json > "$TMP_DIR/fn-drift-after.json" 2>>"$LOG" || true
AFTER="$(node -e '
  const fs=require("fs");
  try{
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write((j.inconsistent||[]).map(r=>r.name).join(" "));
  }catch(e){ process.stdout.write("(读取失败)"); }
' "$TMP_DIR/fn-drift-after.json")"
echo "成功 $([ -s "$OK_LOG" ] && wc -l < "$OK_LOG" | tr -d ' ' || echo 0) / 失败 $([ -s "$FAIL_LOG" ] && wc -l < "$FAIL_LOG" | tr -d ' ' || echo 0)" | tee -a "$LOG"
if [ -n "$AFTER" ]; then
  echo "✗ 仍不一致：$AFTER" | tee -a "$LOG"
  rc_all=1
else
  echo "✓ 复比通过：线上与仓库已一致" | tee -a "$LOG"
fi
echo "日志：$LOG"
exit $rc_all
