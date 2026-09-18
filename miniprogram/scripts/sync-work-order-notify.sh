#!/bin/bash
# 把工单通知两个共享模块同步到全部副本（云函数之间不能跨目录 require）。
#
# - workOrderNotify.js   ：审批人解析 + 类别选择（真源 1 份 + 副本 8 份）
# - workOrderSubscribe.js：模板映射 + 下发 + 留痕（**真源即唯一副本**，无同步目标）
#
# 真源：miniprogram/cloudfunctions/manageApprovals/（workOrderNotify）
#       miniprogram/cloudfunctions/dispatchMessage/（workOrderSubscribe）
#
# 用法：
#   bash miniprogram/scripts/sync-work-order-notify.sh            # 同步
#   bash miniprogram/scripts/sync-work-order-notify.sh --check    # 只检查
#   bash miniprogram/scripts/sync-work-order-notify.sh --selftest # 注入漂移 → 必须检出 → 按字节还原
#
# 2026-09-18（P0-4）：补 --selftest。此前本守卫挂在 check:admin 链上却**没有自检**，
# 而 scripts/run-guards.mjs:126 把「守卫缺 :selftest」计为失败 → CI 的 guards-can-fail
# job 在每个 PR 上恒红，直接挡住 PR 闸门。（AGENTS.md：每条守卫都必须能证明自己会失败。）
set -e

# 自检要递归调用自己，而脚本开头会 cd → 先取绝对路径，否则第二次调用找不到自己
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."

NOTIFY_SRC="cloudfunctions/manageApprovals/workOrderNotify.js"
NOTIFY_DIRS="manageApprovals bindPlatformOrder claimStoreReceipt getStorePointRules grantStorePoints manageInvoiceRequests managerShipOrder refundOrder verifyBooking"
SUB_SRC="cloudfunctions/dispatchMessage/workOrderSubscribe.js"
SUB_DIRS="dispatchMessage"

CHECK=0; SELFTEST=0
[ "$1" = "--check" ] && CHECK=1
[ "$1" = "--selftest" ] && SELFTEST=1
[ -f "$NOTIFY_SRC" ] || { echo "✗ 缺少真源 $NOTIFY_SRC"; exit 1; }
[ -f "$SUB_SRC" ] || { echo "✗ 缺少真源 $SUB_SRC"; exit 1; }

n=0; drift=""
sync_one() {
  local src="$1" dst="$2" label="$3"
  [ -d "$(dirname "$dst")" ] || return
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then return; fi
  if [ "$CHECK" = "1" ]; then drift="$drift $label"; return; fi
  cp "$src" "$dst"; n=$((n+1)); echo "  同步 → $dst"
}

# ── 自检：注入副本漂移 → 必须检出 → 按字节还原 ──────────────────────────────
ST_TMP=""; ST_MANIFEST=""
_restore_all() {
  [ -n "$ST_MANIFEST" ] && [ -f "$ST_MANIFEST" ] || return 0
  while IFS="$(printf '\t')" read -r b t; do
    [ -n "$t" ] && [ -f "$b" ] && cp -p "$b" "$t"
  done < "$ST_MANIFEST"
}
_backup() {
  local t="$1" b
  b="$ST_TMP/$(printf '%s' "$t" | tr '/' '_')"
  cp -p "$t" "$b"
  printf '%s\t%s\n' "$b" "$t" >> "$ST_MANIFEST"
}
run_check() { bash "$SELF" --check >/dev/null 2>&1; }

selftest() {
  local bad=0 target="" d="" probe="" out=""
  # mktemp -d = 唯一临时目录。发版审计 N5 记录过「固定临时目录互删」导致的并发假失败。
  ST_TMP="$(mktemp -d)"
  ST_MANIFEST="$ST_TMP/manifest"; : > "$ST_MANIFEST"
  # 中断也要还原：node 守卫靠顺序执行兜底，这里用 trap（更稳）
  trap '_restore_all; rm -rf "$ST_TMP"' EXIT

  st() { if [ "$1" = "0" ]; then echo "✓ $2"; else echo "✗ $2"; bad=$((bad+1)); fi }

  # ① 基线必须通过
  if run_check; then st 0 "基线：副本与真源一致"; else st 1 "基线：副本与真源一致"; fi

  # ② 找一个**真实副本**（排除真源自己 —— 自比恒真，注进去也检不出）
  for d in $NOTIFY_DIRS; do
    probe="cloudfunctions/$d/workOrderNotify.js"
    if [ "$probe" != "$NOTIFY_SRC" ] && [ -f "$probe" ]; then target="$probe"; break; fi
  done
  if [ -z "$target" ]; then
    st 1 "自检前提：至少存在一个非真源副本"
    echo; echo "自检失败 $bad 项——守卫不可信"; exit 1
  fi

  # ③ 注入「内容漂移」→ 必须检出
  # ⚠️ 变量必须写成 ${target}：紧跟其后的「）」是多字节字符，bash 会把它当成变量名的一部分，
  #    于是 $target） 被解析成未定义变量 + 吞掉半个字符（本轮实测踩到：输出变成 `（��` 且路径为空）。
  _backup "$target"
  printf '\n// dsh-selftest-drift\n' >> "$target"
  if run_check; then
    st 1 "★ 被检出：副本内容漂移（${target}）"
  else st 0 "★ 被检出：副本内容漂移（${target}）"; fi

  # ④ 按字节还原（不是 git checkout）
  _restore_all
  if cmp -s "$ST_TMP/$(printf '%s' "$target" | tr '/' '_')" "$target"; then
    st 0 "★ 按字节还原（不是 git checkout）"
  else st 1 "★ 按字节还原（不是 git checkout）"; fi

  # ⑤ 还原后必须恢复通过
  if run_check; then st 0 "★ 还原后守卫恢复通过"; else st 1 "★ 还原后守卫恢复通过"; fi

  # ⑥ 注入「副本缺失」→ 必须检出
  rm -f "$target"
  if run_check; then
    st 1 "★ 被检出：副本缺失（${target}）"
  else st 0 "★ 被检出：副本缺失（${target}）"; fi
  _restore_all
  if cmp -s "$ST_TMP/$(printf '%s' "$target" | tr '/' '_')" "$target"; then
    st 0 "★ 二次还原字节一致"
  else st 1 "★ 二次还原字节一致"; fi

  # ⑦ 单副本家族必须被如实标注，不许冒充「一致性通过」
  out="$(bash "$SELF" --check 2>&1 || true)"
  if printf '%s' "$out" | grep -q "单副本家族"; then
    st 0 "★ 单副本家族被如实标注（不冒充一致性通过）"
  else st 1 "★ 单副本家族被如实标注（不冒充一致性通过）"; fi

  if [ "$bad" != "0" ]; then echo; echo "自检失败 $bad 项——守卫不可信"; exit 1; fi
  echo; echo "自检通过：2 个回归注入全部被检出，且按字节还原"
}

if [ "$SELFTEST" = "1" ]; then selftest; exit 0; fi

# ── 主流程 ──────────────────────────────────────────────────────────────
# 真源目录自己也在 DIRS 里。`cmp -s src src` 恒真，那不是「副本一致」而是**空转** ——
# 所以把它排除在同步目标之外，并单独计数，好让 --check 如实报告它没有副本可查。
NOTIFY_TARGETS=0
for d in $NOTIFY_DIRS; do
  [ -d "cloudfunctions/$d" ] || continue
  dst="cloudfunctions/$d/workOrderNotify.js"
  [ "$dst" = "$NOTIFY_SRC" ] && continue
  NOTIFY_TARGETS=$((NOTIFY_TARGETS+1))
  sync_one "$NOTIFY_SRC" "$dst" "$d/workOrderNotify"
done

SUB_TARGETS=0
for d in $SUB_DIRS; do
  [ -d "cloudfunctions/$d" ] || continue
  dst="cloudfunctions/$d/workOrderSubscribe.js"
  [ "$dst" = "$SUB_SRC" ] && continue
  SUB_TARGETS=$((SUB_TARGETS+1))
  sync_one "$SUB_SRC" "$dst" "$d/workOrderSubscribe"
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ 工单通知共享模块与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-work-order-notify.sh"
    exit 1
  fi
  if [ "$SUB_TARGETS" = "0" ]; then
    echo "· workOrderSubscribe：单副本家族（真源即唯一副本，无同步目标）——本行**不是**「一致性通过」"
  fi
  echo "✓ workOrderNotify 全部 $NOTIFY_TARGETS 份副本与真源一致"
  exit 0
fi
echo "工单通知共享模块已同步 $n 份"
