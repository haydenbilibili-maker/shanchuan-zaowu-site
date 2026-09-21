#!/bin/bash
# 把 canonical sourceOrigin.js 同步到所有内联过「来源判定」的云函数。
# 云函数之间不能跨目录 require，故每个函数各留一份**完全一致**的副本。
# 与 sync-order-summary.sh（13 份）、staffGuard.js（55 份）同一惯例。
#
# 背景：负向子串判定 `!/wx_client|wx_devtools/i.test(SOURCE)` 对云函数互调
# 继承而来的 `"wx_client,scf"` 判反，导致店员券核销报「积分申请失败/请先登录」。
#
# 用法：
#   bash miniprogram/scripts/sync-source-origin.sh          # 同步
#   bash miniprogram/scripts/sync-source-origin.sh --check  # 只检查（不一致退出 1）
set -e
cd "$(dirname "$0")/.."
SRC="cloudfunctions/grantStorePoints/sourceOrigin.js"
# 所有内联过 isNonClientSource / isClientSource / SOURCE 全等判定的云函数
DIRS="grantStorePoints verifyBooking manageInvoiceRequests refundOrder claimStoreReceipt getStorePointRules managerShipOrder manageGift manageArtisanCommission manageDeposit sendBookingReminder sendCareReminder bindPlatformOrder dispatchMessage sendInAppMessage payCallback claimBirthdayGift sweepExpiredOrders dailyDigest"
CHECK=0
[ "$1" = "--check" ] && CHECK=1

[ -f "$SRC" ] || { echo "✗ 找不到真源 $SRC"; exit 1; }

n=0
drift=""
for d in $DIRS; do
  [ -d "cloudfunctions/$d" ] || { echo "跳过（无此函数）: $d"; continue; }
  dst="cloudfunctions/$d/sourceOrigin.js"
  # 真源自身（d == grantStorePoints）时 src 与 dst 相同，cmp 必然相等 → 自然跳过
  if [ -f "$dst" ] && cmp -s "$SRC" "$dst"; then continue; fi
  if [ "$CHECK" = "1" ]; then
    drift="$drift $d"
    continue
  fi
  cp "$SRC" "$dst"
  n=$((n+1))
  echo "  同步 → $dst"
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ sourceOrigin.js 与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-source-origin.sh"
    exit 1
  fi
  echo "✓ sourceOrigin.js 全部副本与真源一致"

  # 行为断言：防止有人把判定改回「负向正则」或「全等比较」两种历史缺陷形态。
  node -e '
    const mod = require("./cloudfunctions/grantStorePoints/sourceOrigin.js");
    const cases = [
      // [SOURCE, 期望 nonClient, 期望 client, 说明]
      ["",                  true,  false, "定时触发·空串"],
      ["scf",               true,  false, "云函数互调·标准"],
      [",scf",              true,  false, "云函数互调·前导逗号（实测形态）"],
      ["wx_client,scf",     true,  true,  "★事故根因：互调继承客户端标记"],
      ["wx_client",         false, true,  "小程序直调"],
      ["wx_devtools",       false, true,  "开发者工具直调"],
      ["scf,wx_client",     true,  true,  "顺序反转·旧负向判定会误放行"],
      ["wx_cloud",          false, false, "非 scf 平台来源·保守拒绝"]
    ];
    let bad = 0;
    for (const [src, wNC, wC, desc] of cases) {
      const r = mod.classifySource(src);
      if (r.nonClient !== wNC || r.client !== wC) {
        bad++;
        console.error(`  ✗ ${JSON.stringify(src)} → nonClient=${r.nonClient}(期望${wNC}) client=${r.client}(期望${wC})  [${desc}]`);
      }
    }
    if (bad) {
      console.error(`✗ sourceOrigin 行为断言失败 ${bad}/${cases.length} 例——判定被改回缺陷形态？`);
      process.exit(1);
    }
    console.log(`✓ sourceOrigin 行为断言通过（${cases.length}/${cases.length}，含合并串回归用例）`);
  '
  exit 0
fi
echo "sourceOrigin.js 已同步 $n 份"
