#!/bin/bash
# 把工单通知两个共享模块同步到全部副本（云函数之间不能跨目录 require）。
#
# - workOrderNotify.js   ：审批人解析 + 类别选择（approvalBridge 同目录，9 份）
# - workOrderSubscribe.js：模板映射 + 下发 + 留痕（仅 dispatchMessage 调用，1 份）
#
# 真源：miniprogram/cloudfunctions/manageApprovals/（workOrderNotify）
#       miniprogram/cloudfunctions/dispatchMessage/（workOrderSubscribe）
#
# 用法：
#   bash miniprogram/scripts/sync-work-order-notify.sh          # 同步
#   bash miniprogram/scripts/sync-work-order-notify.sh --check  # 只检查
set -e
cd "$(dirname "$0")/.."

NOTIFY_SRC="cloudfunctions/manageApprovals/workOrderNotify.js"
NOTIFY_DIRS="manageApprovals bindPlatformOrder claimStoreReceipt getStorePointRules grantStorePoints manageInvoiceRequests managerShipOrder refundOrder verifyBooking"
SUB_SRC="cloudfunctions/dispatchMessage/workOrderSubscribe.js"
SUB_DIRS="dispatchMessage"

CHECK=0
[ "$1" = "--check" ] && CHECK=1
[ -f "$NOTIFY_SRC" ] || { echo "✗ 缺少真源 $NOTIFY_SRC"; exit 1; }
[ -f "$SUB_SRC" ] || { echo "✗ 缺少真源 $SUB_SRC"; exit 1; }

n=0; drift=""
sync_one() {
  local src="$1" dst="$2" label="$3"
  if [ ! -d "$(dirname "$dst")" ]; then return; fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then return; fi
  if [ "$CHECK" = "1" ]; then drift="$drift $label"; return; fi
  cp "$src" "$dst"; n=$((n+1)); echo "  同步 → $dst"
}
for d in $NOTIFY_DIRS; do
  sync_one "$NOTIFY_SRC" "cloudfunctions/$d/workOrderNotify.js" "$d/workOrderNotify"
done
for d in $SUB_DIRS; do
  sync_one "$SUB_SRC" "cloudfunctions/$d/workOrderSubscribe.js" "$d/workOrderSubscribe"
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ 工单通知共享模块与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-work-order-notify.sh"
    exit 1
  fi
  echo "✓ 工单通知共享模块全部副本与真源一致"
  exit 0
fi
echo "工单通知共享模块已同步 $n 份"
