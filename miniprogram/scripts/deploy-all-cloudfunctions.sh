#!/usr/bin/env bash
# 批量上传并部署 cloudfunctions/ 下全部云函数（云端安装依赖）
# 用途：微信开发者工具 CLI 已登录、且云 API 签名正常时，一键部署全部云函数。
# 依赖：/Applications/wechatwebdevtools.app/Contents/MacOS/cli
# 用法：
#   CLI_PORT=39100 ./scripts/deploy-all-cloudfunctions.sh
#   # 或仅优先函数：
#   ONLY_PRIORITY=1 CLI_PORT=39100 ./scripts/deploy-all-cloudfunctions.sh
set -eu
CLI="${WECHAT_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
PROJECT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"
PORT="${CLI_PORT:-39100}"
LOG_DIR="$PROJECT/scripts/.tmp"
mkdir -p "$LOG_DIR"
SUCCESS_LOG="$LOG_DIR/deploy-success.txt"
FAIL_LOG="$LOG_DIR/deploy-fail.txt"
ALL_LOG="$LOG_DIR/deploy-all.log"
: > "$SUCCESS_LOG"
: > "$FAIL_LOG"
: > "$ALL_LOG"

PRIORITY_LIST="login getEncyclopediaFeed storeCheckIn getHomeConfig getStoreConfig getStoreMediaUrls getRecommendations payOrder payCallback confirmPayment makeOrder identifySpecimen"

ORDERED_FILE="$LOG_DIR/deploy-order.txt"
: > "$ORDERED_FILE"
for p in $PRIORITY_LIST; do
  if [[ -f "$PROJECT/cloudfunctions/$p/index.js" || -f "$PROJECT/cloudfunctions/$p/package.json" ]]; then
    echo "$p" >> "$ORDERED_FILE"
  fi
done
if [[ "${ONLY_PRIORITY:-0}" != "1" ]]; then
  for d in "$PROJECT"/cloudfunctions/*/; do
    name=$(basename "$d")
    [[ -f "$d/index.js" || -f "$d/package.json" ]] || continue
    grep -qx "$name" "$ORDERED_FILE" && continue
    echo "$name" >> "$ORDERED_FILE"
  done
fi

total=$(wc -l < "$ORDERED_FILE" | tr -d ' ')
echo "Total: $total env=$ENV_ID port=$PORT" | tee -a "$ALL_LOG"
idx=0
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  idx=$((idx + 1))
  echo "[$idx/$total] deploy $name" | tee -a "$ALL_LOG"
  set +e
  out=$("$CLI" cloud functions deploy \
    --env "$ENV_ID" \
    --names "$name" \
    --remote-npm-install \
    --project "$PROJECT" \
    --port "$PORT" \
    --lang zh 2>&1)
  rc=$?
  set -e
  echo "$out" | tee -a "$ALL_LOG"
  if [[ $rc -eq 0 ]] && echo "$out" | grep -q "true" && ! echo "$out" | grep -qE '✖|\[error\]|false'; then
    echo "$name" >> "$SUCCESS_LOG"
  elif [[ $rc -eq 0 ]] && echo "$out" | grep -qE "success.*true|│ *${name} *│ *true"; then
    echo "$name" >> "$SUCCESS_LOG"
  else
    reason=$(echo "$out" | tr '\n' ' ' | sed 's/  */ /g' | head -c 240)
    echo -e "${name}\t${reason}" >> "$FAIL_LOG"
    if echo "$out" | grep -qE '需要重新登录|code: 10|41002'; then
      echo "Fatal auth/signing error, stop. Fix login then re-run." | tee -a "$ALL_LOG"
      break
    fi
  fi
  sleep 1
done < "$ORDERED_FILE"

echo "==== SUMMARY ====" | tee -a "$ALL_LOG"
echo "Success: $(wc -l < "$SUCCESS_LOG" | tr -d ' ')" | tee -a "$ALL_LOG"
echo "Fail: $(wc -l < "$FAIL_LOG" | tr -d ' ')" | tee -a "$ALL_LOG"
[[ -s "$FAIL_LOG" ]] && { echo "Failures:"; cat "$FAIL_LOG"; }

# 标本师招募：部署 submitFramerRecruit 后，须在云开发控制台预建集合
#   framer_recruit_applications（权限对齐 custom_inquiries；索引 status + createTime）
# 微信 CLI 无建集合命令；云函数首次写入遇 -502005 会尝试 db.createCollection。
#
# 备注：seedCategories 若因 EISDIR 失败，可用扁平临时目录部署：
#   将 cloudfunctions/seedCategories 与 community/* 扁平复制到 scripts/.tmp/seedCategories
#   修正 require('./community/...') 后执行：
#   cli cloud functions deploy --env ENV --paths scripts/.tmp/seedCategories -r --project PROJECT
