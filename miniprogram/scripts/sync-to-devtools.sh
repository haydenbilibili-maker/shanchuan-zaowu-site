#!/usr/bin/env bash
# 把本仓库 miniprogram/ 回灌到微信开发者工具实际打开的目录
#
# 背景：微信开发者工具打开的是开发仓 WeChatProjects/shanchuanspecimens-只上传，
#       本仓库（shanchuanzaowu/miniprogram）是唯一权威源。改完代码必须同步，否则工具里看不到改动。
#
# 用法：
#   ./scripts/sync-to-devtools.sh              # 仅预览差异（dry-run，安全）
#   ./scripts/sync-to-devtools.sh apply        # 实际同步（不删除目标多余文件）
#   ./scripts/sync-to-devtools.sh apply --delete   # 严格镜像（会删除目标独有文件，谨慎）
#   DEVTOOLS_DIR=/path/to/project ./scripts/sync-to-devtools.sh apply
set -eu

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DEVTOOLS_DIR:-/Users/hayden_lee/LifeOS_Workspace/Business_Projects/WeChatProjects/shanchuanspecimens-只上传}"

if [[ ! -d "$DEST" ]]; then
  echo "✖ 目标目录不存在：$DEST" >&2
  echo "  请用 DEVTOOLS_DIR=<开发者工具项目目录> 指定" >&2
  exit 1
fi

MODE="${1:-dry-run}"
shift || true

OPTS=(-a --exclude node_modules --exclude .git --exclude .DS_Store --exclude scripts/.tmp)
if [[ "$MODE" == "apply" ]]; then
  for extra in "$@"; do
    [[ "$extra" == "--delete" ]] && OPTS+=(--delete)
  done
  echo "→ 同步 $SRC/ → $DEST/"
  rsync "${OPTS[@]}" "$SRC/" "$DEST/"
  echo "✔ 同步完成（如工具已打开该项目，回到工具点「编译」；必要时先「清缓存 → 全部清除」）"
else
  echo "→ 预览差异（不会写入）：$SRC/ → $DEST/"
  rsync "${OPTS[@]}" --dry-run --itemize-changes "$SRC/" "$DEST/"
  echo "（以上为将要发生的改动；执行 $0 apply 才会真正写入）"
fi
