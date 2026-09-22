# DSH 常驻部署（云服务器 + agent.shanhaizaowu.com）

> 目标：把 DeepSeek Harness 挂到云服务器上**持续运行** ——
> ① 服务器常驻（systemd，开机自启 + 崩溃自恢复）；② 只需登录 `agent.shanhaizaowu.com` 即可操作；
> ③ **本地电脑关机/断网，agent 照常工作**。

## 一、架构（为什么长这样）

```
你的浏览器 ──https──▶ agent.shanhaizaowu.com
                       │  Cloudflare：DNS + TLS + **Access 登录**（真鉴权）
                       ▼
                 cloudflared 隧道 ── 由服务器**主动外连**（出站，无需公网 IP / 无需开入站端口）
                       ▼
            服务器 127.0.0.1:3080
              dsh web --host 127.0.0.1 --port 3080 --trusted-host agent.shanhaizaowu.com
                       ▲
              systemd: Restart=always + WantedBy=multi-user.target   ← 这条实现目标 ③
```

三个设计取舍及其理由：

| 取舍 | 理由 |
|---|---|
| 用 **隧道**而不是 A 记录直连 | 不需要公网 IP、不需要在阿里云防火墙开 80/443、TLS 交给 Cloudflare；且能在前面叠 Access 鉴权 |
| `dsh web` **只绑回环** | 服务器不暴露任何入站端口；唯一入口是隧道 |
| 必须加 **Cloudflare Access** | 见下面的「安全边界」——DSH 自带的 fence **不是**用户登录 |

## 二、安全边界（**别跳过这一段**）

实测（对本地运行中的实例）：

```
Host: 127.0.0.1:3080        → /api/config  http=401 unauthorized   ← 需要会话
Host: agent.shanhaizaowu.com→ /api/config  http=403 forbidden      ← fence 不认这个 authority
Host: evil.example.com      → /api/config  http=403 forbidden
```

结论：
- DSH 有**两层**防护：`/api` 的 browser-trust fence（按 authority 判，403）+ 会话鉴权（401）。
- 但 fence 是**同源/CSRF 防护，不是用户身份认证**。`--trusted-host` 只是把公开域名加进白名单，
  它**不会**要求来访者证明自己是谁。
- 而 agent 在服务器上**能执行任意命令**，能读仓库、能读 `~/.dsh/.credentials.yaml`（模型 key）。
  ⇒ 公网入口**必须**叠加 Cloudflare Access（邮箱 OTP / GitHub / Google），把它当管理后台。
- 另外：**不要用 root 跑**（否则 agent 继承 root 权限）；`install.sh` 会拒绝 root。

## 三、服务器评估（阿里云轻量 · 现有实例能否复用）

现有实例（阿里云轻量应用服务器，控制台可见）：华东2（上海），
**通用型 2 vCPU / 2 GiB / ESSD 40 GiB**，镜像 `OpenClaw 2026.2.26`，到期 2027-03-08。

> ⚠ **仓库是私有的**（实测 GitHub API 返回 404；匿名 HTTPS 克隆会索要用户名）。
> 服务器通过**仓库级 deploy key** 访问，且**必须勾选 Allow write access**（agent 要提交推送，见第 4 步）。
> 另：实例名 / 实例 ID / 公网 IP **刻意不写进本文件**（即便仓库私有也保持最小暴露），
> 部署时用占位符替换：`<SERVER_IP>`、`<INSTANCE_ID>`、`<SSH_USER>`。

实测需求（在开发机上量的）：

| 项 | 实测 | 与服务器对比 |
|---|---|---|
| DSH 常驻 RSS | **591 MB** | 2 GiB 可容纳 |
| monorepo 含 node_modules | **1.1 GB**（node_modules 688 MB） | 40 GiB 余量充足 |
| DSH_HOME | **72 MB** | 忽略不计 |
| Node 要求 | **22+**（本机 v22.22.1） | `install.sh` 装 Node 22 |

**结论：可以复用**，但有两个前提：

1. **必须加 swap**（`install.sh` 已做，默认 **4 GiB**）。
   > **实测纠正**：这台 Ubuntu 24.04 的 `MemTotal` 只有 **1651812 kB ≈ 1.58 GiB**
   > （标称 2 GiB，虚拟化保留了一部分），系统自用 ~360 MB，**空闲仅 ~1.25 GiB**。
   > DSH 常驻 ~591 MB 上去后只剩 ~660 MB，而仓库 `npm install` / `vite build` 峰值常超 1.5 GB
   > —— **没有 swap 会被 OOM killer 杀掉**（症状是莫名的 `exit 137`）。故 swap 取 4 GiB。
   > 建议：服务器上**不做重构建**，构建放本地或 CI。服务器只跑 agent + 轻量 git 操作。
2. **确认那台实例上的 OpenClaw 还要不要用**。
   它是阿里云的「定制专属 AI 助理」镜像，当前**运行中**，会占内存/端口。
   2 GiB 上让 OpenClaw 与 DSH 共存有资源争抢风险。三种处理：
   - **推荐**：如果 OpenClaw 没在用 → 换系统镜像为 **Ubuntu 24.04**（干净、可预期）；
   - 保留镜像 → 需要先量一下 OpenClaw 的实际占用，再决定 DSH 的并发上限；
   - 另购一台轻量（同规格即可）专用于 DSH。

   **如果是换镜像：注意会清空该实例系统盘，先确认里面没有你要留的数据。**

## 四、前置条件（需要你做的）

0. **仓库是私有的 → 加 deploy key**（只读不够，agent 要推送）：
   服务器已生成 `~/.ssh/github_deploy`，把它的 `.pub` 贴到
   GitHub 仓库 → **Settings → Deploy keys → Add deploy key**，并**勾选 Allow write access**。
1. **绑定 SSH 公钥**：阿里云控制台 → 轻量应用服务器 → 密钥对 → 导入公钥 → 绑定到该实例。
   公钥见对话中我给的那一串（`ssh-ed25519 AAAA… dsh-agent-server`），私钥在**你本机**
   `~/.ssh/dsh_agent_server`，不经对话传输。
   （若实例已经在用「设置密码」方式，也可以直接给密码，但公钥方式更安全、也便于我后续操作。）
2. ~~确认 OpenClaw 去留~~ → **已解决**：实例已重置为 Ubuntu 24.04，OpenClaw 不再存在。
3. Cloudflare：确认 `shanhaizaowu.com` 的 DNS 在你可管理的 Cloudflare 账号下
   （Pages 项目 `shanchuan-zaowu-site` 已在该账号，应该没问题），
   并且你有权限建 **Zero Trust → Access** 应用。

## 四之补：部署进度（2026-09-17 实测）

| 步骤 | 状态 |
|---|---|
| 阿里云实例重置为 Ubuntu 24.04，SSH 公钥绑定 | ✅ 已完成（`admin` 用户，NOPASSWD sudo） |
| swap 4 GiB | ✅ 已建（`/swapfile`，写入 fstab） |
| Node.js | ✅ v22.23.2 |
| pnpm | ✅ 9.15.9 |
| `dsh` 全局安装 | ✅ 0.1.5-rc.1（`/usr/bin/dsh`） |
| 仓库克隆 | ✅ 落在 `2db36dc` |
| 模型凭据 `.credentials.yaml` | ✅ `refs.DEEPSEEK_API_KEY` 已写；**独立验证**：`api.deepseek.com/v1/models` → `http=200`，131ms，返回 `deepseek-flash`/`deepseek-v4-pro` |
| `settings.yaml`（默认模型） | ✅ `provider: deepseek-official` / `model: deepseek-flash` / `reasoningEffort: high`（不设会卡在 onboarding） |
| systemd `dsh-web` 常驻 | ✅ active + enabled，90s 观测端口持续 UP、`NRestarts=0` |
| cloudflared 隧道 + DNS CNAME | ✅ connector 2 条边缘连接；`agent.shanhaizaowu.com` → 隧道 |
| `--trusted-host` fence | ✅ 可信域名→401（接受）、伪造 Host→403（拒绝） |
| **浏览器端到端** | ✅ 无头 Chrome 打开 `https://agent.shanhaizaowu.com/?token=…`：token 被消费、跳转到 `/`，标题 **DeepSeek Harness**，UI 正常渲染（「新会话 / 工作区 / 设置 / 选择工作区」） |
| Cloudflare Access 登录策略 | ⏳ 待做（**必做**：fence 不是用户登录） |

### 运维要点（实测踩到的）

1. **入口可以固定收藏 —— token 只需用一次。** 机制（读 `dsh-client-connection/lib/types/browser-auth.d.ts` 得出）：
   | 机制 | 生命周期 | 作用 |
   |---|---|---|
   | `launchToken`（启动时打印） | **每进程随机**，重启即变 | **一次性**换取 cookie |
   | **签名 cookie** | 由**持久化签名密钥**签发（存于 `.credentials.yaml`） | 真正的会话凭据，**重启不失效** |

   ⇒ DSH **没有**「固定 token」配置项，也**不需要**：cookie 在有效期内一直有效。
   登录一次后把 `https://agent.shanhaizaowu.com/` 加入书签即可。
   cookie 有效期默认 **30 天**，本部署已改为 **365 天**（见下方 patch）。

2. **cookie 有效期（已配置为 30 天）**：`~/.dsh/profiles/web/cordis.patch.yml`
   ```yaml
   - id: connection                 # ← 注意：是 connection，不是包名 dsh-client-connection
     config:
       trustedHosts: !!js ctx.webRuntime.trustedHosts
       cookieMaxAgeDays: 30
   ```
   实测：`Set-Cookie … Max-Age=2592000`（30 天）。
   > 决策（2026-09-17）：**暂不开通 Cloudflare Access**（其开通流程要求绑银行卡），
   > 先依赖 DSH 自带会话鉴权（签名 cookie + 每进程随机 launch token + Host 白名单）。
   > 既然没有外层兜底，有效期从 365 天**收回 30 天**以缩小暴露窗口。
   **两个坑**（都踩过）：
   - **行 id 写错会静默忽略**（无任何报错）。正确 id 取自 `dsh --profile web --dump-config`
     的 `- id:` 字段，不是包名。验证方式就是 dump 里能搜到 `cookieMaxAgeDays`。
   - **patch 会整体替换该行 `config`** ⇒ `trustedHosts` 必须一起重述，否则退回空数组，
     公网域名立刻被 fence 判 **403**。这里沿用 bundle 的 `!!js` 表达式，保留 `--trusted-host` 通路。
   **另一个实测发现**：profile 的 `patchReload: live` ⇒ patch 文件改动**热生效，无需重启**。
   而 DSH 会校验「cookie 生命周期 ≤ cookieMaxAgeDays」，所以**把该值调小会让所有更长寿的 cookie 立刻失效**。

3. **强制下线所有浏览器**：`bash ~/rotate-agent-token.sh`
   **注意：只重启服务是不够的** —— launch token 每进程随机，但 cookie 是用
   `.credentials.yaml` 里**持久化的签名密钥**签发的（见 `browser-auth` 的
   `create(processOwner, credentials, maxAgeDays)` → `initializeSecret`）。
   必须**轮换签名密钥**才能真正踢掉已登录的浏览器。脚本会：备份 → 保留 `refs`（DeepSeek key）→
   清空 `records`（含签名密钥）→ 重启 → 校验新密钥/服务/端口/fence → 打印新登录链接。
   实测对照：轮换前该 cookie 访问 `/` = **200**，轮换后 = **401** ✓

4. **何时需要重新取 token**：换浏览器/设备、清了 cookie、或跑过轮换脚本。取法（**必须用精确模式**）：
   ```bash
   sudo journalctl -u dsh-web --no-pager | grep -o 'dsh web: http://127.0.0.1:3080/?token=[^ ]*' | tail -1
   ```
   把 `http://127.0.0.1:3080` 换成 **`https://agent.shanhaizaowu.com`**。
   ⚠ 别用宽松的 `grep -o 'token=[^ ]*'` —— 会抓到日志里其它 20 字符的假值（真正的 launch token 是 **43 字符**）。
   token **只在浏览器里有效**：`?token=` / `Authorization: Bearer` / `Cookie` 三种方式实测都仍 401，
   且换取 cookie 时**必须带浏览器式请求头**（`Accept: text/html` + `Sec-Fetch-*`），否则同样 401。

4. **首次登录需要在 UI 里选工作区**：服务器上的仓库在 `/home/admin/shanchuanzaowu`。

5. **GitHub 直连被限速**：服务器拉 GitHub Releases 会超时（实测 20 MB/300s 后断开），
   装 cloudflared 时改走「本机下载 → scp」。这也意味着**别在服务器上跑重构建或大克隆**。

6. 加了 Access 之后建议**重启一次 `dsh-web` 轮换 launch token**，把已经出现在对话记录里的旧 token 作废
   （不影响已签发的 cookie）。




## 四点五、⚠️ 在服务器上跑重活的三条纪律（2026-09-22 **真事故**后补）

**事故**：`agent.shanhaizaowu.com` 返回 Cloudflare **524**（origin timeout），控制台看服务器"运行中"。
上机核查发现：`dsh-web` 端口在听、但**回环 `/api/config` = `000`（20s 超时）**；
load **9.0**（2 vCPU）、`dsh-web.service` 的 cgroup 内存 **2.08 / 2.22 GB（94%）**。

**根因（自伤，不是被攻击）**：agent 在服务器上执行的命令是 `dsh-web.service` 的**子进程**，
因此计入**同一个 cgroup**。当时有 **12 个验证/构建进程卡死了 9.8 小时**没被收拾
（两套 `run-guards.mjs`、`astro check` 522 MB、`vite` dev 269 MB、`check-sfc-dev-transform` 386 MB…共 ~1.5 GB），
把 web 自己的内存配额顶满 ⇒ Node 无法响应 ⇒ 524。

**处置**：kill 掉那 12 个（全是 `/tmp/wt-*` 里可重跑的验证跑）→ 回环立刻恢复 **401 / 0.26s**、
cgroup 降到 **0.88 GB**、系统可用内存 860 MB → **2189 MB**。

### 三条纪律（照做就不会再发生）

1. **内循环只用 `npm run check:quick -- <域>`（约 2.5s）** —— 和本地同一条节奏。
   **不要在服务器上跑全套 `check:admin`**（111 条、~125s、CPU 密集），除非确实要收口。
2. **重活必须走包装器**（跑进**独立 cgroup** + 硬超时，不再挤占 web 的 2.22 GB 配额）：
   ```bash
   dsh-heavy-task npm run check:admin                       # 默认 25 分钟超时 / 1.2 GB 上限
   dsh-heavy-task --timeout 10min --memory 800M npm run test:wish-wall
   dsh-heavy-task --list                                    # 看有没有在跑的 heavy 单元
   ```
   实测（决定性验证）：在 `--memory 200M` 的单元里申请 400 MB → 该单元自己被 `Killed`，
   同时 `dsh-web` 仍 `401 / 0.198s` ✓。
3. **别在服务器上开常驻 dev server 或跑重构建**：`vite` / `astro check` / 大克隆会一直挂着占内存
   （本仓 README 早有"GitHub 直连被限速、别在服务器上跑重构建"的提示，这次是它的加重版）。
   需要浏览器验证的活，回本地做。

### 兜底：看门狗（已安装并启用）
`dsh-heavy-watchdog.timer` 每 10 分钟扫一次，**任何跑超过 30 分钟**的验证/构建进程会被 TERM→KILL 并记日志
（只按命令行特征匹配 `/tmp/wt-*`、`run-guards`、`astro check`、`vite`、`check-sfc-dev-transform`、`test-wish-wall`；
永不碰 `dsh web` / `cloudflared` / `sshd`）。
```bash
systemctl list-timers dsh-heavy-watchdog.timer     # 下次触发时间
DRY_RUN=1 /usr/local/bin/dsh-heavy-watchdog        # 只看会杀谁
tail -f /var/log/dsh-heavy-watchdog.log            # 杀了谁
# 现场处置（某个 heavy 单元跑太久）：systemctl stop dsh-heavy-<时间戳>.scope
```
脚本源码在本目录：`heavy-task.sh` / `heavy-task-watchdog.sh`（改完 scp 到 `/usr/local/bin/dsh-heavy-task`、
`/usr/local/bin/dsh-heavy-watchdog`，权限 755）。

---

## 五、执行步骤

### 1) 上机 + 基础部署（我在服务器上执行）

```bash
ssh -i ~/.ssh/dsh_agent_server <SSH_USER>@<SERVER_IP>
# 拷入本目录后：
bash install.sh
```

`install.sh` 做 7 件事（幂等）：环境检查 → 建 swap → 装 Node 22 + pnpm → 装 `dsh@0.1.5-rc.1`
→ 克隆 monorepo 到 `~/shanchuanzaowu` → 写 systemd 单元并 `enable --now` → 回环自检。
**它刻意不碰模型凭据**（避免密钥进 shell 历史）。

### 2) 写模型凭据（你在服务器上手工做，不要把 key 贴进对话）

新申请一把**专用** key（与本地隔离，泄露可单独吊销），然后：

```bash
mkdir -p ~/.dsh && chmod 700 ~/.dsh
cat > ~/.dsh/.credentials.yaml <<'YAML'
# 结构以本机 ~/.dsh/.credentials.yaml 为准（字段名照抄，值换成新 key）
YAML
chmod 600 ~/.dsh/.credentials.yaml
sudo systemctl restart dsh-web
```

> 我会先把本机 `.credentials.yaml` 的**字段结构**（不含值）读出来告诉你，确保格式一致。

### 3) 建隧道 + DNS（我在服务器上执行）

```bash
# 二选一：控制台建隧道拿 token（推荐），或：
cloudflared tunnel login
cloudflared tunnel create dsh-agent
cloudflared tunnel route dns dsh-agent agent.shanhaizaowu.com
sudo cp cloudflared-config.yml /etc/cloudflared/config.yml   # 填 <TUNNEL-ID>
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### 4) Cloudflare Access 登录策略（**必需**，你在控制台做，或给我 Token 我来做）

Zero Trust → Access → Applications → Add：
- Self-hosted，域名 `agent.shanhaizaowu.com`
- Policy：Allow，条件选你的邮箱（One-time PIN）或 GitHub/Google 登录
- Session 时长建议 ≤ 24h

## 六、验收清单（每条都要能证伪）

| # | 检查 | 期望 |
|---|---|---|
| 1 | `systemctl is-enabled dsh-web` | `enabled` |
| 2 | `systemctl is-active dsh-web` | `active` |
| 3 | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/` | `401`（要会话，属正常） |
| 4 | 伪造 Host：`curl -H 'Host: evil.example.com' …/api/config` | `403`（fence 生效） |
| 5 | 浏览器开 `https://agent.shanhaizaowu.com` | 先要求 Access 登录，再进 UI |
| 6 | **关掉你的电脑**，10 分钟后用手机流量打开子域 | UI 仍可用、agent 仍在跑 ← **目标 ③ 的直接验证** |
| 7 | `sudo reboot` 后（不手工启动任何东西） | 服务自动恢复（验证 `WantedBy` + enable） |
| 8 | 服务器未开放入站端口 | 阿里云防火墙保持默认；`ss -tlnp` 只见 127.0.0.1:3080 |

## 七、运维

```bash
journalctl -u dsh-web -f            # 实时日志
sudo systemctl restart dsh-web      # 重启
dsh --version                       # 当前版本
sudo npm i -g @deepseek-ai/dsh@<新版本> && sudo systemctl restart dsh-web   # 升级
```

回滚：`sudo npm i -g @deepseek-ai/dsh@0.1.5-rc.1 && sudo systemctl restart dsh-web`。
配置与凭据都在 `~/.dsh/`（`settings.yaml` / `.credentials.yaml` / `profiles/` / `sessions/`），
备份/迁移直接打包该目录。

## 八、待办（按依赖顺序）

- [ ] 你确认 OpenClaw 去留 + 绑定 SSH 公钥 → 我上机执行第 1 步
- [ ] 我读出本机 `.credentials.yaml` 的字段结构（不含值）→ 你申请新 key 并写入
- [ ] 建隧道 + Access（第 3、4 步）
- [ ] 验收清单 1–8 逐条过
- [ ] **ERP 导航入口**：在 ERP 里加一个指向 `agent.shanhaizaowu.com` 的入口。
      注意 ERP 现有导航是「模块 id ↔ 组件」模型，外链需要新增一种条目类型
      （`modulesRegistry` + `adminNavDomains` + `App.vue` 三处），属于要在本地开发并自证的改动，
      与服务器部署解耦，可并行推进。
