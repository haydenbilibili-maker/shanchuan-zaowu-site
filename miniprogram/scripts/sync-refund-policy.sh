#!/bin/bash
# 把 canonical refundPolicy.js 同步到所有客户端副本。
# 小程序分包之间不能跨包 require，所以每个分包必须各留一份**完全一致**的副本；
# 一旦漏同步，就会出现「同一规则在不同页面表现不同」（曾漏掉退款被拒可重申、
# 孤品售后未披露 30% 扣款）。
set -e
cd "$(dirname "$0")/.."
SRC="subpackages/business/utils/refundPolicy.js"   # canonical（batch2 起实现落在分包）
for f in subpackages/manager/utils/refundPolicy.js subpackages/feature/utils/refundPolicy.js; do
  cp "$SRC" "$f"
done
echo "refundPolicy.js 已同步 3 份客户端副本（服务端 2 份为金额规则专用，不参与同步）"
