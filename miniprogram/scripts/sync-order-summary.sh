#!/bin/bash
# 把 canonical orderSummary.js 同步到所有会渲染订单站内信的云函数。
# 云函数之间不能跨目录 require，故每个函数各留一份**完全一致**的副本。
#
# 用法：
#   bash miniprogram/scripts/sync-order-summary.sh            # 同步
#   bash miniprogram/scripts/sync-order-summary.sh --check    # 只检查（含行为断言）
#   bash miniprogram/scripts/sync-order-summary.sh --selftest # 注入回归 → 必须被检出 → 还原
#
# 行为断言（assert-order-summary.cjs）守护需求 10 定的**商品展示粒度**：
# 名称 + 图片 + 规格。一旦某一侧把字段映射改坏，13 份副本会各自渲染出不同口径的信。
set -e
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SELF_DIR/$(basename "$0")"
ASSERT="$SELF_DIR/assert-order-summary.cjs"
cd "$SELF_DIR/.."

SRC="cloudfunctions/dispatchMessage/orderSummary.js"
# 仅同步到**实际渲染订单站内信**的云函数（getUserMessages 只做列表映射，不需要本模块）
DIRS="dispatchMessage makeOrder cancelOrder refundOrder sweepExpiredOrders payCallback confirmPayment managerShipOrder confirmOrderReceipt createBooking manageGift submitSupportTicket submitCustomInquiry"

CHECK=0
[ "$1" = "--check" ] && CHECK=1
[ -f "$SRC" ] || { echo "✗ 缺少真源 $SRC"; exit 1; }
[ -f "$ASSERT" ] || { echo "✗ 缺少断言脚本 $ASSERT"; exit 1; }

# --selftest：注入回归 → 必须被检出 → 还原源文件（证明守卫真的会失败）
if [ "$1" = "--selftest" ]; then
  BAK="$(mktemp)"
  cp "$SRC" "$BAK"
  trap 'cp "$BAK" "$SRC"; rm -f "$BAK"' EXIT
  bad=0
  # 关键：断言直接跑在**注入后的真源**上。若改跑整条 --check，
  # 会先被「副本漂移」拦下 → 看起来检出了，其实行为断言根本没执行。
  probe() {
    local label="$1" from="$2" to="$3"
    cp "$BAK" "$SRC"
    if ! grep -qF "$from" "$SRC"; then
      echo "  ✗ 注入锚点缺失: $label"; bad=$((bad + 1)); return
    fi
    python3 - "$SRC" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
    local out
    if out="$(node "$ASSERT" "$SELF_DIR/../$SRC" 2>&1)"; then
      echo "  ✗ 注入 $label 未被检出（断言不会失败 = 守卫无效）"; bad=$((bad + 1))
    elif ! grep -q "行为断言失败" <<<"$out"; then
      echo "  ✗ 注入 $label 失败原因不对（不是被行为断言抓住）：$out"; bad=$((bad + 1))
    else
      echo "  ✓ 注入 $label 被行为断言检出"
    fi
  }
  # 1) 丢掉图片 → 「名称+图片+规格」粒度被破坏
  probe "drop-image" "      image: image.slice(0, 512)," "      image: '',"
  # 2) 丢掉规格
  probe "drop-sku" "      skuLabel: skuLabel.slice(0, 40)," "      skuLabel: '',"
  # 3) 内部字段外泄（成本与内部枚举码跟着信一起发出去）
  probe "leak-internal" "      count: Math.max(1, parseInt(p.count, 10) || 1)" "      count: Math.max(1, parseInt(p.count, 10) || 1), price: item.price"
  # 4) 包装图片：未传时不再返回空数组（前端会多渲染一个空壳区块 = 破坏「非必须」）
  probe "photos-required" "  const list = Array.isArray(raw) ? raw : []" "  const list = Array.isArray(raw) ? raw : ['cloud://phantom.png']"
  # 5) 包装图片：不再筛「可渲染地址」→ 本机临时路径落库，别的设备全是破图（静默坏图）
  probe "photos-keep-local" "    if (!isRenderablePhotoUrl(url)) continue" "    if (false) continue"
  # 6) 包装图片：不再去重 → 同一张图被渲染多次
  probe "photos-no-dedupe" "    if (out.indexOf(url) !== -1) continue" "    if (false) continue"

  cp "$BAK" "$SRC"
  if ! node "$ASSERT" "$SELF_DIR/../$SRC" >/dev/null 2>&1; then
    echo "  ✗ 未注入时本应通过，实际失败"; bad=$((bad + 1))
  else
    echo "  ✓ 未注入时通过（无假阳性）"
  fi
  if [ "$bad" != "0" ]; then echo "✗ selftest 失败 $bad 项"; exit 1; fi
  echo "✓ selftest 通过：6 个回归注入全部被行为断言检出，且无假阳性"
  exit 0
fi

n=0; drift=""
for d in $DIRS; do
  [ -d "cloudfunctions/$d" ] || { echo "跳过（无此函数）: $d"; continue; }
  dst="cloudfunctions/$d/orderSummary.js"
  # 源与目标可能相同（canonical 就在 dispatchMessage），cmp 后按需复制
  if [ -f "$dst" ] && cmp -s "$SRC" "$dst"; then continue; fi
  if [ "$CHECK" = "1" ]; then drift="$drift $d"; continue; fi
  cp "$SRC" "$dst"
  n=$((n+1))
done

if [ "$CHECK" = "1" ]; then
  if [ -n "$drift" ]; then
    echo "✗ orderSummary.js 与真源不一致：$drift"
    echo "  请运行：bash miniprogram/scripts/sync-order-summary.sh"
    exit 1
  fi
  node "$ASSERT" "$SELF_DIR/../$SRC"
  echo "✓ orderSummary.js 全部副本与真源一致"
  exit 0
fi
echo "orderSummary.js 已同步 $n 份"
