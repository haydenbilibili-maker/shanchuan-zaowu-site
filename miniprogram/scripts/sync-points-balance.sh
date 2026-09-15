#!/bin/bash
# 把 canonical pointsBalance.js 同步到所有副本（口径必须完全一致）
set -e
cd "$(dirname "$0")/.."
SRC="cloudfunctions/getPointRecords/pointsBalance.js"
for fn in getPointRecords grantStorePoints exchangeCoupon bindPlatformOrder claimStoreReceipt manageMemberCrm; do
  cp "$SRC" "cloudfunctions/$fn/pointsBalance.js"
done
echo "pointsBalance.js 已同步 6 份"
