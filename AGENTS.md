# AGENTS.md · 山海造物 Monorepo

> 本仓库是山海造物业务线的**唯一代码主库**（官网 + ERP + 小程序 + 云配置）。
> 业务全景与排期见 `docs/项目总览与后续工作框架.md`；`Business_Projects/shanchuan-admin` 为历史归档副本，**不做代码修改**。

## 目录速查

| 路径 | 内容 | 开发命令 |
|------|------|----------|
| `src/` | Astro 官网（v0.4 双主题） | `npm run dev` → :4321 |
| `admin/` | Vue 3 ERP（Element Plus + CloudBase） | `npm run dev:admin` → :5178 |
| `miniprogram/` | 微信小程序（微信开发者工具打开此目录） | 手动上传 |
| `cloudbase/rules/` `cloudbase/schema/` | 云集合权限规则 / 结构说明 | 与 `admin/src/cloud.js` 三处同步 |
| `docs/` | 仓库级运维文档 | — |

## 改动规范

- ERP：新增菜单 = `admin/src/App.vue` 的 `el-menu` + 主区 `component :is`；新模块先落 `admin/docs/` 蓝图再实现。
- 新增云集合：`admin/src/cloud.js` 的 `COLLECTIONS` ↔ `cloudbase/rules/<name>.json` ↔ `cloudbase/schema/<name>.md` 三处同步。
- 文档：上线模块后补说明并登记到对应 `docs/README.md` 索引。
- 构建验证：`npm run build`（ERP → `dist/admin/` + 官网 → `dist/`）；部署走 GitHub Actions（Cloudflare Pages，main 分支），小程序不走 Pages。

## 关键文档

- `docs/项目定位与开发基座.md`（全仓定位 + 现状地图 + 改动规范，开发前先读）
- `docs/monorepo.md` · `docs/cloudbase-collections.md` · `docs/项目总览与后续工作框架.md`
- `admin/docs/PLATFORM_CAPABILITIES.md`（ERP 能力边界，勿将演示当生产）
- `admin/docs/内容工厂_Phase1_技术蓝图.md`（内容工厂，已落地）
- `admin/docs/订货履约与成品库存_Phase1_技术蓝图.md` · `admin/docs/飞书多维表对接_技术蓝图.md`（进行中模块）
- `miniprogram/README.md`（小程序与云函数说明）

## 环境

- CloudBase envId：`cloud1-8gnkty5bfff9f0bf`（上海）；Web 匿名登录 + 安全域名白名单。
- 小程序 AppID：`wxf2550373b010b447`。
