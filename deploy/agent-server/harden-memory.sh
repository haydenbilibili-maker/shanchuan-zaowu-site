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
		echo "  跳过 $unit（未安装）"; return 0
	fi
	mkdir -p "/etc/systemd/system/${unit}.d"
	cat > "/etc/systemd/system/${unit}.d/10-memory.conf" <<CONF
# 由 harden-memory.sh 生成：防止单个服务失控拖死整机（见脚本头部的事故说明）
[Service]
MemoryAccounting=yes
MemoryHigh=${high}
MemoryMax=${max}
CONF
	echo "  $unit → MemoryHigh=${high} MemoryMax=${max}"
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
echo "完成。现在任何单个服务失控都只会牺牲自己（systemd 会自动拉起），不会再让整机失联。"
echo
echo "⚠ 仍要记住：1.58 GiB 不足以在服务器上跑 npm install / vite build。"
echo "   重构建请放本地或 CI；若要让 agent 在服务器上跑构建，请把实例升配到 4 GiB。"
