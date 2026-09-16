#!/usr/bin/env bash
#
# DSH 常驻部署 · 阿里云轻量应用服务器（Ubuntu 22.04/24.04）
#
# 目标：dsh web 以 systemd 常驻 → 本地电脑关机后 agent 仍持续工作。
# 幂等：可重复执行；已存在的步骤会跳过。
#
# 用法（在服务器上，以有 sudo 权限的普通用户执行）：
#   bash install.sh
#
# 前置：DSH 的模型凭据**不由本脚本写入** —— 见 README「第 4 步」，
#       由你手工落到 ~/.dsh/.credentials.yaml（脚本不碰密钥，避免进 shell 历史）。
set -euo pipefail

DSH_VERSION="${DSH_VERSION:-0.1.5-rc.1}"
DSH_USER="${DSH_USER:-$USER}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
WORKSPACE="${WORKSPACE:-$HOME/shanchuanzaowu}"
REPO_URL="${REPO_URL:-git@github.com:haydenbilibili-maker/shanchuan-zaowu-site.git}"
DSH_PORT="${DSH_PORT:-3080}"
PUBLIC_HOST="${PUBLIC_HOST:-agent.shanhaizaowu.com}"
SWAP_GB="${SWAP_GB:-4}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

log "0/7 环境检查"
. /etc/os-release
echo "系统: $PRETTY_NAME | 架构: $(uname -m) | 用户: $DSH_USER"
[ "$(id -u)" -eq 0 ] && { echo "✗ 请勿用 root 直接跑（agent 会继承其权限）"; exit 1; }
if [ "$(uname -m)" != "x86_64" ] && [ "$(uname -m)" != "aarch64" ]; then
  echo "✗ 未验证的架构：$(uname -m)"; exit 1
fi

# 2 GiB 内存必须配 swap：实测 DSH 常驻 RSS ≈ 591 MB，而仓库 npm install / vite build
# 峰值可超过 1.5 GB —— 没有 swap 时构建会被 OOM killer 杀掉（表现为莫名的 exit 137）。
# 实测这台 Ubuntu 24.04 的 MemTotal 只有 **1651812 kB ≈ 1.58 GiB**（标称 2 GiB，虚拟化保留了一部分），
# 系统自用 ~360 MB，空闲仅 ~1.25 GiB ⇒ swap 取 4 GiB 留足余量（磁盘 40 GiB，占用可忽略）。
log "1/7 交换分区（${SWAP_GB} GiB）—— 1.58 GiB 实得内存的必需保险"
if swapon --show | grep -q .; then
  echo "已有 swap：$(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
else
  sudo fallocate -l "${SWAP_GB}G" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  sudo sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf >/dev/null
  echo "已创建 swap 并写入 fstab（开机自动挂载）"
fi
free -h | head -3

log "2/7 Node.js 22（DSH 要求 22+）"
if have node && [ "$(node -v | sed 's/v//;s/\..*//')" -ge 22 ]; then
  echo "已满足：$(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "已安装：$(node -v)"
fi
have pnpm || { sudo npm i -g pnpm@9 >/dev/null && echo "已安装 pnpm $(pnpm -v)"; }

log "3/7 安装 DSH（锁定版本 ${DSH_VERSION}）"
sudo npm i -g "@deepseek-ai/dsh@${DSH_VERSION}" >/dev/null
echo "已安装：$(dsh --version 2>/dev/null || echo '?')  ($(command -v dsh))"

log "4/7 工作区与 DSH_HOME"
mkdir -p "$DSH_HOME_DIR"

# 仓库是**私有**的（实测 GitHub API 返回 404；HTTPS 克隆会索要用户名）。
# 因此走 SSH + 仓库级 deploy key，且**必须勾选 Allow write access** —— agent 要提交推送。
if [ ! -f "$HOME/.ssh/github_deploy" ]; then
  echo "✗ 缺少 $HOME/.ssh/github_deploy。请先生成并把公钥加到仓库 Deploy keys（勾写权限）："
  echo "    ssh-keygen -t ed25519 -N '' -C 'dsh-agent-server@shanhaizaowu' -f ~/.ssh/github_deploy"
  echo "    cat ~/.ssh/github_deploy.pub     # 贴到 GitHub → Settings → Deploy keys → Allow write access"
  echo "    再写入 ~/.ssh/config：Host github.com / IdentityFile ~/.ssh/github_deploy / IdentitiesOnly yes"
  exit 1
fi
if ! ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -qE "successfully authenticated|You've successfully"; then
  echo "⚠ 未能确认 GitHub 认证（deploy key 可能还没加，或未勾写权限）。继续尝试克隆…"
fi

if [ -d "$WORKSPACE/.git" ]; then
  echo "工作区已存在，跳过克隆：$WORKSPACE"
else
  git clone "$REPO_URL" "$WORKSPACE"
fi
cd "$WORKSPACE"
echo "仓库：$(git log --oneline -1)"
echo "注意：monorepo 的 node_modules 约 688 MB、整仓约 1.1 GB —— 磁盘 40 GB 足够，但不要在服务器上跑重构建。"

log "5/7 systemd 服务（Restart=always + 开机自启 = 本地关机后仍工作）"
sudo tee /etc/systemd/system/dsh-web.service >/dev/null <<UNIT
[Unit]
Description=DeepSeek Harness Web UI (dsh web)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${DSH_USER}
Environment=DSH_HOME=${DSH_HOME_DIR}
Environment=NODE_ENV=production
# 只绑回环：公网入口交给 cloudflared 隧道，服务器不开放任何入站端口
# --trusted-host：/api 的 browser-trust fence 只接受可信 authority（实测伪造 Host → 403）
ExecStart=$(command -v dsh) web --host 127.0.0.1 --port ${DSH_PORT} --no-open --trusted-host ${PUBLIC_HOST}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-web
sleep 3
systemctl is-active --quiet dsh-web && echo "dsh-web：已启动并设为开机自启" || { echo "✗ 启动失败，看：journalctl -u dsh-web -n 40"; exit 1; }

log "6/7 回环自检"
curl -s -o /dev/null -w "127.0.0.1:${DSH_PORT} → http=%{http_code}（401 属正常：需会话鉴权）\n" -m 8 "http://127.0.0.1:${DSH_PORT}/" || true
echo "伪造 Host 必须被拒（应 403）："
curl -s -o /dev/null -w "  Host: evil.example.com → http=%{http_code}\n" -m 8 -H "Host: evil.example.com" "http://127.0.0.1:${DSH_PORT}/api/config" || true

log "7/7 下一步（手工，见 README）"
cat <<'NEXT'
  ① 写模型凭据：~/.dsh/.credentials.yaml（本脚本刻意不碰）
  ② 建隧道：cloudflared tunnel login / create / route dns
  ③ 装 cloudflared 服务：sudo cloudflared service install <token>
  ④ Cloudflare Access 加登录策略（务必做：DSH 的 fence 不是用户登录）
NEXT
