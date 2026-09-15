#!/usr/bin/env bash
# 一条命令完成「云函数部署 + 回灌开发者工具目录」
#
# 用途：本仓库是权威源，但微信开发者工具打开的是历史副本目录；
#       改完代码跑这条命令，工具里立刻能看到最新前端 + 最新云函数。
#
# 用法：
#   ./scripts/publish-local.sh managerShipOrder            # 部署指定云函数并同步目录
#   ./scripts/publish-local.sh --skip-fn                   # 只同步目录（不改云端）
#   ./scripts/publish-local.sh --dry-run                   # 只看会同步哪些文件
#   FN_LIST="managerShipOrder manageStaff" ./scripts/publish-local.sh
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="apply"
FN_LIST="${FN_LIST:-}"
ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-fn) FN_LIST="" ;;
    --dry-run) MODE="dry-run" ;;
    --help|-h) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "未知参数：$arg" >&2; exit 1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [[ ${#ARGS[@]} -gt 0 ]]; then
  FN_LIST="${ARGS[*]}"
fi

if [[ -n "$FN_LIST" ]]; then
  echo "=== 1/2 部署云函数：$FN_LIST ==="
  "$DIR/deploy-one-cloudfunction.sh" $FN_LIST
else
  echo "=== 1/2 跳过云函数部署（--skip-fn）==="
fi

echo "=== 2/2 回灌开发者工具目录（${MODE}）==="
"$DIR/sync-to-devtools.sh" "$MODE"

if [[ "$MODE" == "apply" ]]; then
  cat <<'TIP'

下一步（手工）：
  1) 回到微信开发者工具 → 编译；若仍看到旧内容，先「清缓存 → 全部清除」再编译
  2) 真机预览走一遍关键链路后再上传体验版
TIP
fi
