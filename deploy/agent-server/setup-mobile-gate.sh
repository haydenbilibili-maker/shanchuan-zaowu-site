#!/usr/bin/env bash
#
# 多端入口：在 cloudflared 与 DSH 之间加一层「共享密码 + 代注入会话 cookie」
#
#  手机/平板/任意电脑 → agent.shanhaizaowu.com → cloudflared → Caddy(127.0.0.1:8080)
#                                                              ├ Basic Auth 校验
#                                                              ├ 注入长效 DSH 会话 cookie
#                                                              └ 反代 → DSH 127.0.0.1:3080（保留 Host）
#
# 为什么需要它：DSH 的 launch token 由 randomBytes() 生成、只存在进程内存里
# （见 dsh-client-connection 的 processLaunchToken），所以**每个浏览器都要用当期 token
# 换一次 cookie**，且没有「固定 token / 关闭鉴权」的配置项。对多端办公来说这是硬伤。
# 本层把这件事挡在外面：任意设备只需输一次密码（浏览器会记住）。
#
# 用法：sudo bash setup-mobile-gate.sh '<密码>'
set -euo pipefail

PW="${1:-}"
[ -n "$PW" ] || { echo "用法: sudo bash setup-mobile-gate.sh '<密码>'"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "✗ 需要 root（要写 /etc/caddy 与 /etc/cloudflared）"; exit 1; }

PUBLIC_HOST=agent.shanhaizaowu.com
DSH_PORT=3080
GATE_PORT=8080
PATCH_FILE="/home/admin/.dsh/profiles/web/cordis.patch.yml"

echo "==> 1/6 把 cookie 有效期设为 365 天"
# 前提：有 Basic Auth 挡在前面，所以可以放长（缩短暴露窗口的动机已由外层承担）
cat > "$PATCH_FILE" <<YML
# 用户 patch 层（在 dsh-base / dsh-web-app 之后应用）
#
# cookieMaxAgeDays = 365（默认 30）。放长的前提是前面有 Caddy Basic Auth 兜底：
# 真正决定「谁能进来」的已经变成那层密码，而不是这枚 cookie 的时长。
#
# 两个坑（实测踩过）：
#   1. 行 id 是 connection，不是包名 dsh-client-connection —— 写错会静默忽略，无报错。
#   2. patch 会整体替换该行 config，所以 trustedHosts 必须一起重述；
#      这里沿用 bundle 的表达式写法，保留 --trusted-host 这条既有通路。
- id: connection
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    cookieMaxAgeDays: 365
YML
chown admin:admin "$PATCH_FILE"
echo "    patch 已写入（patchReload: live，会热生效）"

echo "==> 2/6 用当期 token 铸造一枚长效 cookie"
sudo -u admin bash -c '
  TOK=$(sudo journalctl -u dsh-web --no-pager 2>/dev/null | grep -o "dsh web: http://127.0.0.1:3080/?token=[^ ]*" | tail -1 | sed "s/.*token=//")
  [ ${#TOK} -eq 43 ] || { echo "✗ 取到的 token 长度异常：${#TOK}（应为 43）"; exit 1; }
  curl -s -D /tmp/gate-hdr.txt -o /dev/null -m 25 "https://'"$PUBLIC_HOST"'/?token=$TOK" \
    -H "Accept: text/html,application/xhtml+xml" -H "User-Agent: Mozilla/5.0 Chrome/152.0" \
    -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" -H "Sec-Fetch-Site: none"
'
COOKIE=$(grep -i '^set-cookie' /tmp/gate-hdr.txt | sed -E 's/^set-cookie: ([^;]+);.*/\1/I')
[ -n "$COOKIE" ] || { echo "✗ 未取到 cookie（token 可能已过期，重启服务后重跑本脚本）"; exit 1; }
echo "    cookie 名: $(echo "$COOKIE" | cut -d= -f1)"
echo "    有效期: $(grep -io 'max-age=[0-9]*' /tmp/gate-hdr.txt)"

echo "==> 3/6 生成 Basic Auth 口令哈希"
HASH=$(caddy hash-password --plaintext "$PW")
echo "    已生成 bcrypt 哈希（长度 ${#HASH}）"

echo "==> 4/6 写 /etc/caddy/Caddyfile"
install -d -m 755 /etc/caddy
cat > /etc/caddy/Caddyfile <<CADDY
{
	# 只监听回环、由 cloudflared 转发进来，因此不需要 Caddy 自己管 TLS
	auto_https off
	admin off
}

127.0.0.1:${GATE_PORT} {
	# Caddy 2.6 的指令名是 basicauth（2.7+ 才叫 basic_auth）
	basicauth {
		admin ${HASH}
	}

	reverse_proxy 127.0.0.1:${DSH_PORT} {
		# 关键：保留公网 Host，否则 DSH 的 browser-trust fence 会判 403
		header_up Host {http.request.host}
		# 代注入 DSH 会话 cookie —— 设备端因此不再需要 launch token
		header_up Cookie "${COOKIE}"
	}
}

# 说明：不要在这里加 header_down 之类改写，DSH 的 /api 会校验 Host/Origin 一致性。
CADDY
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && echo "    Caddyfile 校验通过" || { echo "✗ Caddyfile 校验失败"; caddy validate --config /etc/caddy/Caddyfile; exit 1; }

echo "==> 5/6 重启 Caddy，并把隧道指向网关"
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 3
systemctl is-active --quiet caddy && echo "    caddy: active" || { echo "✗ caddy 未启动"; journalctl -u caddy -n 20 --no-pager; exit 1; }

CFG=/etc/cloudflared/config.yml
if grep -q "127.0.0.1:${DSH_PORT}" "$CFG"; then
	sed -i "s|http://127.0.0.1:${DSH_PORT}|http://127.0.0.1:${GATE_PORT}|" "$CFG"
	echo "    隧道入口: 127.0.0.1:${DSH_PORT} → 127.0.0.1:${GATE_PORT}"
fi
systemctl restart cloudflared
sleep 5
systemctl is-active --quiet cloudflared && echo "    cloudflared: active" || echo "    ⚠ cloudflared 状态: $(systemctl is-active cloudflared)"

echo "==> 6/6 自检"
printf "  无密码        → %s（期望 401，由 Caddy 拒绝）\n" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 15 "http://127.0.0.1:${GATE_PORT}/")"
printf "  错误密码      → %s（期望 401）\n" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -u "admin:wrong" "http://127.0.0.1:${GATE_PORT}/")"
printf "  正确密码      → %s（期望 200 = 直接进 DSH，无需 token）\n" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 20 -u "admin:${PW}" "http://127.0.0.1:${GATE_PORT}/")"
echo
echo "完成。任意设备打开 https://${PUBLIC_HOST}/ ，输入 用户名 admin / 你设的密码 即可。"
echo "注意：本脚本用当期 launch token 铸造 cookie；若日后跑过 rotate-agent-token.sh"
echo "（轮换签名密钥），注入的 cookie 会失效 —— 重跑本脚本即可刷新。"
