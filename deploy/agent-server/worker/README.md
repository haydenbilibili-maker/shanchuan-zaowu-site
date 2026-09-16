# 边缘网关（Cloudflare Worker）—— 多端访问 + 零源站开销

替代原先放在**源站**的 Caddy 网关。原因见 `harden-memory.sh` 头部：源站只有 1.58 GiB，
再挂一个常驻进程会把整机拖死（实测假死到 SSH 拿不到 banner、隧道掉线 530、控制台卡「停止中」）。
Worker 跑在 Cloudflare 边缘，**源站只剩 DSH + cloudflared**。

```
任意设备 → agent.shanhaizaowu.com ──[Worker: Basic Auth + 注入 DSH cookie]──▶
          agent-origin.shanhaizaowu.com ──[Tunnel]──▶ 127.0.0.1:3080 (DSH)
```

## ⚠ 两个必须理解的陷阱

### 1. 循环请求（Worker 挂在隧道域名上时最致命的坑）

Worker 的 Route 是 `agent.shanhaizaowu.com/*`。如果 Worker 里 fetch 同一个主机名，
请求会**再次命中这个 Worker**，无限循环（508 / 超时）。

⇒ 所以给隧道挂**第二个主机名**当「源站名」，Worker 只 fetch 它：

| 主机名 | 用途 | 谁访问 |
|---|---|---|
| `agent.shanhaizaowu.com` | 用户入口 | 你的设备（经 Worker） |
| `agent-origin.shanhaizaowu.com` | Worker 的 fetch 目标 | **只有 Worker** |

### 2. 防绕过（第二个主机名默认是公开可访问的！）

`agent-origin…` 同样经隧道映射到 DSH。若不管它，**任何人都能绕过 Basic Auth 直连它**，
因为这个主机名上**没有 Worker**。必须用 **WAF 自定义规则**把它锁掉：

> Cloudflare 面板 → 你的域名 → **Security → WAF → Custom rules** → Create rule
> - Name: `block-direct-origin`
> - Expression（编辑表达式模式）：
>   ```
>   (http.host eq "agent-origin.shanhaizaowu.com" and not any(http.request.headers["x-gate-secret"][*] eq "<一段随机串>"))
>   ```
> - Action: **Block**

然后在 Worker 里给转发请求加上同一个头（本仓库的 `wrangler.toml` 未内置该头，
请把下面这段加进 `src/index.js` 的 `headers` 设置处）：

```js
headers.set('x-gate-secret', env.GATE_SECRET)   // 并在 wrangler.toml 的 [vars] 里加 GATE_SECRET
```

> 免费版 WAF 自定义规则有配额（5 条），用 1 条足够。
> **若你不想配 WAF**：那就不要用双主机名方案，改用下面的「回退方案 A」。

## 部署步骤

### 1) 给隧道加第二个主机名（在服务器上）

```bash
sudo tee -a /etc/cloudflared/config.yml >/dev/null <<'YML'
YML
# 正确做法：编辑 /etc/cloudflared/config.yml，把 ingress 改成两条 hostname：
#   - hostname: agent.shanhaizaowu.com
#     service: http://127.0.0.1:3080
#   - hostname: agent-origin.shanhaizaowu.com
#     service: http://127.0.0.1:3080
#   - service: http_status:404
cloudflared tunnel route dns dsh-agent agent-origin.shanhaizaowu.com
sudo systemctl restart cloudflared
```

> 若源站已按 `harden-memory.sh` 停用了 Caddy，请把 `service` 指回 `http://127.0.0.1:3080`。

### 2) 取 DSH 会话 cookie 的值

```bash
# 用当期 launch token 换一次 cookie
TOK=$(sudo journalctl -u dsh-web --no-pager | grep -o 'dsh web: http://127.0.0.1:3080/?token=[^ ]*' | tail -1 | sed 's/.*token=//')
curl -s -D /tmp/h.txt -o /dev/null "https://agent.shanhaizaowu.com/?token=$TOK" \
  -H 'Accept: text/html' -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none'
grep -i '^set-cookie' /tmp/h.txt | sed -E 's/^set-cookie: ([^;]+);.*/\1/I'
# ↑ 把输出（形如 dsh-auth-xxx=v1.xxx.xxx）整串作为 DSH_COOKIE
```
> cookie 有效期由 `cookieMaxAgeDays` 决定。用边缘网关时前面有 Basic Auth，可以放到 365 天
> （见主 README 的 patch 层说明）。

### 3) 部署 Worker

```bash
cd deploy/agent-server/worker
npx wrangler deploy
npx wrangler secret put GATE_PASS      # 输入你的密码
npx wrangler secret put DSH_COOKIE     # 粘贴第 2 步的整串
# 并在 wrangler.toml 的 [vars] 里填 ORIGIN_HOST = "agent-origin.shanhaizaowu.com"
```
然后给 Worker 加路由：`agent.shanhaizaowu.com/*`（面板 → Workers → 该 Worker → Settings → Triggers → Routes）。

### 4) 立刻配 WAF 规则（第 2 节），否则等于没设防

## 回退方案（不想折腾双主机名 / WAF 时）

**方案 A：就用 DSH 原生 token（零额外组件，最稳）**
源站只留 DSH + cloudflared。每台设备用当期 token 打开一次，cookie 管 30/365 天。
`rotate-agent-token.sh` 与主 README 的取 token 命令已备好。
> 对 1.58 GiB 的机器，**这其实是最合适的工程取舍** —— 多端只多一次点击。

**方案 B：源站网关（原 Caddy 方案）**
`setup-mobile-gate.sh` 已写好，但**必须先跑 `harden-memory.sh` 加上内存上限**，
否则就可能重演这次假死。

## 本方案的诚实边界

- 我**无法在当前环境验证**这个 Worker：本沙箱把 `cloudflare.com` 解析到 198.18.x.x 保留网段，
  取不到 Cloudflare 的页面与 API。所以 Worker 代码是按 Cloudflare Workers API 语义写的，
  但**未经真实部署验证** —— 首次部署请按下节自检逐条走。
- 尤其 **`fetch()` 是否会被 Worker 自身拦截**，必须以实际结果为准（见自检第 1 条）。

## 部署后自检（每条都要能证伪）

| # | 检查 | 期望 |
|---|---|---|
| 1 | `curl -sI https://agent.shanhaizaowu.com/` | `401` + `www-authenticate: Basic`（**不是** 508/超时 —— 若 508 说明命中了循环） |
| 2 | `curl -s -u admin:错密码 …/` | `401` |
| 3 | `curl -s -u admin:对密码 …/ \| grep -o 'DeepSeek Harness'` | 命中（说明 cookie 注入生效、无需 token） |
| 4 | 手机浏览器打开 | 弹一次密码框，之后直接进 DSH |
| 5 | `curl -sI https://agent-origin.shanhaizaowu.com/` | **被 WAF 拦截**（403/1020），**不能**返回 DSH 的 401 |
| 6 | `curl -sI https://agent-origin.shanhaizaowu.com/ -H 'x-gate-secret: <串>'` | 返回 DSH 的 401（证明规则只放行带头的请求） |
| 7 | DSH 里发一条消息看流式输出 | 正常逐字出现（证明 SSE 未被缓冲） |
