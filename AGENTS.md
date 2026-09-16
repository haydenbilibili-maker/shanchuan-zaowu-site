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

- ERP 新增模块 = **三处**（顺序即依赖）：
  1. `admin/src/utils/modulesRegistry.js` 的 `MODULES` 加一条（域 = `group`，一级域的 id/名称/图标只在 `GROUPS` 定义）；
  2. `admin/src/config/adminNavDomains.js` 的 `NAV_CURATION` 里把它策展进某个域的分区（只写 `id` + 一句话 `desc`，**不要再写 `title`/`icon`**）；
  3. `admin/src/App.vue` 的 `TAB_COMPONENT_MAP` 挂组件。
  侧栏与导航大屏都由数据派生，**不要手写 `el-menu-item`**；漏第 2 步会被 `npm run check:nav-sources` 拦住。
  新模块先落 `admin/docs/` 蓝图再实现；上线模块后登记到对应 `docs/README.md` 索引。
- 新增云集合：`admin/src/cloud.js` 的 `COLLECTIONS` ↔ `cloudbase/rules/<name>.json` ↔ `cloudbase/schema/<name>.md` 三处同步。
- 验证：
  - `npm run check:admin`（10 条静态守卫，约 10s，含 dev 管线编译）；
  - `npm run dev:admin` 起验收环境后 `npm run check:nav-dom`（**真实浏览器 DOM**，唯一能证明界面真画出来的检查）；
  - `npm run build`（ERP → `dist/admin/` + 官网 → `dist/`）；
  - 改配色/主题前先跑 `npm run report:colors`（**只报告不改动**，禁止 find-replace），
    对它的「嫌疑」用 `npm run report:colors -- --verify '<选择器>' --module <id>` 在浏览器实测再动手。
  **注意**：`build:admin` 通过**不代表**验收地址可用 —— 模板编译错误只在 dev 管线复现（见 `admin/docs/ERP系统专项审计_2026-09-16.md` §1.6），故 `check:sfc-dev` 不可省。
- 部署走 GitHub Actions（Cloudflare Pages，main 分支），小程序不走 Pages。
- 每条守卫都必须能证明自己会失败：新增检查要配 `--selftest`（注入回归 → 必须检出 → 还原源文件）。
- **静态分析 ≠ 事实**：CSS 里「哪条声明生效」受 `!important`/特异性/teleport 影响，脚本判出的「问题」
  必须在浏览器实测后才算数（本项目已被此坑过 3 次，见审计报告 §1.6、§1.7、§1.7.0）。

## 关键文档

- `docs/项目定位与开发基座.md`（全仓定位 + 现状地图 + 改动规范，开发前先读）
- `docs/monorepo.md` · `docs/cloudbase-collections.md` · `docs/项目总览与后续工作框架.md`
- `admin/docs/PLATFORM_CAPABILITIES.md`（ERP 能力边界，勿将演示当生产）
- `admin/docs/内容工厂_Phase1_技术蓝图.md`（内容工厂，已落地）
- `admin/docs/订货履约与成品库存_Phase1_技术蓝图.md` · `admin/docs/飞书多维表对接_技术蓝图.md`（进行中模块）
- `miniprogram/docs/README.md`（小程序文档索引；代码同 `WeChatProjects/shanchuanspecimens`，2026-09-14 已回灌对齐）

## 环境

- CloudBase envId：`cloud1-8gnkty5bfff9f0bf`（上海）；Web 匿名登录 + 安全域名白名单。
- 小程序 AppID：`wxf2550373b010b447`。
