#!/usr/bin/env bash
#
# 内存加固：让「某个服务失控」不再把整机拖死
#
# 背景（2026-09-17 事故）：实例 MemTotal 仅 1.58 GiB（标称 2 GiB）。加上 Caddy 之后，
# 整机假死到 SSH 都拿不到 banner（"Connection timed out during banner exchange"）、
# Cloudflare Tunnel 掉线（公网 530）、控制台卡在「停止中」—— 必须重启才恢复。
#
# 根因判断：**没有资源隔离**。任何一个服务涨内存，都会挤掉 sshd 与 systemd，
# 于是「机器还在跑、但你既连不上也管不了」。swap 4 GiB 只能延缓，不能阻止这种假死。
#
# 本脚本用 systemd cgroup 给各服务设上限：
#   · MemoryHigh = 软上限：超过就先回收/限速，**不杀进程**（优先用这个）
#   · MemoryMax  = 硬上限：超过则只杀该 cgroup 内的进程，systemd 会按 Restart=always 拉起
#   ⇒ 失控的服务牺牲自己，而不是拖垮整机；sshd 始终有内存可用。
#
# 用法（root）：bash harden-memory.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "✗ 需要 root"; exit 1; }

echo "==> 当前内存"
free -m | sed -n '1,3p'
echo

apply() {  # apply <unit> <high> <max>
	local unit="$1" high="$2" max="$3"
	if ! systemctl cat "$unit" >/dev/null 2>&1; then
		echo "  跳过 ${unit}（未安装）"; return 0
	fi
	# ⚠ drop-in 目录必须是 <unit>.service.d —— 写成 <unit>.d 会被 systemd **静默忽略**
	#（本脚本第一版就踩了这个坑：复核时 MemoryHigh/Max 全是 infinity，才暴露出来）。
	# 这也是为什么本脚本最后一定要**回读生效值**，而不是「写完就算成功」。
	mkdir -p "/etc/systemd/system/${unit}.service.d"
	cat > "/etc/systemd/system/${unit}.service.d/10-memory.conf" <<CONF
# 由 harden-memory.sh 生成：防止单个服务失控拖死整机（见脚本头部的事故说明）
[Service]
MemoryAccounting=yes
MemoryHigh=${high}
MemoryMax=${max}
CONF
	echo "  $unit → MemoryHigh=${high} MemoryMax=${max}  (/etc/systemd/system/${unit}.service.d/)"
}

echo "==> 1/3 给各服务设内存上限"
# DSH 是主要占用者，但仍要给 agent 干活留出余量；超了让它自己重启，而不是拖垮机器。
apply dsh-web    750M 1000M
apply caddy      48M  128M
apply cloudflared 64M 192M
# sshd 不设上限 —— 它必须永远能起得来，这是我们唯一的救援通道。

echo
echo "==> 2/3 降低「内存压力时被优先牺牲」的风险（给关键服务更高优先级）"
mkdir -p /etc/systemd/system/ssh.service.d
cat > /etc/systemd/system/ssh.service.d/10-oom.conf <<'CONF'
[Service]
# 正数 = 更不容易被 OOM killer 选中（sshd 是我们的救援通道）
OOMScoreAdjust=-500
CONF
echo "  ssh.service → OOMScoreAdjust=-500"

echo
echo "==> 3/3 生效并复核"
systemctl daemon-reload
for u in dsh-web caddy cloudflared; do
	systemctl is-active --quiet "$u" 2>/dev/null && systemctl restart "$u" || true
done
sleep 6
for u in dsh-web caddy cloudflared; do
	printf "  %-14s %-8s MemoryHigh=%s MemoryMax=%s\n" "$u" \
		"$(systemctl is-active $u 2>/dev/null || echo -)" \
		"$(systemctl show -p MemoryHigh --value $u 2>/dev/null || echo -)" \
		"$(systemctl show -p MemoryMax  --value $u 2>/dev/null || echo -)"
done
echo
echo "==> 4/4 journald 加固 —— **本次事故的真凶**"
# 取证（journalctl -b -1）显示：
#   02:26:52 systemd-journald.service: Watchdog timeout (limit 3min)!
#   02:36:55 systemd-logind: Failed to get load state of poweroff.target: Connection timed out
#   02:37:03 Failed to execute poweroff operation: Connection timed out   ← 控制台卡「停止中」
#   02:35:53 pam_systemd(sshd:session): Failed to release session: Transport endpoint is not connected
#   全程**没有任何 OOM 记录**
# ⇒ 不是内存不足被 OOM，而是 **journald 卡死**：日志服务一挂，写日志的进程全部阻塞，
#   于是 cloudflared 起不来、logind 的 poweroff 超时（表现为控制台「停止中」）、
#   sshd 无法释放会话（表现为 SSH 拿不到 banner）。整机看似死了，其实是日志管道断了。
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/10-cap.conf <<'CONF'
# 由 harden-memory.sh 生成：给 journald 设硬上限，避免它自己成为不可控占用并卡死
[Journal]
SystemMaxUse=64M
RuntimeMaxUse=16M
MaxRetentionSec=1week
# 限速：防止某个服务刷日志把 journald 拖垮（cloudflared 的 QUIC 重试循环就刷过）
RateLimitIntervalSec=30s
RateLimitBurst=2000
CONF
apply systemd-journald 48M 128M
systemctl restart systemd-journald
sleep 2
printf "  journald → %s，磁盘占用 %s\n" "$(systemctl is-active systemd-journald)" "$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMG]' | head -1)"

echo
echo "完成。三层护栏：① 服务内存上限（失控者牺牲自己）② sshd 不可被 OOM ③ journald 有硬上限与限速。"
echo
echo "⚠ 仍要记住：1.58 GiB 不足以在服务器上跑 npm install / vite build。"
echo "   重构建请放本地或 CI；若要让 agent 在服务器上跑构建，请把实例升配到 4 GiB。"
echo
echo "⚠ 运维习惯（我自己的教训）：不要反复跑「读整份 journal 再 grep」的命令"
echo "   （如 journalctl --no-pager | grep …）。那会整份解码日志，在小内存机器上是"
echo "   额外负担。请用 -n/--since 限定范围。"
