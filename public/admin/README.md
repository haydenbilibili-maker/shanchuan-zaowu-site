# 山海造物 · 数智化中台（Web 管理端）

本目录为 **Vue 3 管理端** 的构建产物，挂载于 `https://shanhaizaowu.com/admin/`。

**定位**：公司管理层、门店店长与授权员工的 **日常 Web 端入口**——经营驾驶舱、藏品档案、财务核算、会员 CRM、活动营销、AI 决策等；与小程序消费者端、店长小程序后台共享同一云环境。

## 更新方式

1. 在 `shanchuan-admin` 项目中执行 `npm run build`
2. 将 `dist/` 内容覆盖到本目录（保留 `README.md`）
3. **勿部署** `dist/governance-assets/`（内部治理文档，仅本地 / 私有环境保留）
4. 确认 `index.html` 含 `<meta name="robots" content="noindex, nofollow" />`（登录系统不对搜索引擎收录）
5. 提交并推送主站仓库

## 路由

Cloudflare Pages 通过 `public/_redirects` 配置 SPA 回退：

- `/admin` → `/admin/`（301）
- `/admin/*` → `/admin/`（200，Vue Router 客户端路由；**勿** rewrite 到 `index.html`，Cloudflare 会忽略该规则）

## 源码

独立仓库 / 压缩包：`shanchuan-admin`（Vite + Vue 3 + Element Plus）。
