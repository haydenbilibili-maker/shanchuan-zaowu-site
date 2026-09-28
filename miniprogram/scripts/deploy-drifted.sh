#!/usr/bin/env bash
# 只部署「线上与仓库不一致」的云函数 —— **默认只针对你点名的函数**。
#
# 为什么需要：仓库已有 `scripts/check-cloud-functions-sync.cjs`（线上 vs 仓库比对），
# 但部署侧只有「部署单个」与「部署全部」两种脚本 —— 结果历史上一度出现
# **129 个云函数里 30 个跑的是旧代码**（改完只部署自己改的那个，从上没做过全量比对）。
# 本脚本把比对结果直接当作部署清单，两者永远同源。
#
# 前置：`tcb` CLI 已登录（`tcb fn list -e <env>` 能列出函数）。
# 注意：本脚本从 `miniprogram/` 目录调用 tcb，以便它读取 `miniprogram/cloudbaserc.json`
#       （其中 functionRoot=./cloudfunctions，且**没有** envVariables → 不会覆盖线上环境变量）。
#
# 用法（各工作流**只比对 / 只部署本流涉及的函数**）：
#   bash miniprogram/scripts/deploy-drifted.sh a b c            # 只比对 a b c → 只部署其中有漂移的 → 只复比这些
#   bash miniprogram/scripts/deploy-drifted.sh a,b,c            # 同上（逗号分隔也可）
#   bash miniprogram/scripts/deploy-drifted.sh --dry-run a b    # 只比对 a b、打印漂移清单，不部署
#   bash miniprogram/scripts/deploy-drifted.sh --all            # 全量比对 ~130 个函数并部署全部漂移（20+ 分钟，需显式 --all）
#   bash miniprogram/scripts/deploy-drifted.sh --all --dry-run  # 全量只读比对
#   bash miniprogram/scripts/deploy-drifted.sh --selftest-args  # 只自检参数解析（不联网、不部署）
#   不带任何函数名也不带 --all → 打印用法并退出（exit 2），**不会**触发全量比对。
#
# ⚠️ 2026-09-28 产品负责人口径：**禁止**「带了函数名却仍全量比对」。
#    原先第 1 步无条件跑全量比对（下载 ~130 个函数，20+ 分钟），带函数名只影响部署清单 ——
#    每条流单部署一个函数都要白等 20 分钟，且多条流同时跑会互相拖慢。
#    现在：带函数名 → 第 1 步只比对这些；全量必须显式 `--all`（误敲裸命令只会打印用法）。
#
# ⚠️ 2026-09-19 修过一个会误伤生产的参数 bug：原先无条件 `shift`，
#    `deploy-drifted.sh a b c` 会把**第一个目标 `a` 静默丢掉**；只指定一个函数时会被丢光
#    → 退化成部署全部漂移函数（当时 59 个）。现在参数逐个解析，并由 `--selftest-args` 钉住。
#
# ⚠️ 修改本文件请「写临时文件 → mv 原子替换」，**不要原地编辑**：
#    bash 边读边执行，其它工作流可能正在跑本脚本，原地改写会让它读到错位的字节而崩溃。
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_ID="${CLOUD_ENV:-cloud1-8gnkty5bfff9f0bf}"
# 可被环境变量覆盖：只为守卫能用假比对器离线证明「带函数名时不走全量」
CHECKER="${DEPLOY_DRIFTED_CHECKER:-$ROOT/scripts/check-cloud-functions-sync.cjs}"

usage() {
  cat <<'EOF'
用法：
  bash miniprogram/scripts/deploy-drifted.sh [--dry-run] <函数名...>   只比对/部署点名的函数（空格或逗号分隔）
  bash miniprogram/scripts/deploy-drifted.sh --all [--dry-run]         全量比对并部署全部漂移（20+ 分钟，慎用）
  bash miniprogram/scripts/deploy-drifted.sh --selftest-args           参数解析自检（离线）
各工作流只比对/部署本流涉及的函数；全量必须显式 --all。
EOF
}

# ── 参数解析（纯函数，--selftest-args 回放同一份）──
# 输出一行：「DRY ALL NAMES...」；出错输出「ERR 说明」
parse_args() {
  local dry=0 all=0 names="" a
  for a in "$@"; do
    case "$a" in
      --dry-run) dry=1 ;;
      --all) all=1 ;;
      -h|--help) echo "HELP"; return 0 ;;
      --*) echo "ERR 未知参数 $a"; return 0 ;;
      *) names="$names $(echo "$a" | tr ',' ' ')" ;;
    esac
  done
  names="$(echo $names)"
  if [ "$all" = "1" ] && [ -n "$names" ]; then echo "ERR --all 与函数名不能同时给"; return 0; fi
  if [ "$all" = "0" ] && [ -z "$names" ]; then echo "ERR 未指定函数名（全量请显式 --all）"; return 0; fi
  echo $dry $all $names
}

# ── 参数解析自检：不联网、不部署，只证明「指定目标不会被吃掉、裸命令不会全量」 ──
if [ "${1:-}" = "--selftest-args" ]; then
  fail=0
  check() { # $1=期望  $2=实际  $3=说明
    if [ "$1" = "$2" ]; then echo "✓ $3"
    else echo "✗ $3：期望 [$1]，实际=[$2]"; fail=1; fi
  }
  check "0 0 manageStudioSettlement" "$(parse_args manageStudioSettlement)" "单目标不被吃掉（原先会被吃掉 → 退化成部署全部）"
  check "0 0 a b c" "$(parse_args a b c)" "多目标完整保留（原先会丢第一个）"
  check "0 0 a b c" "$(parse_args a,b,c)" "逗号分隔等价于空格分隔"
  check "1 0 a b" "$(parse_args --dry-run a b)" "--dry-run 被消费、其后目标保留"
  check "1 0 a b" "$(parse_args a --dry-run b)" "--dry-run 位置任意"
  check "0 1" "$(parse_args --all)" "--all → 全量"
  check "1 1" "$(parse_args --all --dry-run)" "--all --dry-run → 全量只读"
  case "$(parse_args)" in ERR*) echo "✓ 无参数 → 报错打印用法（不再默认全量）" ;; *) echo "✗ 无参数竟未报错"; fail=1 ;; esac
  case "$(parse_args --dry-run)" in ERR*) echo "✓ 只有 --dry-run → 报错（不再默认全量）" ;; *) echo "✗ 只有 --dry-run 竟未报错"; fail=1 ;; esac
  case "$(parse_args --all a)" in ERR*) echo "✓ --all 与函数名混用 → 报错" ;; *) echo "✗ --all 与函数名混用竟未报错"; fail=1 ;; esac
  case "$(parse_args --drry-run a)" in ERR*) echo "✓ 拼错的参数 → 报错（不会被当成函数名）" ;; *) echo "✗ 拼错的参数竟未报错"; fail=1 ;; esac
  if [ "$fail" = "0" ]; then echo "✓ 参数解析自检通过（11 项）"; exit 0; fi
  echo "✗ 参数解析自检失败"; exit 1
fi

PARSED="$(parse_args "$@")"
case "$PARSED" in
  HELP) usage; exit 0 ;;
  ERR*) echo "✗ ${PARSED#ERR }" >&2; usage >&2; exit 2 ;;
esac
set -- $PARSED
DRY="$1"; ALL="$2"; shift 2
NAMES="$*"

TMP_DIR="$ROOT/miniprogram/scripts/.tmp"
mkdir -p "$TMP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
LOG="$TMP_DIR/deploy-drifted-$STAMP.log"
OK_LOG="$TMP_DIR/deploy-drifted-ok-$STAMP.txt"
FAIL_LOG="$TMP_DIR/deploy-drifted-fail-$STAMP.txt"
DRIFT_JSON="$TMP_DIR/fn-drift-$STAMP.json"
AFTER_JSON="$TMP_DIR/fn-drift-after-$STAMP.json"
: > "$OK_LOG"; : > "$FAIL_LOG"

# 读比对结果：成功输出漂移函数名（可能为空）；JSON 读不了输出 __READ_FAIL__
read_drift() {
  node -e '
    const fs=require("fs");
    try{
      const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      process.stdout.write((j.inconsistent||[]).map(r=>r.name).join(" "));
    }catch(e){ process.stdout.write("__READ_FAIL__"); }
  ' "$1"
}

if [ "$ALL" = "1" ]; then
  echo "== 1/3 比对线上与仓库（只读，全量 --all）==" | tee "$LOG"
else
  echo "== 1/3 比对线上与仓库（只读，仅：${NAMES}）==" | tee "$LOG"
fi
T0=$(date +%s)
# 带函数名时**必须**把 ${NAMES} 传给比对器 —— 不传它会下载全部 ~130 个函数（20+ 分钟）。
# ALL=1 时 NAMES 为空 → 比对器走全量，这是唯一允许全量的路径。
node "$CHECKER" $NAMES --json > "$DRIFT_JSON" 2>>"$LOG"
rc_check=$?
T1=$(date +%s)
echo "比对耗时 $((T1 - T0)) 秒" | tee -a "$LOG"
DRIFT="$(read_drift "$DRIFT_JSON")"
# 比对器退出码：0 一致 / 1 有不一致 / 2 自身失败（缺凭证等）。
# 自身失败时**绝不能**当成「一致」—— 否则会谎报「无需部署」。
if [ "$rc_check" -ge 2 ] || [ "$DRIFT" = "__READ_FAIL__" ]; then
  echo "✗ 比对失败（rc=${rc_check}），未部署任何函数。详见日志：$LOG" | tee -a "$LOG"
  tail -n 5 "$LOG" >&2
  exit 2
fi

if [ -z "$DRIFT" ]; then
  echo "✓ 线上与仓库一致，无需部署" | tee -a "$LOG"
  exit 0
fi

COUNT="$(echo $DRIFT | wc -w | tr -d ' ')"
echo "漂移函数 ${COUNT} 个：$DRIFT" | tee -a "$LOG"
if [ "$DRY" = "1" ]; then
  echo "（--dry-run，未部署）" | tee -a "$LOG"
  exit 0
fi

echo "== 2/3 逐个部署（env=${ENV_ID}）==" | tee -a "$LOG"
rc_all=0
for name in $DRIFT; do
  dir="$ROOT/miniprogram/cloudfunctions/$name"
  if [ ! -f "$dir/index.js" ] && [ ! -f "$dir/package.json" ]; then
    echo "✖ 跳过：$name 目录不存在" | tee -a "$LOG"
    echo "$name" >> "$FAIL_LOG"; rc_all=1; continue
  fi
  echo "→ 部署 $name" | tee -a "$LOG"
  out="$(cd "$ROOT/miniprogram" && tcb fn deploy "$name" -e "$ENV_ID" --force 2>&1)"
  rc=$?
  echo "$out" >> "$LOG"
  if [ $rc -ne 0 ] || ! echo "$out" | grep -q "deployed successfully"; then
    echo "✖ $name 部署失败（rc=${rc}）" | tee -a "$LOG"
    echo "$name" >> "$FAIL_LOG"; rc_all=1
  else
    echo "✔ $name" | tee -a "$LOG"
    echo "$name" >> "$OK_LOG"
  fi
done

echo "== 3/3 复比（只读，仅本次部署的函数）==" | tee -a "$LOG"
# 必须带上 ${DRIFT}：不带函数名时它会下载全部 ~130 个函数做比对。
node "$CHECKER" $DRIFT --json > "$AFTER_JSON" 2>>"$LOG" || true
AFTER="$(read_drift "$AFTER_JSON")"
[ "$AFTER" = "__READ_FAIL__" ] && AFTER="(读取失败)"
N_OK=$([ -s "$OK_LOG" ] && wc -l < "$OK_LOG" | tr -d ' ' || echo 0)
N_FAIL=$([ -s "$FAIL_LOG" ] && wc -l < "$FAIL_LOG" | tr -d ' ' || echo 0)
echo "成功 $N_OK / 失败 $N_FAIL" | tee -a "$LOG"
# ⚠️ 2026-09-20 修一处**会撒谎的结论**：原来只看"复比是否还有漂移"，
#    而 `tcb` 的失败可能发生在**上传成功之后的最后一个 API 回执**上
#    （实测 getStudioDashboard：日志写着 `FetchError: network timeout`，代码其实已经更新，
#     复比也就"通过"了）—— 于是脚本一边写"失败 1"一边打 `✓ 复比通过`。
#    现在：**只要部署步骤报过失败，就不许打 ✓**；要说清"到底算不算成功"，
#    一律以**线上拉回来的代码**为准（复比），但结论必须把"部署步骤有失败"一起说出来。
if [ -n "$AFTER" ]; then
  echo "✗ 仍不一致：$AFTER" | tee -a "$LOG"
  rc_all=1
elif [ "$N_FAIL" -gt 0 ]; then
  echo "⚠ 部署步骤报了 $N_FAIL 个失败，但复比显示线上已与仓库一致 ——" | tee -a "$LOG"
  echo "   这类失败通常发生在**上传成功之后的回执**上（网络超时）。请按函数逐个确认：" | tee -a "$LOG"
  echo "   失败清单：$(tr '\n' ' ' < "$FAIL_LOG")" | tee -a "$LOG"
  rc_all=1
else
  echo "✓ 复比通过：线上与仓库已一致（$N_OK 个函数，无失败）" | tee -a "$LOG"
fi
echo "日志：$LOG"
exit $rc_all
