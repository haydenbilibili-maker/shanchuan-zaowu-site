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
- **内部资料不得进发布路径**：`public/`（Astro 静态目录）与 `admin/public/`（Vite publicDir）**都会被公开部署**。
  劳动合同/保密竞业/投资人 BP/股权架构等内部文档只存 `admin/public/governance-assets/`，由
  `scripts/build-admin.mjs` 构建后剔除、`scripts/verify-admin-dist.mjs` 部署前拦截、`npm run check:publish-dir` 守卫。
  （2026-09-17 前该目录曾被公开部署至生产站，见 `docs/全面审计_2026-09-17/README.md` §7）
- 验证：
  - `npm run check:admin`（**68 条**静态守卫，含 dev 管线编译）。它是 `node scripts/run-guards.mjs`：
    **逐条独立执行、全部跑完再汇总**（不再短路），清单唯一事实源是 `package.json` 的 `check:admin:guards`
    —— **新增守卫追加到该键**；
  - `npm run check:admin:selftest`（逐条跑守卫自检，证明每条都能失败）；`npm run check:admin:runner-selftest`
    （证明执行器不短路、缺自检会被点名）；
  - **不在清单内**的守卫（需浏览器/凭据，按需手动跑）：`check:nav-dom`、`audit:collections`、`check:cloud-files`、`check:fn-sync`；
  - `npm run dev:admin` 起验收环境后 `npm run check:nav-dom`（**真实浏览器 DOM**，唯一能证明界面真画出来的检查）；
  - `npm run build`（ERP → `dist/admin/` + 官网 → `dist/`）；
  - 改配色/主题前先跑 `npm run report:colors`（**只报告不改动**，禁止 find-replace），
    对它的「嫌疑」用 `npm run report:colors -- --verify '<选择器>' --module <id>` 在浏览器实测再动手。
  **注意**：`build:admin` 通过**不代表**验收地址可用 —— 模板编译错误只在 dev 管线复现（见 `admin/docs/ERP系统专项审计_2026-09-16.md` §1.6），故 `check:sfc-dev` 不可省。
- 部署走 GitHub Actions（Cloudflare Pages，main 分支），小程序不走 Pages。
- 每条守卫都必须能证明自己会失败：新增检查要配 `--selftest`（注入回归 → 必须检出 → 还原源文件）。
- **AI 施工前必读 `docs/AI施工错题本.md`**：它记录了本仓库反复出现的底层错误模式（锚点从渲染输出回抄、
  跨文件盲目 find-replace、删除成对结构不配平、守卫判据自身错误、没实测字段就写代码……），
  并给出「开工前 5 问 / 收工前 5 问」。**同类错误第二次发生，必须补一条守卫或自检**。
- **静态分析 ≠ 事实**：CSS 里「哪条声明生效」受 `!important`/特异性/teleport 影响，脚本判出的「问题」
  必须在浏览器实测后才算数（本项目已被此坑过 3 次，见审计报告 §1.6、§1.7、§1.7.0）。

## 关键文档

- **`docs/全面审计_2026-09-17/README.md`**（最新全仓审计：P0/P1 + 线上实测的公网暴露 + 基线事实）、
  **`docs/全面审计_2026-09-17/后续工作基座.md`**（标准命令 / 守卫地图 / 改动落点 / 完成定义）—— **开工前先读这两份**
- **`docs/AI施工错题本.md`（AI 施工者**开工前必读**：反复犯错的底层模式 + 自检 5 问 + 错误→守卫对照表）**
- `docs/README.md`（仓库级文档索引与登记规则）
- `docs/项目定位与开发基座.md`（全仓定位 + 现状地图 + 改动规范）
- `docs/monorepo.md` · `docs/cloudbase-collections.md` · `docs/项目总览与后续工作框架.md`
- `admin/docs/PLATFORM_CAPABILITIES.md`（ERP 能力边界，勿将演示当生产）
- `admin/docs/内容工厂_Phase1_技术蓝图.md`（内容工厂，已落地）
- `admin/docs/订货履约与成品库存_Phase1_技术蓝图.md` · `admin/docs/飞书多维表对接_技术蓝图.md`（进行中模块）
- `admin/docs/ERP系统专项审计_2026-09-16.md`（ERP 滚动台账，ERP 侧改动第一参考）
- `miniprogram/docs/README.md`（小程序文档索引；代码同 `WeChatProjects/shanchuanspecimens-只上传`，2026-09-14 已回灌对齐；
  该外部路径**并非每个环境都存在**：`npm run sync:miniprogram:check` 在开发仓不存在时会**安全跳过**
  （CI / 他人机器属正常情况，不会把 `check:admin` 弄红）。两仓显示名的区分方式见 `docs/施工与发布流程.md`）

## 环境

- CloudBase envId：`cloud1-8gnkty5bfff9f0bf`（上海）；Web 匿名登录 + 安全域名白名单。
- 小程序 AppID：`wxf2550373b010b447`。
- **装依赖必须 `npm ci --include=dev`**：本机/CI 若预设 `NODE_ENV=production`，`npm ci` 会**静默省略全部 devDependencies**
  （缺 `vite`/`@vitejs/plugin-vue`/`wrangler` → `build`、`dev:admin`、`check:sfc-dev` 全报「找不到 vite」）。
- 沙箱/容器里 `astro build` 可能因 telemetry 写 `$HOME` 失败（`EACCES ... .config/astro`）→ 设 `ASTRO_TELEMETRY_DISABLED=1`；
  npm 缓存目录不可写时加 `--cache <可写目录>`。
- **CI 已跑守卫（2026-09-17 修 D1）**：`.github/workflows/deploy-pages.yml` 有三个 job ——
  `verify`（push/PR/dispatch：`npm ci --include=dev` + `check:admin` + `build`，并上传 dist artifact）、
  `guards-can-fail`（PR/dispatch：`check:admin:selftest`）、`deploy`（仅 main，复用 artifact 部署）。
  合并前仍建议本地跑一遍 `check:admin`，但**不再依赖人工把关**。

## 工作时段（成本约束，2026-09-17 起）

DeepSeek **空闲时段单价 = 高峰时段的一半**。高峰时段为**北京时间 周一至周五 09:00–12:00、14:00–18:00**，
**其余全部为空闲时段**。因此**只在空闲时段推进工作**（含调用模型）：

| 类型 | 时段（北京时间） | 是否工作 |
|------|------------------|----------|
| 高峰 | 周一–周五 **09:00–12:00**、**14:00–18:00** | ❌ 不做 |
| 空闲 | 周一–周五 00:00–09:00、12:00–14:00、18:00–24:00 | ✅ |
| 空闲 | **周六、周日全天** | ✅ |

- 高峰时段不开始新的工作项；停在一个**可恢复**的状态（改动已提交或已写进文档），并说明下次继续的时间。
- 边界要留余量：别在 11:5x / 17:5x 才开始一个要跑构建或长测试的任务。
- 本节是唯一事实源（2026-09-17 按产品负责人口径修正：早先误写成「周末不工作」，周末实为空闲时段）。
