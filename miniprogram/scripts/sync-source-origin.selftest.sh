#!/bin/bash
# sourceOrigin 守卫自检：注入漂移 → 必须被检出 → 还原。
# 满足 AGENTS.md「每条守卫都必须能证明自己会失败」。
set -e
cd "$(dirname "$0")/.."   # miniprogram/
GUARD="scripts/sync-source-origin.sh"
VICTIM="cloudfunctions/verifyBooking/sourceOrigin.js"
BACKUP="$(mktemp)"
cp "$VICTIM" "$BACKUP"
restore() { cp "$BACKUP" "$VICTIM"; rm -f "$BACKUP"; }
trap restore EXIT

fail=0

# 1) 干净状态必须通过
if bash "$GUARD" --check >/dev/null 2>&1; then
  echo "✓ 干净状态通过"
else
  echo "✗ 干净状态竟然失败——守卫不可信"; fail=1
fi

# 2) 注入漂移（把真源里的 scf 判定改坏）必须被检出
sed -i '' "s/seg === 'scf'/seg === 'SCF_BROKEN'/" "$VICTIM"
if bash "$GUARD" --check >/dev/null 2>&1; then
  echo "✗ 注入漂移后仍通过——守卫抓不到回归"; fail=1
else
  echo "✓ 注入漂移被检出"
fi

# 3) 还原后必须恢复通过
restore
trap - EXIT
if bash "$GUARD" --check >/dev/null 2>&1; then
  echo "✓ 还原后恢复通过"
else
  echo "✗ 还原后仍失败"; fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo; echo "自检失败——守卫不可信，请先修它"; exit 1
fi
echo; echo "自检通过：守卫能抓到漂移，也不会误报"
