# AI：DeepSeek 环境变量配置

Admin「AI 智能中心」统一走 `utils/aiHelper.js`。**生产与本地均优先读 Vite 环境变量**，不要把 API Key 明文存进云库；浏览器 localStorage「备用接口」仅作开发演示。

## 变量一览

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_DEEPSEEK_API_KEY` | 是 | DeepSeek API Key（也可用 `VITE_DEEPSEEK_API_KEYS` 逗号分隔多 Key） |
| `VITE_AI_DEFAULT_PROVIDER` | 建议 | 设为 `deepseek` |
| `VITE_DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com` |
| `VITE_DEEPSEEK_MODEL` | 否 | 默认 `deepseek-chat` |
| `VITE_BAILIAN_API_KEY` | 否 | 百炼备用；额度耗尽时可省略 |

## 本地开发

1. 复制 `admin/.env.example` → `admin/.env`（勿提交真实 Key）
2. 填写 `VITE_DEEPSEEK_API_KEY=sk-...`，确认 `VITE_AI_DEFAULT_PROVIDER=deepseek`
3. 重启：`npm run dev:admin`
4. 验收：Admin → **AI 智能中心** → **后台配置** → **在线接口**，应显示「DeepSeek 已配置」与脱敏 Key

## 生产（GitHub Actions → Cloudflare Pages）

在仓库 **Settings → Secrets and variables → Actions** 添加：

- `VITE_DEEPSEEK_API_KEY`（必填）
- 可选：`VITE_DEEPSEEK_BASE_URL`、`VITE_DEEPSEEK_MODEL`
- 可选备用：`VITE_BAILIAN_API_KEY`

`.github/workflows/deploy-pages.yml` 会在 `npm run build` 时注入上述变量；默认 Provider 为 `deepseek`。改 Secret 后需重新跑 Deploy workflow。

## 调用失败时

报错会提示检查 `VITE_DEEPSEEK_API_KEY` 等 env。确认：

1. 本地是否已重启 Vite；生产是否已重新构建部署
2. Secret 名称与上表一致（含 `VITE_` 前缀）
3. Key 未过期、账户有额度
