#!/usr/bin/env bash
# 单个云函数部署（云端安装依赖）——开发期只改了一两个函数时用它，避免全量部署
#
# 前置：
#   1. 微信开发者工具已启动并登录；「设置 → 安全设置」已开启 CLI/HTTP 调用（或填了 --token）
#   2. 工具已打开本项目（本仓库 miniprogram/ 或回灌后的 WeChatProjects 副本）
#
# 用法：
#   ./scripts/deploy-one-cloudfunction.sh managerShipOrder
#   CLI_PORT=39996 ./scripts/deploy-one-cloudfunction.sh managerShipOrder
#   CLOUD_ENV=cloud1-8gnkty5bfff9f0bf CLI_PORT=39996 ./scripts/deploy-one-cloudfunction.sh managerShipOrder manageStaff
#
# 提示：--port 必须与开发者工具当前 HTTP 服务端口一致；端口写错时 CLI 会尝试另起一个工具实例。
set -eu

CLI="${WECHAT_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
PROJECT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"

# 端口探测：未显式给 CLI_PORT 时，从正在运行的开发者工具进程里取 HTTP 服务端口
if [[ -n "${CLI_PORT:-}" ]]; then
  PORT="$CLI_PORT"
else
  detected=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '/wechatweb/ {print $9}' | sed 's/.*://' | head -1 || true)
  PORT="${detected:-39100}"
  [[ -n "$detected" ]] && echo "（自动探测到开发者工具端口 ${PORT}；可用 CLI_PORT 覆盖）"
fi

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <函数名> [函数名 ...]" >&2
  exit 1
fi

rc_all=0
for name in "$@"; do
  dir="$PROJECT/cloudfunctions/$name"
  if [[ ! -f "$dir/index.js" && ! -f "$dir/package.json" ]]; then
    echo "✖ 跳过：$name 不存在（${dir}）" >&2
    rc_all=1
    continue
  fi
  echo "→ 部署 ${name}（env=$ENV_ID port=${PORT}）"
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
  echo "$out"
  if [[ $rc -ne 0 ]] || echo "$out" | grep -qE '✖|\[error\]|deploy fail'; then
    echo "✖ $name 部署失败（rc=${rc}）" >&2
    rc_all=1
  else
    echo "✔ $name 部署完成"
  fi
done

exit $rc_all
