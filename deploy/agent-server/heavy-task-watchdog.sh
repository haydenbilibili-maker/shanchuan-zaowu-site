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

MAX_MINUTES="${MAX_MINUTES:-10}"     # 超过这个时长就杀（4 GB 机器上，单个验证跑 >10 分钟已属病态）
# **第二条触发：内存压力**。2026-09-22 补：只按时长判太慢 ——
# 实测服务再次降级时 cgroup 已 1.76/2.22 GB、load 10，而那些进程才跑了 2 分钟。
# 内存被顶满才是"web 答不出来"的直接原因，所以压力高时**不等时长**，直接收最老的重活。
MEM_TRIGGER_PCT="${MEM_TRIGGER_PCT:-75}"   # dsh-web cgroup 用量超过这个百分比就开杀
# **第三条触发：负载**。2026-09-22 第二次实测补：内存 79%（未到阈值）时 web 已经 `000` 了 ——
# 真凶是 **CPU 饥饿**：load 10 而机器只有 2 vCPU，Node 根本抢不到时间片。
# 所以负载超过 `每核 LOAD_PER_CORE` 时**不等时长、不等内存**，直接收最老的重活。
LOAD_PER_CORE="${LOAD_PER_CORE:-2.5}"
MEM_CURRENT="/sys/fs/cgroup/system.slice/dsh-web.service/memory.current"
MEM_MAX="/sys/fs/cgroup/system.slice/dsh-web.service/memory.max"
DRY_RUN="${DRY_RUN:-0}"
LOG="${LOG:-/var/log/dsh-heavy-watchdog.log}"

# 匹配"重活"的命令行特征（够具体，避免误杀）：
#   /tmp/wt-* 下的跑、run-guards、astro check、vite dev、check-sfc-dev-transform、test-wish-wall
PATTERN='/tmp/wt-|run-guards|astro check|check-sfc-dev-transform|test-wish-wall|bin/vite'

# 永不杀的（web 服务本体、隧道、系统关键）
NEVER='dsh web --host|cloudflared|sshd|systemd'

# 内存压力判定（cgroup v2 的 memory.current/max；读不到就当没有压力）
mem_pct=0
if [ -r "$MEM_CURRENT" ] && [ -r "$MEM_MAX" ]; then
  cur="$(cat "$MEM_CURRENT" 2>/dev/null || echo 0)"
  mx="$(cat "$MEM_MAX" 2>/dev/null || echo 0)"
  if [ "${mx:-0}" -gt 0 ] 2>/dev/null; then
    mem_pct=$(( cur * 100 / mx ))
  fi
fi

max_age="$((MAX_MINUTES * 60))"

# **首要判据：web 自己还答不答得动**（这才是产品负责人看到的现象）。
# 答不动（超时/非 HTTP 响应）⇒ 立刻收掉**全部**重活 —— UI 可用优先于任何验证。
# 2026-09-22 实测：本机 `curl 127.0.0.1:3080/api/config` 从 `401/0.26s`（健康）
# 退化为 `000/10s`（超时）时，就是 524 的现场。
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3080/api/config}"
health="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$HEALTH_URL" 2>/dev/null || echo 000)"
if [ "$health" = "000" ] || [ -z "$health" ]; then
  max_age=0   # 全杀
  ts0="$(date '+%F %T')"
  echo "$ts0 ⚠ web 无响应（$HEALTH_URL → ${health}）⇒ 收掉全部重活（UI 可用优先）" | tee -a "$LOG"
fi

# 负载压力（1 分钟平均 / 核数）
ncpu="$(nproc 2>/dev/null || echo 2)"
load1="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
over_load="$(awk -v l="$load1" -v n="$ncpu" -v k="$LOAD_PER_CORE" 'BEGIN{print (l > n*k) ? 1 : 0}')"
if [ "$over_load" = "1" ] && [ "$max_age" -gt 60 ]; then
  max_age=60
  ts0="$(date '+%F %T')"
  echo "$ts0 负载 ${load1} > ${ncpu}核 × ${LOAD_PER_CORE} → 时长阈值临时压到 60s（CPU 饥饿会让 web 答不出来）" | tee -a "$LOG"
fi

if [ "$mem_pct" -ge "$MEM_TRIGGER_PCT" ] && [ "$max_age" -gt 60 ]; then
  # 内存吃紧：把阈值压到 60 秒 —— 只收"已经在跑"的重活，不碰刚起的短任务
  max_age=60
  ts0="$(date '+%F %T')"
  echo "$ts0 内存压力 ${mem_pct}% ≥ ${MEM_TRIGGER_PCT}% → 时长阈值临时压到 60s" | tee -a "$LOG"
fi

mapfile -t CANDIDATES < <(
  ps -eo pid,etimes,args --sort=-etimes \
    | awk -v max="$max_age" 'NR>1 && $2>=max { $1=$1; print }' \
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
    echo "[dry-run] 会杀 pid=${pid}（已跑 ${mins} 分钟）: $desc"
    continue
  fi
  if kill -TERM "$pid" 2>/dev/null; then
    sleep 2
    kill -KILL "$pid" 2>/dev/null || true
    echo "$ts KILL pid=$pid 已跑=${mins}min :: $desc" | tee -a "$LOG"
  fi
done
