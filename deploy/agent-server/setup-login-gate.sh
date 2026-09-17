#!/usr/bin/env bash
#
# 安装 Agent 登录网关（替代 Caddy）
#
#   agent.shanhaizaowu.com → cloudflared → 本机 127.0.0.1:8080 (agent-gate)
#                                          ├ 未登录 → 302 到登录页（不是 401，避免原生弹框）
#                                          ├ 登录成功 → 下发 HMAC 签名的 365 天 cookie
#                                          └ 已登录 → 反代 127.0.0.1:3080，并注入 DSH cookie
#
# 用法：sudo bash setup-login-gate.sh '<密码>'
set -euo pipefail

PW="${1:-}"
[ -n "$PW" ] || { echo "用法: sudo bash setup-login-gate.sh '<密码>'"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "✗ 需要 root"; exit 1; }

PUBLIC_HOST=agent.shanhaizaowu.com
GATE_PORT=8080
DSH_PORT=3080
GATE_DIR=/opt/agent-gate

echo "==> 1/6 铸造 DSH 会话 cookie（用当期 launch token 换）"
# 直接以 root 读 journal（本脚本已是 root）。**不要**写嵌套的 `sudo -u admin bash -c "sudo …"`：
# 在无 TTY 的 SSH 会话里它会静默失败，而 `set -e` 会让命令替换的失败**不打印地**终止脚本
#（实测踩过：脚本只输出到本行标题就退出，没有任何报错）。
# 用 -n 限定范围而不是读整份 journal —— 小内存机器上整份解码是额外负担（见 harden-memory.sh）。
TOK=$(journalctl -u dsh-web --no-pager -n 2000 2>/dev/null \
	| grep -o 'dsh web: http://127.0.0.1:[0-9]*/?token=[^ ]*' | tail -1 | sed 's/.*token=//' || true)
TOK=$(printf '%s' "$TOK" | tr -d '\r\n')
if [ ${#TOK} -ne 43 ]; then
	echo "  ✗ 取到的 token 长度异常（${#TOK}，应为 43）。请确认 dsh-web 正在运行且最近重启过，然后重跑本脚本。"
	exit 1
fi
# 直接用**回环**换 cookie，并带上公网 Host。
# 为什么不能走公网 URL：那时请求要穿过即将被替换的鉴权层（原 Caddy Basic Auth / 或本网关自身），
# 会得到 401 → 拿不到 Set-Cookie，形成「网关需要 cookie、而拿 cookie 又需要过网关」的鸡生蛋。
# DSH 的 cookie 是**按 authority 绑定**的，authority 取自 Host 头 —— 所以带
# `Host: agent.shanhaizaowu.com` 打回环，拿到的正是网关转发时需要的同一枚 cookie。
DSH_COOKIE=$(curl -s -D - -o /dev/null -m 20 "http://127.0.0.1:${DSH_PORT}/?token=${TOK}" \
	-H "Host: ${PUBLIC_HOST}" \
	-H 'Accept: text/html,application/xhtml+xml' -H 'User-Agent: Mozilla/5.0 Chrome/152.0' \
	-H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none' \
	| grep -i '^set-cookie' | sed -E 's/^set-cookie: ([^;]+);.*/\1/I' | head -1) || true
DSH_COOKIE=$(printf '%s' "$DSH_COOKIE" | tr -d '\r\n')
[ -n "$DSH_COOKIE" ] || { echo "  ✗ 取不到 DSH cookie（回环 + Host: ${PUBLIC_HOST}）；确认 dsh-web 在跑且 token 未失效"; exit 1; }
echo "  cookie 名: $(echo "$DSH_COOKIE" | cut -d= -f1 | cut -c1-28)…"

echo "==> 2/6 写环境文件（600，仅 root 可读）"
install -d -m 755 "$GATE_DIR"
COOKIE_SECRET=$(openssl rand -hex 32)
cat > /etc/agent-gate.env <<ENV
GATE_PORT=${GATE_PORT}
DSH_PORT=${DSH_PORT}
PUBLIC_HOST=${PUBLIC_HOST}
GATE_MAX_AGE_DAYS=365
GATE_PASSWORD=${PW}
COOKIE_SECRET=${COOKIE_SECRET}
DSH_COOKIE=${DSH_COOKIE}
ENV
chmod 600 /etc/agent-gate.env
echo "  已写 /etc/agent-gate.env"

echo "==> 3/6 安装网关程序与 systemd 单元"
install -m 755 -o root -g root /home/admin/agent-gate.mjs "$GATE_DIR/agent-gate.mjs"
cat > /etc/systemd/system/agent-gate.service <<UNIT
[Unit]
Description=Agent login gate (session cookie) → DSH
After=network-online.target dsh-web.service
Wants=network-online.target

[Service]
Type=simple
User=admin
EnvironmentFile=/etc/agent-gate.env
ExecStart=$(command -v node) ${GATE_DIR}/agent-gate.mjs
Restart=always
RestartSec=3
# 内存上限：与 harden-memory.sh 同一思路（按实际内存比例可再调）
MemoryAccounting=yes
MemoryHigh=96M
MemoryMax=256M
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

echo "==> 4/6 停用 Caddy（网关已接管 8080；源站少一个进程）"
systemctl disable --now caddy >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable --now agent-gate
sleep 3
systemctl is-active --quiet agent-gate || { echo "✗ agent-gate 未启动"; journalctl -u agent-gate -n 25 --no-pager; exit 1; }
echo "  agent-gate: active | caddy: $(systemctl is-active caddy 2>/dev/null || echo 未运行)"
echo "  隧道入口指向: $(grep -m1 'service:' /etc/cloudflared/config.yml | tr -d ' ')"

echo "==> 5/6 自检（关键：必须带公网 Host，并且要能区分「302 到登录页」与「200 但空body」）"
H="Host: ${PUBLIC_HOST}"
B="http://127.0.0.1:${GATE_PORT}"
printf "  未登录 → %s  跳转=%s（期望 302 + /__gate/login）\n" \
	"$(curl -s -o /dev/null -w '%{http_code}' -m 12 -H "$H" "$B/")" \
	"$(curl -s -o /dev/null -w '%{redirect_url}' -m 12 -H "$H" "$B/")"
printf "  登录页 → %s  body=%s 字节（期望 200 且非空）\n" \
	"$(curl -s -o /tmp/g1.html -w '%{http_code}' -m 12 -H "$H" "$B/__gate/login")" "$(wc -c < /tmp/g1.html | tr -d ' ')"
printf "  错密码 → %s（期望 401）\n" \
	"$(curl -s -o /dev/null -w '%{http_code}' -m 12 -H "$H" -d "password=wrong" "$B/__gate/login")"
COOKIE=$(curl -s -D - -o /dev/null -m 12 -H "$H" -d "password=${PW}" "$B/__gate/login" \
	| grep -i '^set-cookie' | sed -E 's/^set-cookie: (gate=[^;]+);.*/\1/I' | head -1)
[ -n "$COOKIE" ] || { echo "  ✗ 登录未下发 cookie"; exit 1; }
printf "  对密码 → 已下发 cookie（%.0f 字节），用它访问首页 → %s，正文 %s 字节\n" \
	"${#COOKIE}" \
	"$(curl -s -o /tmp/g2.html -w '%{http_code}' -m 20 -H "$H" -H "Cookie: $COOKIE" "$B/")" \
	"$(wc -c < /tmp/g2.html | tr -d ' ')"
grep -q 'DeepSeek Harness' /tmp/g2.html && echo "  ✓ 正文含 DeepSeek Harness（cookie 注入生效，无需 DSH token）" \
	|| { echo "  ✗ 正文不含 DSH 标记"; exit 1; }

echo "==> 6/6 完成"
echo "  任意设备打开 https://${PUBLIC_HOST}/ → 首次输密码，之后 365 天免登录。"
echo "  登录页：用户名不需要填，只填密码；密码见你运行本脚本时传入的值。"
echo "  改密码：sudo bash $(basename "$0") '<新密码>'（会重铸 DSH cookie 与签名密钥）"
echo "  退出登录：访问 https://${PUBLIC_HOST}/__gate/logout"
