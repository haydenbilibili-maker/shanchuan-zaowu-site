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
# ⚠️ 2026-09-18 修：这里原本是 `sed -i '' "s/…/…/" "$VICTIM"` —— **BSD/macOS 专有写法**。
#    GNU sed（CI / ubuntu-latest）不认它，会去读一个叫 "s/seg === 'scf'/…" 的文件并报
#    `can't read …: No such file or directory` → 在 `set -e` 下让本自检 exit 2。
#    后果：本机（macOS）绿、**CI 上 guards-can-fail job 恒红**，而且守卫其实从未被真正测到。
#    改用 `perl -pi -e`：macOS 与 ubuntu CI 都自带，两边语义一致（本机已实测：
#    替换生效 / 未命中不改文件 / 未命中仍 exit 0 不会触发 set -e / 文件权限保持）。
perl -pi -e "s/seg === 'scf'/seg === 'SCF_BROKEN'/" "$VICTIM"
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
