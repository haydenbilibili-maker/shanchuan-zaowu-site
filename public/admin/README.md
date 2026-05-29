# 山海造物 · 数智化中台（静态部署）

本目录为 **Vue 3 管理端** 的构建产物，挂载于 `https://shanhaizaowu.com/admin/`。

## 更新方式

1. 在 `shanchuan-admin` 项目中执行 `npm run build`
2. 将 `dist/` 内容覆盖到本目录（保留 `README.md`）
3. 确认 `index.html` 含 `<meta name="robots" content="noindex, nofollow" />`（演示站不收录）
4. 提交并推送主站仓库

## 路由

Cloudflare Pages 通过 `public/_redirects` 配置 SPA 回退：

- `/admin` → `/admin/`（301）
- `/admin/*` → `/admin/index.html`（200，供 Vue Router 客户端路由）

## 源码

独立仓库 / 压缩包：`shanchuan-admin`（Vite + Vue 3 + Element Plus）。
