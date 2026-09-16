#!/usr/bin/env bash
#
# 强制下线所有浏览器 + 打印新的登录链接
#
# ⚠ 为什么必须轮换**签名密钥**而不能只重启服务：
#   launch token 是每进程随机的，重启就变；但浏览器会话 cookie 是用
#   `.credentials.yaml` 里**持久化的签名密钥**签发的（见 dsh-client-connection
#   的 browser-auth：`create(processOwner, credentials, maxAgeDays)` →
#   `initializeSecret(credentials)`）。所以**只重启不会让已登录的浏览器掉线**。
#   要让旧 cookie 立即失效，必须删掉那条密钥记录，让 DSH 重新生成。
#
# 本脚本会：
#   1. 备份 .credentials.yaml
#   2. **保留 `refs`（DeepSeek key）**，清掉 `records`（含签名密钥）
#   3. 重启 dsh-web
#   4. 校验：新密钥已生成、服务在跑、fence 正常、并打印新的登录链接
#
# 用法：bash rotate-agent-token.sh
set -euo pipefail

F="$HOME/.dsh/.credentials.yaml"
[ -f "$F" ] || { echo "✗ $F 不存在"; exit 1; }

BAK="$F.bak.$(date +%s)"
cp -a "$F" "$BAK"
echo "已备份: $BAK"

# 用 Python 精确重构：保住 refs，清掉 records
python3 - "$F" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

m = re.search(r'^refs:\n((?:[ \t]+.*\n)*)', s, re.M)
refs_block = m.group(0) if m else 'refs: {}\n'

# 诊断：确认我们确实丢掉了 records（否则等于没轮换）
had_records = bool(re.search(r'^records:', s, re.M))
had_secret = 'secret' in s

p.write_text('version: 1\n' + refs_block + 'records: {}\n', encoding='utf-8')
print(f'  原文件含 records: {had_records} / 含 secret: {had_secret}')
print('  已重建：保留 refs，清空 records')
PY

chmod 600 "$F"

# 校验 refs 里的 key 没丢
grep -q 'DEEPSEEK_API_KEY' "$F" || { echo "✗ DeepSeek key 丢了，正在回滚"; cp -a "$BAK" "$F"; exit 1; }
echo "  DeepSeek key 保留 ✓"

sudo systemctl restart dsh-web
sleep 14

S=$(systemctl is-active dsh-web)
echo "服务: $S"
[ "$S" = "active" ] || { echo "✗ 服务未启动，看 journalctl -u dsh-web -n 40"; exit 1; }
ss -tln 2>/dev/null | grep -q ':3080' && echo "端口: UP" || { echo "✗ 3080 未监听"; exit 1; }

# 校验签名密钥确实换了（reload 后应重新生成一条 secret）
NEW=$(python3 -c "
import pathlib,re
s=pathlib.Path.home().joinpath('.dsh/.credentials.yaml').read_text()
print('有' if 'secret' in s else '无')
")
echo "新签名密钥已生成: $NEW"
[ "$NEW" = "有" ] || { echo "✗ 未生成新密钥"; exit 1; }

# fence 复核
printf "fence 复核: 可信域名→%s  伪造 Host→%s（应为 401 / 403）\n" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H "Host: agent.shanhaizaowu.com" http://127.0.0.1:3080/api/config)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H "Host: evil.example.com" http://127.0.0.1:3080/api/config)"

echo
echo "=== 新的登录链接（旧 cookie 已全部失效）==="
# 注意必须用**精确**模式匹配启动行：宽松的 `token=[^ ]*` 会抓到日志里其它
# 短 token 片段（实测抓到过 20 字符的假值）。真正的 launch token 是 43 字符。
sudo journalctl -u dsh-web --no-pager 2>/dev/null \
  | grep -o 'dsh web: http://127.0.0.1:3080/?token=[^ ]*' | tail -1 \
  | sed -e 's|^dsh web: ||' -e 's|http://127.0.0.1:3080|https://agent.shanhaizaowu.com|'
echo
echo "把这个链接在浏览器打开一次即可（之后可收藏 https://agent.shanhaizaowu.com/）"
