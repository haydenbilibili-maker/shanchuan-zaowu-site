#!/bin/bash
# 把 canonical orderSummary.js 同步到所有会渲染订单站内信的云函数。
# 云函数之间不能跨目录 require，故每个函数各留一份**完全一致**的副本。
set -e
cd "$(dirname "$0")/.."
SRC="cloudfunctions/dispatchMessage/orderSummary.js"
DIRS="dispatchMessage makeOrder cancelOrder refundOrder sweepExpiredOrders payCallback confirmPayment managerShipOrder confirmOrderReceipt createBooking manageGift submitSupportTicket submitCustomInquiry getUserMessages"
n=0
for d in $DIRS; do
  [ -d "cloudfunctions/$d" ] || { echo "跳过（无此函数）: $d"; continue; }
  dst="cloudfunctions/$d/orderSummary.js"
  # 源与目标可能相同（canonical 就在 dispatchMessage），cmp 后按需复制
  if [ -f "$dst" ] && cmp -s "$SRC" "$dst"; then continue; fi
  cp "$SRC" "$dst"
  n=$((n+1))
done
echo "orderSummary.js 已同步 $n 份"
