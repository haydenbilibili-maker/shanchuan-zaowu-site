# 山海造物 · 数智化中台（Web 管理端）

本目录为 **Vue 3 管理端** 的构建产物，挂载于 `https://shanhaizaowu.com/admin/`。

**定位**：公司管理层、门店店长与授权员工的 **日常 Web 端入口**——经营驾驶舱、藏品档案、财务核算、会员 CRM、活动营销、AI 决策等；与小程序消费者端、店长小程序后台共享同一云环境。

## 更新方式

在仓库根目录执行（源码在 **`admin/`**）：

```bash
npm run build:admin    # 输出到本目录
# 或完整站点构建
npm run build          # admin + Astro → dist/
```

**勿**再手动从外部 `shanchuan-admin/dist/` 覆盖。保留本目录的 `README.md`、`cloud-check.html`；构建脚本不会删除它们。

3. **勿部署** `governance-assets/`（内部治理文档，仅本地 / 私有环境保留）
4. 确认 `index.html` 含 `<meta name="robots" content="noindex, nofollow" />`（`admin/index.html` 模板已内置）
5. 提交并推送主站仓库

## 路由

Cloudflare Pages 通过 `public/_redirects` 配置 SPA 回退：

- `/admin` → `/admin/`（301）
- **勿** 在 `_redirects` 里写 `/admin/* → /admin/` 的 200 回退，否则 `/admin/assets/*.js` 会返回 HTML（白屏）

## 数据持久化（A1 · 财务云端）

构建产物已内置 CloudBase 与 `financeSync`（envId `cloud1-8gnkty5bfff9f0bf`）。  
**Web 端要能同步，须在云开发控制台配置 Web 安全域名与匿名登录**——见仓库根目录：

- **`docs/admin-a1-cloudbase.md`** — 完整配置与验收步骤
- **`/admin/cloud-check.html`** — 部署后四项连通性自检
- **`cloudbase/rules/`** — 集合安全规则参考

财务页解锁后会自动合并云端数据；亦可手动「同步到云端」/「从云端下载」。

## 源码

仓库内 **`admin/`**（Vite + Vue 3 + Element Plus）。见 **`docs/monorepo.md`**。
