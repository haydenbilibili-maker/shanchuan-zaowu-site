#!/usr/bin/env bash
# 安全打印：微信支付环境变量「控制台配置」逐步清单 + 可选重部署支付云函数
#
# 微信开发者工具 CLI（cloud functions / cloud env）**无法**写入环境变量，
# 本脚本只做本地校验与操作提示，绝不把商户号写入仓库内可跟踪文件。
#
# 用法：
#   # 1) 交互：从环境变量或 pay.env.local 读取 mchId，打印控制台步骤
#   ./scripts/configure-pay-env-checklist.sh
#
#   # 2) 一次性传入（不写盘）
#   WX_PAY_SUB_MCH_ID=1234567890 ./scripts/configure-pay-env-checklist.sh
#
#   # 3) 校验通过后顺带部署支付四函数
#   WX_PAY_SUB_MCH_ID=1234567890 DEPLOY_AFTER=1 ./scripts/configure-pay-env-checklist.sh
#
# 红线：不要设置 ALLOW_MOCK_PAY=1；不要把 mchId 写进 config.json / 源码 / git。
set -eu

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_ENV="${PROJECT}/scripts/pay.env.local"
EXAMPLE_ENV="${PROJECT}/scripts/pay.env.example"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"
APP_ID="${APP_ID:-wxf2550373b010b447}"
PAY_FUNCS_WITH_MCH="payOrder confirmPayment refundOrder"
PAY_FUNCS_ALL="payOrder confirmPayment refundOrder payCallback"

# 从 pay.env.local 加载（若存在且未在环境中提供）
# 兼容 macOS Bash 3.2：不用 source <(...)（进程替换在此场景下导不出变量）
if [[ -z "${WX_PAY_SUB_MCH_ID:-}" && -f "${LOCAL_ENV}" ]]; then
  while IFS= read -r __pay_line || [[ -n "${__pay_line}" ]]; do
    case "${__pay_line}" in
      ''|\#*) continue ;;
    esac
    if [[ "${__pay_line}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "${__pay_line}"
    fi
  done < "${LOCAL_ENV}"
  unset __pay_line
fi

MCH_ID="${WX_PAY_SUB_MCH_ID:-}"
MASKED=""
if [[ -n "${MCH_ID}" ]]; then
  if [[ ! "${MCH_ID}" =~ ^[0-9]{8,12}$ ]]; then
    echo "错误：WX_PAY_SUB_MCH_ID 格式异常（期望 8–12 位数字商户号），已中止。" >&2
    exit 1
  fi
  if [[ ${#MCH_ID} -ge 6 ]]; then
    MASKED="${MCH_ID:0:2}****${MCH_ID: -2}"
  else
    MASKED="****"
  fi
fi

echo "=============================================="
echo " 山海造物 · 支付开发配置清单（控制台操作）"
echo "=============================================="
echo " AppID:    ${APP_ID}"
echo " 云环境:   ${ENV_ID}"
echo " 服务商:   1800008281（小程序云开发）"
echo " CLI 能力: 可 deploy / info / list；**不能**写入环境变量"
if [[ -n "${MASKED}" ]]; then
  echo " 商户号:   已提供（脱敏显示 ${MASKED}）"
else
  echo " 商户号:   尚未提供 ← 当前卡点"
fi
echo ""

if [[ -z "${MCH_ID}" ]]; then
  echo "【卡点】缺少 mchId。"
  echo "  请老板/你回复或本地设置："
  echo "    WX_PAY_SUB_MCH_ID=你的商户号 ./scripts/configure-pay-env-checklist.sh"
  echo "  或："
  echo "    cp ${EXAMPLE_ENV} ${LOCAL_ENV}"
  echo "    # 编辑 pay.env.local 填入真实 mchid（该文件已 gitignore）"
  echo ""
fi

echo "---------- 老板还需确认的绑定项 ----------"
echo " B1. 商户平台 → 产品中心 → APPID授权管理 → 关联 AppID ${APP_ID}"
echo " B2. 公众平台 → 微信支付 → 商户号管理 → 确认关联"
echo " B3. 云开发控制台添加商户号后，超管在「微信支付商家助手」授权服务商 1800008281"
echo " B4. 商户平台「我的授权产品」含：JSAPI 支付、API 退款"
echo ""

echo "---------- 开发逐步操作（控制台）----------"
echo " 1. 打开微信开发者工具 → 云开发（环境 ${ENV_ID}）"
echo " 2. 设置 → 全局设置 → 微信支付 → 添加商户号"
if [[ -n "${MCH_ID}" ]]; then
  echo "    填入商户号：${MCH_ID}"
else
  echo "    填入商户号：（待你提供 mchid）"
fi
echo " 3. 请商户号超管微信确认授权给 1800008281；核对 JSAPI + API 退款已授权"
echo " 4. 云函数 → 分别为下列函数添加环境变量（值相同，勿配 ALLOW_MOCK_PAY）："
for f in $PAY_FUNCS_WITH_MCH; do
  if [[ -n "${MCH_ID}" ]]; then
    echo "    - $f  →  WX_PAY_SUB_MCH_ID = ${MCH_ID}"
  else
    echo "    - $f  →  WX_PAY_SUB_MCH_ID = <mchid>"
  fi
done
echo " 5. 确认三个函数都没有 ALLOW_MOCK_PAY=1"
echo " 6. 保存后重新部署支付相关云函数（可用本仓库脚本）："
echo "      CLI_PORT=39100 ./scripts/deploy-pay-cloudfunctions.sh"
echo "    部署目标：${PAY_FUNCS_ALL}"
echo " 7. 体验版真机验收：调起收银台；支付成功后订单 wxPayMode=wechat"
echo ""

echo "---------- 安全提醒 ----------"
echo " · 勿把商户号写入 cloudfunctions/*/config.json、源码或会入库的文档"
echo " · 本地可用 scripts/pay.env.local（已 gitignore）；勿 commit"
echo " · 生产禁止 ALLOW_MOCK_PAY=1"
echo ""

if [[ "${DEPLOY_AFTER:-0}" == "1" ]]; then
  if [[ -z "${MCH_ID}" ]]; then
    echo "DEPLOY_AFTER=1 但缺少 mchId，跳过部署。请先在控制台配好变量并提供商户号。" >&2
    exit 1
  fi
  echo "将执行支付云函数部署（假设你已在控制台写入环境变量）…"
  CLI_PORT="${CLI_PORT:-39100}" CLOUD_ENV="${ENV_ID}" "${PROJECT}/scripts/deploy-pay-cloudfunctions.sh"
fi

if [[ -n "${MCH_ID}" && "${DEPLOY_AFTER:-0}" != "1" ]]; then
  echo "下一步：在控制台按上面 1–5 配好后，执行："
  echo "  CLI_PORT=39100 ./scripts/deploy-pay-cloudfunctions.sh"
  echo "或设 DEPLOY_AFTER=1 让本脚本末尾自动部署。"
fi
