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
  - `npm run check:admin`（跑 `guards/` 下的**全部域**，含 dev 管线编译）。它是 `node scripts/run-guards.mjs`：
    **逐条独立执行、全部跑完再汇总**（不再短路）。
    **守卫清单的唯一事实源是 `guards/_meta.json` + `guards/<NN>-<域>.txt`**（一行一条，一文件一域）
    —— **新增守卫只改「你自己那条流」的域文件**（域归属见 `docs/并发工作流注册表.json`），
    跨流加守卫走变更请求。**不要把清单写回 `package.json`**：
    旧形态是一行 2690 字符的 `check:admin:guards`，而 `package.json` 在近 200 次提交里被改过 **49 次（全仓第一）**
    —— 两条流同时加守卫 = 100% 文本冲突。拆成一文件一域后跨流零冲突（2026-09-18 P1-1）；
  - `npm run check:domain -- <域>`（只跑该域 + `cross`，开发内循环）
    与 `npm run check:guards:list` / `--domains`（看清单与域归属）；
  - **内循环用 `npm run check:quick -- <域>`**（该域 + `guards/_meta.json` 的 `quickWith` 里**点名**的跨域守卫；
    实测 ~2.5s，而 `check:admin` 全套 124.5s）。**全套只在收口/提交前跑一次** ——
    把收口动作塞进内循环是 2026-09-20 那几轮"一轮做很久"的主因，见 `docs/工作节奏_快速通道_2026-09-20.md`；
  - **收口用 `npm run check:fast`**（= `run-guards.mjs --jobs auto --retry-serial`：**同一份全套清单、同判据**，并行 + 绕过 npm 启动，
    实测 **7.4s**，串行 `check:admin` 48.5s；**CI 的 verify job 也跑它**，2026-09-28 产品负责人拍板）。起 Chrome/vite/写固定临时文件的守卫登记在
    `guards/_meta.json` 的 `serialGuards`（并行时走互斥通道）—— 起 Chrome/vite 却没登记的，`check:guards-coverage` 静态拦截；
    静态难判的共享临时文件由 `--retry-serial` 兜底：并行失败的逐条串行复跑，串行仍失败才判红，串行通过的报「并行冲突嫌疑」（CI 上打 `::warning`），
    **看到这条警告就去登记 `serialGuards` 或改用 `mkdtemp`**。两种模式汇总后都打印**耗时排行**，新守卫超过 2s 先看排行找原因；
  - **每轮必做 / 收尾才做 / 禁止**（2026-09-28 产品负责人「开发速度也非常重要」，完整证据见 `docs/开发提速_2026-09-28.md`）：
    每轮只跑 `check:quick`（或点名单条）；**出图 / Chrome 探针每轮最多 2 次**（改前看问题 1 次 + 交付 1 次，一次出齐；2026-09-28 产品负责人拍板）；云函数只比对/部署**本流**函数；
    体积用 `check:main-package-size`（0.2s）不手写 `find/du`；开发仓同步每轮结束一次不复查；
    **禁止** `pkill -f` 宽匹配（`--headless`/`chrome`/`check-cloud-functions-sync`…），只杀自己启动且记了 PID 的进程；
    禁止 `sleep N; tail` 轮询秒级命令、禁止反复整读同一份大文档（读一次，之后 `rg`）；
  - `npm run check:guards-coverage`（**守清单本身**：不丢条目 / 不重复 / 脚本与自检齐全 / 总数棘轮只许多不许少）；
  - `npm run check:admin:selftest`（逐条跑守卫自检，证明每条都能失败）；`npm run check:admin:runner-selftest`
    （证明执行器不短路、缺自检与死脚本名会被点名）；
    ⚠️ **`check:admin` 只跑守卫、不跑自检** —— 改了任何「被某条自检注入」的文件后，
    必须**在隔离 worktree 里**跑 `check:admin:selftest`（它会对源码注入→还原，在共享工作区跑会覆盖别人的在写内容）；
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

## 稳定期模块（2026-09-21 产品负责人口径，**长期纪律**）

小程序**电商链路 / 礼赠 / 注册 / 登录 / 后台**已进入**稳定期**：除产品负责人**特殊要求**外，**不要大动**。
- **禁止**：改契约（字段/集合/云函数入参出参与 `success` 语义）、改流程与状态机、改共享件行为
  （`utils/imageUrl`、`utils/messageHelper`、`orderSummary.js` 及同步副本、`utils/cache`、埋点双端 schema、
  `admin/src/cloud.js` 的 `COLLECTIONS`）、重构成熟模块、改生产数据。
- **允许**：修 P0 缺陷（**须在交付说明里单列报备**）、只加守卫与断言/注释/文档/测试、**新增旁路**、
  产品负责人**点名范围内**的改动（不顺手扩大）。
- 发现受保护模块里的问题：**先取证并报告**，在报告里单列「需产品负责人点名的改动」，**不要因为"顺手"就改**。
- 完整口径与判断标准见 `docs/开发纪律_稳定期模块保护_2026-09-21.md`。

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
  `verify`（push/PR/dispatch：`npm ci --include=dev` + **`check:fast`**（2026-09-28 起：全套清单并行 + 失败串行复跑；
  `check:astro` 在 CI 强制真跑，缓存不生效）+ `build`，并上传 dist artifact）、
  `guards-can-fail`（PR/dispatch：`check:admin:selftest`，串行）、`deploy`（仅 main，复用 artifact 部署）。
  合并前仍建议本地跑一遍 `check:fast`，但**不再依赖人工把关**。

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
- **适用范围（2026-09-29 产品负责人口径）**：本节**只约束使用 DeepSeek 模型的施工者**。使用其它模型（Claude、GPT 等）时**不受时段限制，收到任务立即开工**，不得以高峰时段为由推迟。
