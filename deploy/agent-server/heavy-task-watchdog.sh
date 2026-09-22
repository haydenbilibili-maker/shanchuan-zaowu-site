#!/usr/bin/env bash
# 看门狗：杀掉「在服务器上跑太久」的验证/构建进程，并留痕。
#
# 为什么需要它（2026-09-22 真事故）：
#   agent 起的两套 `run-guards.mjs` + `astro check` + `vite` 卡死了 **9.8 小时**没人收，
#   12 个进程占 ~1.5 GB，把 `dsh-web.service` 的 cgroup 顶到 94% → web 自身答不出请求
#   → 回环 `/api/config` = 000 → Cloudflare **524**。
#   包装器（heavy-task.sh）让**新**任务不再发生这件事；本看门狗负责**兜住漏网的与已经挂上的**：
#   任何跑超过 MAX_MINUTES 的重活都会被 TERM→KILL，并写一行日志。
#
# 安装（在服务器上，root）：
#   install -m 755 deploy/agent-server/heavy-task-watchdog.sh /usr/local/bin/dsh-heavy-watchdog
#   cat >/etc/systemd/system/dsh-heavy-watchdog.service <<'UNIT'
#   [Unit]
#   Description=Kill runaway verification/build tasks spawned by the on-server agent
#   [Service]
#   Type=oneshot
#   ExecStart=/usr/local/bin/dsh-heavy-watchdog
#   UNIT
#   cat >/etc/systemd/system/dsh-heavy-watchdog.timer <<'UNIT'
#   [Unit]
#   Description=Run dsh-heavy-watchdog every 10 minutes
#   [Timer]
#   OnBootSec=10min
#   OnUnitActiveSec=10min
#   [Install]
#   WantedBy=timers.target
#   UNIT
#   systemctl daemon-reload && systemctl enable --now dsh-heavy-watchdog.timer
#
# 默认只杀**明确属于验证/构建**的进程（按命令行特征），不碰 dsh-web / cloudflared / sshd。
# 试运行： DRY_RUN=1 bash heavy-task-watchdog.sh
set -uo pipefail

MAX_MINUTES="${MAX_MINUTES:-30}"     # 超过这个时长就杀
DRY_RUN="${DRY_RUN:-0}"
LOG="${LOG:-/var/log/dsh-heavy-watchdog.log}"

# 匹配"重活"的命令行特征（够具体，避免误杀）：
#   /tmp/wt-* 下的跑、run-guards、astro check、vite dev、check-sfc-dev-transform、test-wish-wall
PATTERN='/tmp/wt-|run-guards|astro check|check-sfc-dev-transform|test-wish-wall|bin/vite'

# 永不杀的（web 服务本体、隧道、系统关键）
NEVER='dsh web --host|cloudflared|sshd|systemd'

mapfile -t CANDIDATES < <(
  ps -eo pid,etimes,args --sort=-etimes \
    | awk -v max="$((MAX_MINUTES * 60))" 'NR>1 && $2>max { $1=$1; print }' \
    | grep -E "$PATTERN" | grep -vE "$NEVER" || true
)

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  exit 0
fi

ts="$(date '+%F %T')"
for line in "${CANDIDATES[@]}"; do
  pid="$(echo "$line" | awk '{print $1}')"
  secs="$(echo "$line" | awk '{print $2}')"
  desc="$(echo "$line" | cut -c1-160)"
  mins="$((secs / 60))"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] 会杀 pid=$pid（已跑 ${mins} 分钟）: $desc"
    continue
  fi
  if kill -TERM "$pid" 2>/dev/null; then
    sleep 2
    kill -KILL "$pid" 2>/dev/null || true
    echo "$ts KILL pid=$pid 已跑=${mins}min :: $desc" | tee -a "$LOG"
  fi
done
