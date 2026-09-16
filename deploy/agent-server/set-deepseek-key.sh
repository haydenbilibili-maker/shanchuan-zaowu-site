#!/usr/bin/env bash
#
# 把 DeepSeek API Key 安全写入 ~/.dsh/.credentials.yaml（合并，不覆盖已有会话记录）
#
# 用法（以 admin 身份执行）：
#   bash set-deepseek-key.sh sk-你的新key
#
# 设计要点：
#   · **不清空** 文件里的 records（浏览器会话记录由 DSH 自管；覆盖会把已登录会话踢掉）
#   · 幂等：refs 已存在就改值，不重复插入
#   · 写入前备份，写后校验 YAML 可解析、权限 600，并重启服务确认能起来
set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then echo "用法: bash set-deepseek-key.sh sk-xxxx"; exit 1; fi
case "$KEY" in
  sk-*) ;;
  *) echo "✗ key 应以 sk- 开头（收到的是 ${KEY:0:4}…）"; exit 1 ;;
esac
if [ "$KEY" = "sk-REPLACE_ME" ] || [ ${#KEY} -lt 20 ]; then
  echo "✗ 这看起来还是占位符或太短（长度 ${#KEY}）"; exit 1
fi

F="$HOME/.dsh/.credentials.yaml"
[ -d "$HOME/.dsh" ] || { echo "✗ $HOME/.dsh 不存在：DSH 还没运行过？"; exit 1; }
[ -f "$F" ] || { echo "✗ $F 不存在"; exit 1; }

cp -a "$F" "$F.bak.$(date +%s)"
echo "已备份：$(ls -t "$F".bak.* | head -1)"

python3 - "$F" "$KEY" <<'PY'
import re, sys, pathlib
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
lines = path.read_text(encoding='utf-8').splitlines()

has_refs = any(l.startswith('refs:') for l in lines)
if has_refs:
    out, done = [], False
    for l in lines:
        if re.match(r'^\s+DEEPSEEK_API_KEY:', l) and not done:
            out.append(f'  DEEPSEEK_API_KEY: {key}'); done = True
        else:
            out.append(l)
    if not done:  # refs 存在但没有这个键 → 插到 refs: 之后
        i = next(i for i, l in enumerate(out) if l.startswith('refs:'))
        out.insert(i + 1, f'  DEEPSEEK_API_KEY: {key}')
else:
    out, done = [], False
    for l in lines:
        out.append(l)
        if not done and l.startswith('version:'):
            out += ['refs:', f'  DEEPSEEK_API_KEY: {key}']; done = True
    if not done:
        out = ['version: 1', 'refs:', f'  DEEPSEEK_API_KEY: {key}'] + out
    # 保留原有 records 段（若有）

path.write_text('\n'.join(out) + '\n', encoding='utf-8')
print('refs.DEEPSEEK_API_KEY 已写入')
PY

chmod 600 "$F"

# 校验：YAML 可解析 且 键存在（不用 pyyaml，做结构级检查）
grep -q '^refs:' "$F" || { echo "✗ 写入后缺 refs 段"; exit 1; }
awk '/^refs:/{f=1;next} /^[a-z]/{f=0} f && /DEEPSEEK_API_KEY:/{ok=1} END{exit ok?0:1}' "$F" \
  || { echo "✗ DEEPSEEK_API_KEY 不在 refs 下"; exit 1; }
echo "结构校验通过（key 长度 ${#KEY}，值不回显）"

sudo systemctl restart dsh-web
sleep 10
S=$(systemctl is-active dsh-web)
echo "服务: $S"
[ "$S" = "active" ] || { echo "✗ 服务没起来，看 journalctl -u dsh-web -n 40"; exit 1; }
curl -s -o /dev/null -w "公网自检: http=%{http_code}（401 属正常）\n" -m 15 https://agent.shanhaizaowu.com/ || true
echo
echo "✅ 完成。注意：重启会生成**新的访问 token**，取法见 README："
echo "   sudo journalctl -u dsh-web | grep -o 'http://127.0.0.1:3080/?token=[^ ]*' | tail -1"
