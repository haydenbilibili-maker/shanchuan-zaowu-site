#!/usr/bin/env bash
# 在**服务器上**跑重活（全套守卫 / astro check / vite / 大构建）的包装器。
#
# 为什么必须有它（2026-09-22 真事故）：
#   agent 在服务器上执行的命令是 `dsh-web.service` 的**子进程**，因此计入**同一个 cgroup**
#   （`/sys/fs/cgroup/system.slice/dsh-web.service/memory.max = 2.22 GB`）。
#   实测：两套 `run-guards.mjs` + `astro check` + `vite` + `check-sfc-dev-transform` 一起跑，
#   把该 cgroup 顶到 **2.08/2.22 GB（94%）**、load 9.0（2 vCPU），
#   并且**卡死了 9.8 小时没人收**（12 个进程 ~1.5 GB）→ `dsh-web` 自己答不出请求
#   → 回环 `/api/config` = `000`（20s 超时）→ Cloudflare **524**（产品负责人截图里的那个）。
#
# 这个包装器做三件事：
#   ① **移出 web 服务的 cgroup**：`systemd-run --scope` 起一个独立单元 → 重活不再挤占 web 的内存配额；
#   ② **加硬超时**：默认 25 分钟（`--timeout` 可改）—— 卡死的活会**自己被杀**，不会挂十小时；
#   ③ **限制内存**：默认 1.2 GB（`--memory` 可改）—— 超了只杀它自己，不牵连 web。
#
# 用法（在服务器上，仓库根目录）：
#   bash deploy/agent-server/heavy-task.sh npm run check:admin
#   bash deploy/agent-server/heavy-task.sh --timeout 10min --memory 800M npm run test:wish-wall
#   bash deploy/agent-server/heavy-task.sh --list          # 看当前有没有在跑的 heavy 单元
#
# ⚠️ 轻活**不要**用它：内循环请用 `npm run check:quick -- <域>`（约 2.5s，直接跑就行）。
set -uo pipefail

UNIT_PREFIX="dsh-heavy"
TIMEOUT="25min"
MEMORY="1200M"

# --list：只看不跑
if [ "${1:-}" = "--list" ]; then
  echo "在跑的 heavy 单元："
  systemctl list-units --type=scope --all "${UNIT_PREFIX}-*" --no-pager 2>/dev/null | head -20 || true
  echo
  echo "（若某个跑得异常久，用： systemctl stop <单元名>）"
  exit 0
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) TIMEOUT="${2:?--timeout 需要值，如 25min}"; shift 2 ;;
    --memory)  MEMORY="${2:?--memory 需要值，如 1200M}"; shift 2 ;;
    *) break ;;
  esac
done

if [ $# -eq 0 ]; then
  echo "用法：bash deploy/agent-server/heavy-task.sh [--timeout 25min] [--memory 1200M] <命令…>" >&2
  exit 2
fi

UNIT="${UNIT_PREFIX}-$(date +%s)"
echo "▶ 起独立单元 ${UNIT}（timeout ${TIMEOUT} / memory ${MEMORY}）"
echo "  命令：$*"

# --scope：以前台进程组运行，但归属**新的独立 cgroup**（不占 dsh-web 的 2.22 GB 配额）
# MemoryMax / RuntimeMaxSec：超限只杀这个单元自己
#
# ⚠️ agent 以 `admin` 跑（`dsh-web.service` 的 User=admin），而 `systemd-run` 需要 root：
#    该机 admin 有**无密码 sudo**，所以非 root 时自动加 sudo。
SUDO=""
if [ "$(id -u)" != "0" ]; then
  SUDO="sudo"
fi

exec $SUDO systemd-run --scope --unit "$UNIT" \
  -p MemoryMax="$MEMORY" -p RuntimeMaxSec="$TIMEOUT" \
  --collect \
  "$@"
