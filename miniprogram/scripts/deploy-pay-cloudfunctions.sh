#!/usr/bin/env bash
# 仅上传并部署支付相关云函数（云端安装依赖）
# 前置：已在云开发控制台为 payOrder / confirmPayment / refundOrder 配置
#       环境变量 WX_PAY_SUB_MCH_ID；且未开启 ALLOW_MOCK_PAY。
# 依赖：微信开发者工具 CLI 已登录
#
# 用法：
#   CLI_PORT=39100 ./scripts/deploy-pay-cloudfunctions.sh
#   CLOUD_ENV=cloud1-8gnkty5bfff9f0bf CLI_PORT=39100 ./scripts/deploy-pay-cloudfunctions.sh
set -eu

CLI="${WECHAT_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
PROJECT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"
PORT="${CLI_PORT:-39100}"
LOG_DIR="$PROJECT/scripts/.tmp"
mkdir -p "$LOG_DIR"
SUCCESS_LOG="$LOG_DIR/deploy-pay-success.txt"
FAIL_LOG="$LOG_DIR/deploy-pay-fail.txt"
ALL_LOG="$LOG_DIR/deploy-pay.log"
: > "$SUCCESS_LOG"
: > "$FAIL_LOG"
: > "$ALL_LOG"

# payCallback 不读 WX_PAY_SUB_MCH_ID，但与统一下单回调绑定，需一并保持最新
NAMES="payOrder confirmPayment refundOrder payCallback"

echo "Deploy pay functions → env=$ENV_ID port=$PORT" | tee -a "$ALL_LOG"
echo "Names: $NAMES" | tee -a "$ALL_LOG"
echo "提醒：本脚本不写入环境变量；请确认控制台已配置 WX_PAY_SUB_MCH_ID，且无 ALLOW_MOCK_PAY=1" | tee -a "$ALL_LOG"

idx=0
total=$(echo "$NAMES" | wc -w | tr -d ' ')
for name in $NAMES; do
  idx=$((idx + 1))
  if [[ ! -f "$PROJECT/cloudfunctions/$name/index.js" && ! -f "$PROJECT/cloudfunctions/$name/package.json" ]]; then
    echo "[$idx/$total] skip missing $name" | tee -a "$ALL_LOG"
    echo -e "${name}\tmissing local folder" >> "$FAIL_LOG"
    continue
  fi
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
  if [[ $rc -eq 0 ]] && echo "$out" | grep -qE "success.*true|│ *${name} *│ *true" && ! echo "$out" | grep -qE '✖|\[error\]'; then
    echo "$name" >> "$SUCCESS_LOG"
  elif [[ $rc -eq 0 ]] && echo "$out" | grep -q "true" && ! echo "$out" | grep -qE '✖|\[error\]|false'; then
    echo "$name" >> "$SUCCESS_LOG"
  else
    reason=$(echo "$out" | tr '\n' ' ' | sed 's/  */ /g' | head -c 240)
    echo -e "${name}\t${reason}" >> "$FAIL_LOG"
    if echo "$out" | grep -qE '需要重新登录|code: 10|41002'; then
      echo "Fatal auth/signing error, stop." | tee -a "$ALL_LOG"
      break
    fi
  fi
  sleep 1
done

echo "==== SUMMARY ====" | tee -a "$ALL_LOG"
echo "Success: $(wc -l < "$SUCCESS_LOG" | tr -d ' ')" | tee -a "$ALL_LOG"
echo "Fail: $(wc -l < "$FAIL_LOG" | tr -d ' ')" | tee -a "$ALL_LOG"
[[ -s "$FAIL_LOG" ]] && { echo "Failures:"; cat "$FAIL_LOG"; exit 1; }
echo "Done. 请真机验收：下单 → 收银台 → 支付成功订单 wxPayMode=wechat"
