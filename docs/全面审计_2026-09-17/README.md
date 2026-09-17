# 山海造物 · 全面审计报告（2026-09-17）

> **审计对象**：`shanchuanzaowu` monorepo 全仓 —— Astro 官网 `src/`、Vue ERP `admin/`、微信小程序 `miniprogram/`、
> CloudBase 治理 `cloudbase/`、Cloudflare Pages Functions `functions/`、工程基建（`scripts/` + `.github/` + 文档体系）。
> **基线**：HEAD `2db36dc`（`feat(booking): 预约核销接入云函数 verifyBooking`），工作树干净。
> **方式**：只读（不改业务代码、不部署、不写库）+ 本地实测（跑守卫/构建）+ 线上只读探针（HTTP GET/HEAD）；
> 六路并行子审计 + 主线交叉复核。
> **证据分级**：`线上实测`（本轮对生产域名发请求）＞ `本地实测`（本轮跑命令，附输出）＞ `代码读到`（file:line）
> ＞ `子审计`（子报告有 file:line，主线抽样复核）＞ `未验证`（明确写缺什么）。
>
> **本报告不重复抄录** `admin/docs/ERP系统专项审计_2026-09-16.md`（ERP 滚动台账，704 行）。ERP 的 P0-1…P0-21
> 现状见 **`raw/06_ERP现状复核.md`**，本报告只吸收其结论并补跨端视角。

---

## 0. 结论摘要

### 0.1 必须最先处置 —— 公网暴露（本轮新增，均有线上实测）

| # | 结论 | 证据 | 级别 |
|---|------|------|------|
| **A1** | **公司内部治理文档在生产站公开可下载**：劳动合同书、保密＋竞业限制协议、投资人详细说明、投资人路演 BP（pptx）、公司化股权架构方案（终版）、IP 战略投资文档 —— 共 **33 个文件 / 1.2 MB**，位于 `public/admin/governance-assets/**`。`public/admin/README.md:19` 自己写着「**勿部署** governance-assets/（内部治理文档）」 | **线上实测**：`GET /admin/governance-assets/hr-compliance/山海造物-劳动合同书.docx` → **HTTP 200 / 16488 B**；投资人路演 BP.pptx → **HTTP 200 / 271857 B**；股权架构方案（终版）.docx → 200 / 13470 B；IP 战略投资文档.docx → 200 / 17131 B；`/admin/README.md` → 200 | **P0** |
| **A2** | **`/api/feishu-sync` 完全无鉴权**，任何人可读写飞书多维表（含人事花名册 Base），且 **GET 就回显 `appToken`** | **线上实测**：`GET https://shanhaizaowu.com/api/feishu-sync` → `{"success":true,"configured":true,"appToken":"WCs2…Wnod","msg":"飞书密钥已配置"}`（值已截断；完整值另见仓库既有文档）。代码侧：`functions/api/feishu-sync.js:7-12`（CORS `*`）、`:18-38`（无 Cookie/口令/来源校验）；`functions/_lib/feishuBitable.mjs:130-186`（action 直通 `createRecord`/`updateRecord`/`listRecords`，请求体可覆盖 `appToken`） | **P0** |
| **A3** | **`/api/ai` 完全无鉴权 = 开放付费 LLM 网关**，任何人可盗刷 `DEEPSEEK_API_KEY` 额度 | **线上实测**：`GET https://shanhaizaowu.com/api/ai` → `{"ok":true,"configured":{"deepseek":true,"bailian":false,"openai":false,"gemini":false}}`。代码侧：`functions/api/ai.js:42-46`（CORS `*`）、`:81-149`（无会话校验、无速率限制、payload 原样透传） | **P0** |
| **A4** | **已知明文口令会进生产前端包，而部署前密钥闸门不拦**：`admin888`（超管门禁）、`money888`（财务门禁）、`verified_888`（登录态常量）三者 **同时命中构建产物** `public/admin/assets/index-oYymeOJc.js`；`scripts/verify-admin-dist.mjs:99-103` 的正则只覆盖 `sk-` / `adminOpsKey` / `VITE_ADMIN_OPS_KEY` | **本地实测**（本轮完整构建后 grep）：三个口令各命中 1 个 chunk 文件 | **P0** |

> **A1 的性质**：不是「配置疏忽」而是**发布管线缺一道目录白名单**。`admin/vite.config.js:113-115`（`outDir: '../public/admin'`，未设 `publicDir:false`）
> 每次构建都会把 `admin/public/**` 复制进产物；而 `public/` 又是 Astro 的静态目录 → 只要 `dist/` 被部署，这些文件就上线。
> `public/_redirects` 只对 `/admin/assets/*` 做 404，对 `governance-assets/` 无任何规则；`robots.txt` 的 `Disallow: /admin/` **只挡爬虫不挡直链**。
> **最小止血**：把 `governance-assets/` 移出 `public/`（改放仓库内非发布目录），或对 `/admin/governance-assets/*` 加 404 规则；两者都需重新部署才生效。
> **注意**：`public/admin/governance-assets/**`（33 份）与 `admin/public/governance-assets/**`（源副本）**同时入库**，需一并处理。

### 0.2 数据面与凭据（仓库内可证；线上侧需凭据复测）

| # | 结论 | 证据 | 级别 |
|---|------|------|------|
| **B1** | **CloudBase 数据面大面积可匿名读**：Web 端走 `signInAnonymously`（`admin/src/cloud.js:99-103`），而仓库 127 份规则中 **`read:"auth != null"` 57 份、`read:true` 12 份** → `orders`（收货人姓名/电话/地址）、`finance_records`、`store_ledger`、`refunds`、`bookings`、`custom_inquiries`、`pet_memorial_orders`、`admin_login_logs`、`admin_operation_logs` 等全量 PII/财务数据可读（子审计列 33 个集合） | 本地实测规则分布 + `raw/04` §0；**线上侧本轮未复测**（缺 `TCB_SECRET_ID/KEY`） | **P0** |
| **B2** | **`admin_users` / `admin_roles` 规则为 `read+write: "auth != null"`** → 匿名登录即可读写管理员账号表（可自造超管）；而 `staffGuard` 实际读的是 `staff_members`/`workspace_acl`，这两张表**不参与任何鉴权判定** → 被篡改也无人察觉 | `cloudbase/rules/admin_users.json:2-3`、`admin_roles.json:2-3`；`raw/04` §0 P0-1 | **P0** |
| **B3** | **官网转化链路会静默丢线索并告知用户「已提交」**：云写失败 → 落**访客自己浏览器**的 localStorage → 返回 `ok:true` → 前端进入成功态「已提交，我们会尽快联系」。ERP 读的是管理员同源 localStorage，跨浏览器不可见；唯一读取器 `listLocalPurchaseIntents` 零引用（死代码） | `src/lib/purchaseIntent.ts:190-204`、`:121-137`、`:209`；`src/pages/price-list.astro:567-569`、`:1250-1258`；`raw/01` §0 P0-2 | **P0** |
| **B4** | **官网报价表可被任意访客改写、采购意向可被任意访客全表拉取**：`price_list_items` 规则 `write:"auth != null"`；`purchase_intents` 规则 `read/update:"auth != null"`（含姓名+手机号 PII） | `cloudbase/rules/price_list_items.json:2`、`purchase_intents.json:2-4`；`raw/01` §0 P0-3 | **P0** |
| **B5** | **本地 dev/preview 云函数代理无条件注入 `ADMIN_OPS_KEY`**（无任何会话/Cookie 校验），且同时挂到 `configurePreviewServer`，`server.host = '0.0.0.0'` → 同局域网任何人 `POST /api/cloud-fn` 即获 30 个管理云函数的超管身份 | `admin/scripts/viteCloudFnPlugin.mjs:45-73`、`:83-85`；`admin/vite.config.js:109,131-139`；`raw/04` §0 P0-6 | **P0（本机/局域网）** |
| **B6** | **管理会话令牌可离线伪造**：签名密钥回退链 `ADMIN_PROXY_SECRET \|\| ADMIN_PROXY_PASSWORD \|\| ADMIN_OPS_KEY`；令牌无用户标识/nonce/吊销，登出仅清 Cookie，泄露后 12h 内有效；`/api/admin-session` 全仓无速率限制/锁定 | `functions/_lib/proxySession.mjs:38-40,62-82,97-110`；`functions/api/admin-session.js:52-57,69-77`；`raw/04` §0 P1-5/P1-6 | **P1（可升级为 P0）** |
| **B7** | **`functions/_lib/cloudbaseCallFn.mjs:213,244` 仍保留 `VITE_ADMIN_OPS_KEY` 回退**，而 `admin/.env.example:59-64` 明令禁止该变量、构建闸门专门拦它 → 代码与治理约定自相矛盾 | `raw/04` §0 P0-8 | **P1（潜伏）** |

### 0.3 写路径、资损与状态机（ERP 台账 + 云函数子审计）

| # | 结论 | 说明 |
|---|------|------|
| **C1** | **ERP 侧「点保存不落库」只被改成「点保存会报错」，功能仍未通**：10 个集合规则仍 `write:false`；ERP 侧 8 个已无直写，但 **`products` / `orders` 仍有直写**（`COLLECTIONS.PRODUCTS` ×2、`COLLECTIONS.ORDERS` ×3）；退款按钮已接线 `refundOrder`，但服务端 `refundOrder/index.js:489-492` 要求 staff 身份，而 ERP 是 Web 匿名会话 → **点退款仍退不了钱** | `raw/06` §0；台账附录 C 至少 6 条「✅已完成」应读作「已如实报错」 |
| **C2** | **幂等与并发防护整体缺位**：全仓 `runTransaction` 命中 **0**；`point_records`/`store_purchases`/`platform_order_binds` 的 `dedupeKey` 唯一索引**无任何 provision/校验脚本**（文档自认「不建等于没有防重」）；`earnPoints`、`receiveCoupon`（`_.inc(-1)` 可扣成负）、`transferCoupon`（可转赠已锁券）均为 count→add / 无条件更新 | `raw/03` §0 P0-2/P0-2′；`miniprogram/docs/门店积分上线操作清单.md:77-85` |
| **C3** | **收了钱但没履约，且微信会停止重试**：`payCallback/fulfillOrder.js:225-237`「已付款但不可履约」标记写失败被 `.catch(()=>{})` 吞掉后仍 `return success:true` | `raw/03` §0 P0-3 |
| **C4** | **审计归属可伪造**：`managerShipOrder/index.js:1211-1212` 是 7 处 `_callerOpenid` 透传站点中**唯一**没有 `isNonClientSource()` 门的一个；经 `/api/cloud-fn`（SCF Invoke 无微信 SOURCE）可指定任意 openid 写入 `staff_audit_logs` | `raw/03` §0 P0-1（后置仍有 `assertShipAccess`，故为「归属伪造」而非「任意越权」） |
| **C5** | **内容安全可能真失效**：4 个云函数调用 `security.mediaCheckAsync` 却未在 `config.json` 声明 openapi 权限（`grantStorePoints`/`submitComment`/`upsertUserProfile`/`identifySpecimen`，后者还缺 `msgSecCheck`） | `raw/03` §0 P0-4；**需控制台核对勾选状态**才能定性 |
| **C6** | **`refund_rejected` 是永久死锁状态**：唯一写入方 `Refunds.vue:513`；`refundOrder/index.js:413` 的 `allowFrom` 不含该值；`Orders.vue` 无该状态分支 → 订单既不能发货、也不能退款、也无重新申请入口 | `raw/06` P0-17（仍成立） |
| **C7** | **店长级审批单在 ERP 永久不可见**：`ApprovalQueue.vue:157` 硬编码 `scope:'super_admin'`，服务端据此过滤 → `points_store_grant` 等永久待审 | `raw/06` P0-18（仍成立） |
| **C8** | **`stock_movements` 仍无写入方 → 库存变动无审计、三方无法对账**：`manageStoreShipment` 全文件 0 处库存扣减；两个写入方都在前端且被前置 `products` 写失败拦住 | `raw/06` P0-19（仍成立） |

### 0.4 工程闸门（本轮新增，均本地实测）

| # | 结论 | 证据 |
|---|------|------|
| **D1** | **CI 完全不跑任何守卫，且没有 `pull_request` 触发**：唯一工作流只在 `push: main` 上 `npm ci` + `npm run build`；63 个 `check/report/test/audit/lint/sync:*` 入口零条进入合并路径 | `.github/workflows/deploy-pages.yml:3-6,26-58` |
| **D2** | **`check:admin` 是单条 `&&` 链**：19 条守卫中第一条失败即**静默跳过其余 17 条**，总退出码仍只反映第一条 | `package.json:73`；`raw/05` §0 P1-2 |
| **D3** | **`npm run check:share-image` 在当前 HEAD 就是红的**：报「新增 1 处未复核的分享封面」`subpackages/feature/identify/result/index.js:737`（微信不支持 `cloud://` 作为分享封面 → 黑块） | **本地实测**：`EXIT=1` |
| **D4** | **死守卫入口 `sync:miniprogram(:check)`**：脚本仍假设 monorepo 之前的布局，找 `../WeChatProjects/shanchuanspecimens`，本环境不存在 → **实测 exit 1** | `scripts/check-miniprogram-sync.mjs:21-23` |
| **D5** | **3 个守卫无 `--selftest`**（违反 `AGENTS.md` 硬性要求）：`check-cloud-functions-sync.cjs`、`check-miniprogram-sync.mjs`、`check-cloud-files.cjs`；另有 3 个测试脚本（`test-content-{board,db,flow}.mjs`）**连 npm 入口都没有** | `raw/05` §0 P1-5 |
| **D6** | **`test:staff-directory` 测的是内联副本，不读生产实现**（`admin/src/utils/staffDirectory.js` 从未被读取）→ 生产实现改坏不会红，而它在 `check:admin` 里 | `raw/05` §0 P1-7 |
| **D7** | **仓库卫生**：构建产物**双份入库 14 对逐字节相同（2.91 MB）**；含真实 `_openid`+昵称的结果文件入库（`miniprogram/scripts/cleanup-test-user-data.result.json`）；文件名即手机号（`reset-user-19917242871.result.json`）；遗留物 `Mountain_River_Ultimate_V17_Final.html`（45.9 KB）、`what.v0.1.astro.bak`（601 行）、`_old-monolith.bak.astro`（524 行） | `raw/05` §0 P1-8/P1-9 |
| **D8** | **`docs/README.md` 不存在**，而 `AGENTS.md` 明确要求「上线模块后登记到对应 `docs/README.md` 索引」→ 登记动作无处可落 | 本轮实测 |
| **D9** | **`verify-admin-dist` 强度不足**：只扫 `index.html` + 唯一的 `index-*.js`（懒加载 chunk 内部坏引用检不出），且**硬编码要求 `FulfillmentCenter` chunk 存在** → 该模块一旦改名/下架，构建永久失败 | `scripts/verify-admin-dist.mjs:23,29-33,43-47` |
| **D10** | **`admin/.dash.json:9` 端口 5173 与 `admin/vite.config.js:133` 的 5178 不一致** | `raw/05` §0 P2-2 |

### 0.5 前端与产品面

| # | 结论 | 证据 |
|---|------|------|
| **E1** | **小程序 `subpackages/manager` 原始体积 2.366 MB，超微信「单分包 ≤2 MB」上限 18.3%**（`feature` 1.869 MB / 93.5%）；核心冗余是 `managerPageConfig.js`（10,169 行 / 366 KB）+ `_subviews.wxml`（3,572 行 / 218 KB），占该分包 23.6%。**静态不可裁定最终体积（压缩+剔无用文件后必然更小），须用微信开发者工具「详情 → 本地代码」实测** | `raw/02` §0 P0-1 |
| **E2** | **分包内 21 组同名工具重复 229.6 KB**：`qrcodeGen.js` 2 份逐字节相同（各 56,694 B）、`careDefaults.js` 3 份相同（合计 75,594 B）；`pageNav.js` 三份**已实质分叉**（business 86 行 / feature 60 行）。范本：`subpackages/manager/utils/workspaceRoles.js` 只一句 re-export | `raw/02` §0 P1-4 |
| **E3** | **ERP 轮播预设指向不存在的页面**：`admin/src/utils/bannerNav.js:15` `{id:'store', path:'/pages/store/index'}`，真实路径是 `/subpackages/business/store/index`；仅靠 `miniprogram/utils/bannerNav.js:105` 的 legacy remap 兜住 | `raw/02` §0 P0-2 |
| **E4** | **失败态谎报成功**：`subpackages/business/utils/careHelper.js:193` 在 `showActionSheet` 的 **fail 回调**里弹「已签收 + success 图标」——用户下滑取消也会看到绿色对勾 | `raw/02` §0 P1-3 |
| **E5** | **官网 29 个页面的 OG 图 404**：默认 `/images/hero/home-hero.jpg` 不存在（占位目录 README 自述未放置），只有 2 个页面覆写 | `src/components/Layout.astro:17`；`public/images/hero/README.md:5` |
| **E6** | **官网 `.fade-in` 默认 `opacity:0` 且无 `<noscript>` 兜底** → JS 失败/禁用时 `/digital-ops`（10 处）、`/hardcore-tech`（11 处）等大量区块永久空白 | `src/styles/global.css:480-482`；`src/components/Layout.astro:132-202` |
| **E7** | **官网六观内容有两套并行实现**：live 用 `foundationViewPages.ts`；长版 `foundationSixViews.ts`（256 行）**只被死文件 `_old-monolith.bak.astro` 引用**，其内含的 `#one-percent` 锚点全站无对应 id | `raw/01` §0 P1-7 |
| **E8** | **`@astrojs/check` 声明为依赖但从未被任何脚本或 CI 调用** → TS 类型错误/坏 import 拦不住部署；`admin` 的 `sass`、`chartjs-adapter-date-fns` 同样零使用 | `package.json:84`；`raw/01` §0 P1-5、`raw/05` §0 P2-1 |
| **E9** | **无任何安全响应头**：`public/_headers` 只有 `Cache-Control`，无 CSP / `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options`；`public/404.html` 是 3 行裸 HTML | `public/_headers`、`public/404.html` |
| **E10** | **ERP 台账侧**（详见 `raw/06`）：`App.vue` 5167 行巨型单文件；`products`/`orders` 残余直写；11 处业务级 `db.collection` 绕过 `cloudbaseCdnDb` 包装器（`financeSync.js:78,119,137,145,191,203,205`、`storeLedgerSync.js:238,257,264`、`financeDuplicateCleanup.js:206`）；10 个只写不读的配置屏；`products` 写路径仍有未断言直写 | `raw/06` §3 |

---

## 1. 审计方法与可信度声明

### 1.1 本轮的取证方式

| 方式 | 本轮的落地 |
|------|-----------|
| 本地实测 | 完整 `npm ci`、`npm run check:admin`（19 条）、`npm run build:admin`、`npm run lint:wxml`、`npm run check:fn-integrity`、`npm run check:share-image`、`npm run sync:miniprogram:check`、`npm run check:fn-sync`、`npm run check:cloud-files`、构建产物 grep |
| 线上实测（只读） | 5 次 `GET` 生产域名静态文件 + 2 次 `GET` Pages Functions 状态端点（全部只读，无副作用） |
| 代码读到 | 六份子报告的 `file:line` 证据；主线对高风险结论逐条抽样复核（匿名登录、口令常量、规则分布、代理注入、governance 资产、CI 内容） |
| 未做 | 未连 CloudBase（无凭据）、未连飞书、未动微信支付、未跑 `check:nav-dom`（**本环境无 Chrome 二进制**）、未在真机跑小程序 |

### 1.2 主线对子审计的抽样复核结果

| 子审计结论 | 复核方式 | 结果 |
|-----------|----------|------|
| governance-assets 公网可下载 | `curl` 5 个文件 | ✅ 全部 HTTP 200 |
| `/api/feishu-sync`、`/api/ai` 无鉴权 | `curl` 状态端点 | ✅ 200 + 无任何鉴权挑战 |
| `admin888`/`money888`/`verified_888` 在源码 | `grep` | ✅ `App.vue:1569,2013,2046`、`Finance.vue:1377` |
| 三个口令会进产物 | 完整构建后 `grep public/admin/assets` | ✅ 三者各命中 `index-oYymeOJc.js` |
| 匿名登录 | `read admin/src/cloud.js:95-106` | ✅ `signInAnonymously` 仍在 |
| 规则分布 | 逐份 `JSON.parse` 127 份规则 | ✅ `auth != null` 57 / `false` 46 / `true` 12 / `_openid` 5 + 5 / 其他 2 |
| CI 零守卫 | `read deploy-pages.yml` | ✅ 只有 `npm ci` + `npm run build` |
| `check:share-image` 在 HEAD 失败 | 实跑 | ✅ `EXIT=1` |
| 云函数数 129（非文档声称的 82） | `ls -d miniprogram/cloudfunctions/*/` | ✅ 129 个目录，均有 `index.js` + `package.json` |

### 1.3 子审计报告自身的已知误差（必须记录）

1. **`raw/05`（工程基建）与 `raw/06`（ERP 复核）在 `npm ci` 未装全的窗口内运行**，因此它们记录的
   「`check:sfc-dev` 失败 / 缺 vite / 356 个空壳包」是**环境状态，不是仓库缺陷**。主线修复环境后复跑：
   **`npm run check:admin` 全绿（EXIT=0，19 条全过）**。凡子报告中标注「环境原因，未定性」的条目，以本节为准。
2. `raw/03` 指出台账 md:53 的 `manageManageMemberLevels` 是**文档笔误**（仓库无此函数）。
3. `raw/02` 首轮正则报出的「97 处 tabBar 页用 `navigateTo`」经括号平衡重解析后**全部是 `fail:` 回调假阳性**，
   已在报告中撤回（这正是本项目反复强调的「静态判读 ≠ 事实」）。
4. `raw/01` 的 `astro check`/`astro build` 未能运行（当时依赖未装齐）；主线补跑 `astro build`，见 §2.4。

---

## 2. 基线事实（本轮实测）

### 2.1 仓库规模

| 区域 | 规模（实测） | 与文档声称的差异 |
|------|-------------|----------------|
| 官网 `src/` | 76 文件 / 20,479 行；组件 `.astro` 38；可构建路由 **31** 条 | 根 `README.md:64` 称「15 个组件」；基座 §3.1 路由清单漏 `/notes/founders-letter`、`/notes/rename-notice-insiders` |
| ERP `admin/src/` | 220 文件 / 119,272 行；`.vue` 128；`App.vue` **5,167 行** | 基座声称 `App.vue` 2733 行、模块 65 |
| 小程序 `miniprogram/`（不含云函数） | 1,080 文件 | — |
| 小程序云函数 | **129** 个目录（均含 `index.js` + `package.json`） | 基座/`AGENTS.md` 语境称 **82**；`docs/monorepo.md:70` 称 121 |
| 小程序注册页 | **120**（主包 6 + business 21 / manager 46 / feature 47）；tabBar 5 | 既有审计称「主包 40 + 分包 16」 |
| 云规则 | `cloudbase/rules/*.json` **127**；`miniprogram/database-rules/*.json` **90**；`cloudbase/schema/*.md` **63** | 基座称「集合约 40+」 |
| `COLLECTIONS` 常量 | **63** 条 | 台账曾称 61 |
| 守卫 npm 入口 | **63** 条（`check/report/test/audit/lint/sync:*`） | `AGENTS.md` 称 `check:admin` 为「10 条」，实为 **18** 条 |

### 2.2 三处同步（差集，可复现）

复现命令见 `raw/04` §1.2。本轮输出：

```
counts { COLLECTIONS: 63, rules: 127, schema: 63, mpRules: 90 }
A COLLECTIONS 有、rules 无 (8): equity_goods, feishu_shipments, report_templates,
   store_design_materials, store_design_versions, strategy_research, vip_cards, wish_wall_messages
B rules 有、COLLECTIONS 无: 72
C rules 有、schema 无: 65
D schema 有、rules 无: content_factory（索引页，非集合）
交集 36 / 并集 90
```

> 结论：「三处同步」这一治理约定在当前 HEAD **已事实失效**——`COLLECTIONS` 只覆盖 36/90 的集合，规则目录是唯一「全量」的地方。

### 2.3 守卫基线（本轮实跑）

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run check:admin`（**19 条**） | ✅ **EXIT 0** | `check:sfc-dev` 201/201、`check:nav-sources` 508 项、`check:silent-catch` 基线 0、`test:write-layer`、`test:module-hash` 30、`test:module-search` 49、`test:coupon-floor` 30、`test:staff-directory` 9、`test:finance-read-path` 11、`check:proxy-allowlist` 两侧各 30、**`check:publish-dir`**（A1 处置时新增） |
| `npm run check:fn-integrity` | ✅ EXIT 0 | 129 个函数：均有 `exports.main` / `cloud.init` / `db` |
| `npm run lint:wxml` | ✅ EXIT 0 | 141 个 WXML 文件 |
| `npm run check:share-image` | ❌ **EXIT 1** | 新增 1 处未复核分享封面（`subpackages/feature/identify/result/index.js:737`） |
| `npm run sync:miniprogram:check` | ❌ **EXIT 1** | 死入口：`../WeChatProjects/shanchuanspecimens` 不存在 |
| `npm run check:fn-sync` | ⏭ EXIT 2 | 缺 `TCB_SECRET_ID/TCB_SECRET_KEY`；且该脚本**无 `--selftest`**、`IGNORE` 掉 `config.json` → triggers/permissions 无守卫 |
| `npm run check:cloud-files` | ⏭ EXIT 2 | 同上缺 TCB 凭据 |
| `npm run audit:collections` | ⏭ 未跑 | 同上缺 TCB 凭据 → 「仓库规则 ↔ 线上规则」本轮无法复测 |
| `npm run check:nav-dom` | ⏭ **无法跑** | 需 `npm run dev:admin` + 本机 Chrome。**本环境无任何 Chrome 二进制**（`admin/scripts/lib/cdp.mjs:15-25` 的候选路径全不存在，也无 puppeteer 缓存）→ 报「未找到 Chrome」。**这是唯一能证明界面真画出来的检查，本次未取得界面级证据** |
| `npm run check:admin:selftest` | ⏭ 未跑 | 会临时改源文件再还原；审计期不动源文件，留待后续 |

### 2.4 构建基线

| 步骤 | 结果 |
|------|------|
| `npm run build:admin`（= `vite build`，rolldown-vite 7.2.5） | ✅ 成功，18.73s；产出 `public/admin/assets/` **84 个文件 / 7.9 MB**、`index.html` |
| `astro build` | ✅ 成功：**31 个页面**，25.13s，`sitemap-index.xml` 生成。⚠️ 首次失败于 `EACCES: mkdir '/home/admin/.config/astro'`（Astro telemetry 写 `$HOME`，被沙箱拒绝）——**环境限制，非仓库缺陷**；`ASTRO_TELEMETRY_DISABLED=1` 可绕过（GitHub Actions 的 `$HOME` 可写，不受影响） |
| `node scripts/verify-admin-dist.mjs` | ✅ **EXIT 0**：`✓ 密钥扫描通过（比对 0 个构建环境密钥，扫描 85 个产物文件）`、`✓ dist/admin 已就绪（index.html + 84 个 assets，校验 42 个引用）` |
| **产物密钥扫描（主线补做，与上一条同时）** | ❌ **`verify-admin-dist` 报「密钥扫描通过」的同一份产物里，`admin888` / `money888` / `verified_888` 三者各命中 1 个 chunk**（`dist/admin/assets/` 与 `public/admin/assets/` 均是）。原因：该闸门只比对**构建环境变量的值**（本轮为 0 个）＋正则仅覆盖 `sk-`/`adminOpsKey`/`VITE_ADMIN_OPS_KEY`，**不覆盖这三个源码常量** → **闸门绿灯与凭据泄露同时成立** |
| `dist/` 端到端复核 | `dist/` 38 MB；**`dist/admin/governance-assets` = 1.2 MB / 33 个文件**（与 A1 的线上 HTTP 200 相互印证：构建确实把它们放进了发布产物） |

### 2.5 环境坑（影响任何新接手的人）

1. **本机 `NODE_ENV=production` 是预设的** → 直接 `npm ci` 会**静默省略全部 devDependencies**（`vite`、`@vitejs/plugin-vue`、`wrangler` 全缺），
   于是 `npm run build` / `dev:admin` / `check:sfc-dev` 全部报「找不到 vite」。正确命令：**`npm ci --include=dev`**。
   这条应写进 `AGENTS.md` / `docs/monorepo.md` 的环境小节，否则每个新环境都会重踩。
2. **npm 默认缓存目录 `~/.npm` 在沙箱外不可写** → 需 `--cache <可写目录>`。
3. **`astro build` 需要可写 `$HOME`**（telemetry）→ 沙箱/容器里加 `ASTRO_TELEMETRY_DISABLED=1`。
4. `/tmp` 在本环境**跨轮次会被清空**，长任务的日志应写进仓库内临时目录。

---

## 3. 与既有审计台账的关系（明确「哪些是新的」）

| 来源 | 覆盖 | 本轮增量 |
|------|------|---------|
| `admin/docs/ERP系统专项审计_2026-09-16.md` | ERP 深度（P0-1…P0-21 + P1/P2 + 附录 C 台账） | 复核 21 条现状（10 仍成立 / 5 部分修复 / 6 已修）；**更正台账 2 处过时表述**；新增 11 处绕过包装器的直写 |
| `docs/小程序开发现状审计_2026-09-14.md` 等 5 份 | 小程序历史审计 | 核实页面注册零缺陷、客户端直写 0 处、口令已清除、首页刷新已修；**新发现分包超限风险与 229.6 KB 冗余** |
| `docs/跨端开发进度与持续开发基线_2026-09-15.md` | 跨端进度 | 该文已正确指出 129 云函数、旧基座数字失效 —— 与本轮一致 |
| **本轮全新** | 官网深审、云底座/边缘函数、工程基建/CI、线上暴露探针 | **A1–A4（4 条公网暴露，线上实测）**、B3/B4/B5、C2–C5、D1–D10、E1–E9 |

**台账口径提醒**：台账附录 C 的 `✅ 已完成（本地）` 至少 6 条（P0-3/P0-4/P0-5/P0-6/P0-8/P0-19）的实质是
**「把谎话改成真话」**（不再假成功、改为如实报错），**功能本身仍未通**。按 C.1 估算剩余 P0 量会**系统性低估**。

---

## 4. 处置路线（建议顺序）

### 第 0 批 · 今天（止血，不需业务决策）

1. **A1**：把 `governance-assets/` 移出发布目录（`public/` 与 `admin/public/` 两处副本），或对 `/admin/governance-assets/*` 加 404；
   ✅ **已于 2026-09-17 完成本地止血并验证**（见 §7），**但需重新部署才真正生效** —— 生产站当前仍可下载（32/33 HTTP 200）；
   同时加一条**发布目录白名单守卫**（`--selftest`）。**注意需重新部署才生效。**
2. **A2/A3**：给 `/api/feishu-sync`、`/api/ai` 加会话校验（复用 `proxySession` 或新签发 Pages 侧令牌）+ 速率限制；
   去掉 `Access-Control-Allow-Origin: *` 或收紧为站点源；`/api/feishu-sync` 的 `status` 不得再回显 `appToken`。
3. **A4**：把 `admin888`/`money888`/`verified_888` 从源码常量移除（改服务端会话探活），并**扩充 `verify-admin-dist` 密钥正则**到这三个值（宁可先让构建失败）。
4. **D3**：修 `subpackages/feature/identify/result/index.js:737` 的分享封面（用 `resolveShareImage()` 或省略 `imageUrl`），让 `check:share-image` 转绿。

### 第 1 批 · 本周（把闸门装上）

5. **D1**：CI 增 `pull_request` 触发 + 在 `npm ci` 后插入 `npm run check:admin`（含 `--include=dev`）、`lint:wxml`、`check:fn-integrity`；
   把「跑守卫」做成**合并前**条件，而不是 main 落地后的自查。
6. **D2**：把 `check:admin` 从 `&&` 链改成「逐条执行 + 汇总报告 + 任一失败即非 0」（一个 30 行的 runner 即可），
   避免第一条失败吞掉其余 17 条。
7. **D5/D6**：给三条无 `--selftest` 的守卫补自检；`test:staff-directory` 改为**读生产实现**；给三个无入口的测试补 npm 入口。
8. **D4**：删掉 `sync:miniprogram` 死入口（或改为「同仓校验」模式），不要在合并路径上留一个恒 red 的脚本。
9. **B5**：本地 Vite 代理注入 `ADMIN_OPS_KEY` 前**校验会话 Cookie**；`server.host` 默认改 `127.0.0.1`（需要局域网调试时显式打开）。
10. **B6/B7**：`ADMIN_PROXY_SECRET` 强制独立（缺失 fail-closed）；删掉 `VITE_ADMIN_OPS_KEY` 回退；令牌加用户标识 + nonce + 吊销。
11. **D7/D8**：清理入库的构建产物双份、PII 结果文件、遗留 `*.bak`/`Mountain_River_Ultimate_V17_Final.html`；新建 `docs/README.md` 索引。

### 第 2 批 · 两周（把功能打通）

12. **C1**：ERP 写路径收口——`products`/`orders` 残余直写改走代理；退款链改走服务端 staff 通道（需要 ERP 侧有**真实服务端身份**，见第 3 批）。
13. **C2**：建三个唯一索引（`point_records`/`store_purchases`/`platform_order_binds` 的 `dedupeKey`）+ provision 脚本 + CI 巡检；
   修 `transferCoupon` 锁券、`receiveCoupon` 库存负数、`earnPoints` count→add。
14. **C3/C5**：`payCallback` 履约标记写失败必须 `success:false` 并触发重试；4 个函数补 `config.json` openapi 声明（先与控制台核对）。
15. **C4**：`managerShipOrder` 补 `isNonClientSource()` 门，与其余 6 处对齐。
16. **C6/C7/C8**：`refund_rejected` 补恢复入口；审批队列 `scope:'all'`；`stock_movements` 与库存变更同事务。
17. **B1/B2/B4**：读路径迁入鉴权通道后，把 56+ 个匿名可读集合收紧；`admin_users`/`admin_roles`/`price_list_items`/`purchase_intents` 优先。
18. **B3**：官网采购意向回退改为「明确告知未送达 + 提供重试/复制」，或去掉 localStorage 谎报成功分支。
19. **E1/E2/E3**：用小工具实测 manager 分包体积；抽公共工具到主包；修 ERP 轮播预设路径。
20. **E5/E6/E8/E9**：补 OG 默认图；`.fade-in` 加 `no-JS` 兜底；把 `astro check` 接进 CI；补安全响应头。

### 第 3 批 · 结构性（需产品/架构决策）

21. **按人账号 + 真实权限点**（这是 C1/B2/B6 的共同前提）：当前单一共享 `ADMIN_OPS_KEY` = 超管、审计身份恒为 `admin_web`。
    顺序应是 **按人账号 → 真实权限点 → 前端 RBAC**（详见 ERP 台账 §7.5）。
22. **治理约定收敛**：`cloudbase/rules/` ↔ `miniprogram/database-rules/` 合并为单一 SSOT；
   建立「集合名 / 规则 / schema / COLLECTIONS」四向一致守卫（当前交集仅 36/90）。
23. **ERP「低频但更全面」决策落地**（台账 §7.4 七阶段）。
24. **术语与调色板收敛**（台账 C.2：三套绿/中性调色板、262 处无证据的绿色残留、`--light-text-tertiary` 自身不达 AA）。

---

## 5. 未验证清单（诚实声明）

| 项 | 缺什么 | 怎么验 |
|----|--------|--------|
| 全部「线上安全规则」类结论（B1/B2/B4、台账 P0-1/P0-4/P0-11） | `TCB_SECRET_ID/KEY` | 配 `admin/.env` 后 `npm run audit:collections`（含 `:selftest`） |
| 线上云函数 ↔ 仓库 sha1 一致性 | 同上 | `npm run check:fn-sync` |
| A1 的完整文件清单（是否 33 份全部可下载） | ✅ **已补测**：33 个文件中 **32 个返回 HTTP 200**（逐个 `curl`，见 §7）；剩余 1 个返回 308 | — |
| 小程序分包是否真超 2 MB | 微信开发者工具 | 「详情 → 本地代码/分包大小」 |
| 4 个云函数的 openapi 内容安全权限 | 云开发控制台 | 核对 `mediaCheckAsync`/`msgSecCheck` 勾选状态 |
| `managerShipOrder` 审计归属是否可伪造 | 真实 ERP 会话 | 发 `{_fromApproval:true,_callerOpenid:'<店员>',...}` 后查 `staff_audit_logs.openid` |
| `doc._openid == auth.openid` 在两侧皆 `undefined` 时是否判真 | 匿名会话读一个无 `_openid` 的文档 | 浏览器匿名会话直读 |
| 界面是否真渲染（ERP） | **本环境无 Chrome 二进制** | 在装有 Chrome 的机器上 `npm run dev:admin` 后 `npm run check:nav-dom` |
| 弱网启动白屏（CloudBase CDN / Google Fonts / Font Awesome） | 限速环境 | `check:sfc-dev` 只覆盖编译层 |
| `keep-alive :max=10` + 全局 `reloadKey` 是否真泄漏实例 | 浏览器 DevTools | 台账已提出，静态读不出结论 |

---

## 6. 子报告索引（证据原文）

| 文件 | 内容 | 行数 |
|------|------|------|
| `raw/01_官网.md` | Astro 官网：路由清单、死文件、OG、双主题、转化链路、`.bak` | 500 |
| `raw/02_小程序前端.md` | 页面注册、分包体积、重复工具、错误吞噬、i18n、文档漂移 | 366 |
| `raw/03_小程序云函数.md` | 129 函数清单、共享库副本漂移、幂等/资损、集合引用、既有结论复核表 | 343 |
| `raw/04_云底座与边缘函数.md` | 规则分布、三处同步差集、两套规则目录、Pages Functions 安全 | 379 |
| `raw/05_工程基建与文档治理.md` | 守卫/CI 实况、构建管线、依赖、仓库卫生、文档索引、时间线 | 314 |
| `raw/06_ERP现状复核.md` | ERP 台账 P0-1…P0-21 逐条现状 + 三处注册核查 + 新增发现 | 458 |
| `后续工作基座.md` | **下一步怎么改、怎么验、守什么纪律**（与本文配套） | — |

---

## 7. 处置记录（滚动）

### A1 · 内部治理文档公网暴露 —— 仓库侧已止血（2026-09-17）

| 项 | 内容 |
|----|------|
| **做了什么** | ① `git rm -r public/admin/governance-assets`（33 份发布副本移出仓库）；② `scripts/build-admin.mjs` 在 Vite 构建后**强制剔除** `public/admin/governance-assets/` 并断言剔除成功；③ `scripts/verify-admin-dist.mjs` 新增「内部资料闸门」（`dist/admin/governance-assets` 存在即阻断部署）；④ 新增守卫 `npm run check:publish-dir`（R1 发布目录不得含内部资料 / R2 单一事实源必须完好 / R3 已构建 dist 不得含内部资料 / R4 `public/**` 不得出现 Office 二进制），带 `--selftest` 并接入 `check:admin`；⑤ `public/_redirects` 对 `/admin/governance-assets/*` 返回 404；⑥ ERP「公司治理」页加**诚实横幅**（说明公开站点上预览/下载会失败，属预期行为） |
| **单一事实源** | `admin/public/governance-assets/`（33 份，保留；本地/私有环境可用）→ 但它在 `admin/public/`（Vite publicDir）里，靠 ② 的构建期剔除保证不上线 |
| **验证** | `npm run build` **EXIT 0**；构建日志 `✓ admin 已构建到 public/admin/（已剔除内部资料：governance-assets）`；`public/admin/governance-assets` = **0**；`dist/admin/governance-assets` = **0**；`admin/public/governance-assets` = **33**（事实源完好）；`npm run check:publish-dir` ✅；`npm run check:publish-dir:selftest` ✅（2 项注入全部检出、探针无残留）；`npm run check:admin` **19 条全绿** |
| ✅ **线上处置结果（已部署）** | 提交 `fce46ae` + `5bc3d22` 已 rebase 到 `origin/main` 并推送（`25462bf..5bc3d22`），CI 已部署。**线上确认**：入口 chunk 变为本次构建的 `assets/index-If-Tq7rL.js`，且该 bundle 内含本次新增的横幅文案 → 部署确属本次提交。<br>**源站已彻底干净**：对 33 个路径逐个带 cache-buster 请求 → **33/33 全部 HTTP 404**。<br>**方法学对照**（排除「加查询串导致假 404」）：`/admin/robot-icon.svg`、`/admin/vite.svg`、`/admin/assets/index-If-Tq7rL.js` 加同样的 `?cb=…` 均仍为 200；目标文件则 `无参数=200`、`?cb=audit1/audit2/?v=1=404` ⇒ 残留确为缓存 |
| ⏳ **仍需你执行的一步：清除 Cloudflare 边缘缓存** | 无参数请求仍命中**部署前的旧副本**（部分 POP：`cf-cache-status: REVALIDATED`，`cache-control: public, max-age=14400`），**源站已无该文件**。清除方式（任选其一，均需 Cloudflare 凭据，本环境没有）：<br>· 控制台：Caching → Configuration → **Purge Cache → Custom Purge → by prefix** = `shanhaizaowu.com/admin/governance-assets/`（或 Purge Everything）；<br>· API：`POST /zones/{zone_id}/purge_cache`，body `{"prefixes":["shanhaizaowu.com/admin/governance-assets/"]}`；<br>· 不操作的话，`max-age=14400` 过期后也会自然失效（最坏约 4 小时），但**期间仍可下载**，建议主动 purge。<br>另注：被缓存的响应对**带查询串**的请求早已 404，因此「贴到别处的链接」已失效，只剩直链精确 URL 还能取到旧副本 |
| ⚠️ **基线已漂移（重要）** | 处置过程中发现：**远端 `origin/main` 已从本报告的基线 `2db36dc` 前进到 `25462bf`（远端领先 33 个提交，本地领先 0）** —— 并行工作流在此期间推进了部署基建（登录网关替代 Caddy、边缘网关 Worker、内存护栏、祈福墙、百科注册门禁等）。**本报告的其余结论均以 `2db36dc` 为准，尚未在 `25462bf` 上复测。** 好消息：这 33 个提交**没有**动 `governance-assets`、`scripts/build-admin.mjs`、`scripts/verify-admin-dist.mjs`、`public/_redirects`；只有 `package.json` 被改过 2 次（rebase 时可能需处理）。 |
| ⚠️ **旁证（好消息）** | `https://api.github.com/repos/haydenbilibili-maker/shanchuan-zaowu-site` → **HTTP 404**（对未认证请求即私有仓）→ 这些文档未通过公开 Git 仓库泄露 |
| ⚠️ **顺带确认** | 线上入口 chunk `assets/index-LrrilMxJ.js` 中 `admin888` 命中 **2 次**、`verified_888` 命中 **2 次**（`money888` 在懒加载 chunk 中，本轮未取）→ **A4 在线上已经成立**，不是「部署后才会发生」。因此「为 A1 部署一次」不会新引入 A4；但反过来，A4 需要在部署前或部署后单独收口 |

**处置进度**：
1. ✅ **已完成**：A1 修复已 rebase 到最新 `origin/main` 并推送（`25462bf..5bc3d22`），CI 已部署，**源站 33/33 返回 404**；
2. ⏳ **待执行（唯一剩余步骤）**：**清除 Cloudflare 边缘缓存** —— 见上表「仍需你执行的一步」。这一步需要 Cloudflare 凭据（控制台或 API），本环境没有；
3. 📌 **后续可选加固**：对该前缀加 Access 策略 / WAF 阻断规则，或在边缘网关统一拦截（远端已新增登录网关与边缘 Worker，`3d623c2`/`a46fbe4`/`efaf920`）—— 避免同类路径再次被静态发布。

**建议同时评估**：`admin/public/` 里另外几个**也被公开发布**的文件 —— `sanyou-minglu.pdf`（2.1 MB）、`shanhai-capital-architecture-sandbox.html`（123 KB）、`shanhai-studio-startup-cost-model.html`（41 KB）、`partner-destiny-center.html`（529 KB）。它们各自被 ERP 代码引用 1 次（经 `embeddedPageUrl` 作为内嵌演示页），**不是误放**，但「资本架构沙盘 / 创业成本模型 / 三友名录」是否适合公网需要产品判断；本轮**未改动**它们。

### 推送与 rebase 记录（2026-09-17）

按产品负责人指示「rebase 到最新 `origin/main` 并推送」，执行过程与结果：

| 项 | 内容 |
|----|------|
| 提交 | `fce46ae fix(publish): 内部治理文档不再随站点发布…` + `f5d0a58 docs(audit): 全面审计报告…`，rebase 到 `origin/main`（`25462bf`）之上 |
| 冲突 | 仅 `package.json`（远端改过 2 次）。解析口径：**保留远端全部守卫 + 追加 `check:publish-dir`** |
| 提交者身份 | 本机未配置 git 身份，为免冒用，本次提交署名为 `DSH Agent <dsh-agent@users.noreply.github.com>`。如需归到本人：`git commit --amend --author="Hadyen <hayden.bilibili@gmail.com>"` |
| 🔎 **远端已部分解决本报告的问题** | rebase 后发现 `25462bf` 已把 `check:admin` 从 **19 条扩到 49 条**（自检链 47 条），并且：**D5 的「漏网守卫」已收敛**——`lint:wxml`、`check:miniprogram-sync` 现在都在链内；**D4 的死入口已修**（新增 `check:miniprogram-sync:selftest`）；**D8 的 `docs/README.md` 缺失已由本次提交补上**。**D1（CI 不跑守卫、无 PR 触发）与 D2（`&&` 单链）在 `25462bf` 上是否仍成立，本次未复核** —— 需在 `25462bf` 上重新执行 §2.3 的命令集。 |

### 第二批整改（2026-09-17 18:00 后，提交 `fa3742b` / `4310858` / 本批）

| 项 | 状态 | 证据（可复跑） |
|----|------|----------------|
| **A2 `/api/feishu-sync` 无鉴权** | ✅ **已修，线上验证** | 修前 `GET` 返回 `{success:true,configured:true,appToken:"WCs2…"}`；修后 **HTTP 401** UNAUTHORIZED、响应体不再含 `appToken`；非白名单 `Origin` → **403**。改动：接入统一闸 `guardAdminRequest`（`_lib/proxySession.mjs` 新增）、CORS 从 `*` 改为 `corsHeaders()`、`withoutAppToken()` 剥离文档标识 |
| **A3 `/api/ai` 无鉴权（开放付费 LLM 网关）** | ✅ **已修，线上验证** | 修前 `GET` 返回 `{ok:true,configured:{deepseek:true}}`；修后 **HTTP 401**。`/api/cloud-fn` 同步改用同一实现（保留 GET 探活免会话语义，仍不回显配置细节） |
| **B5 本地代理无条件注入超管密钥 + `host 0.0.0.0`** | ✅ **已修，起真 dev server 实测** | 修后：监听地址只剩 `127.0.0.1:5178`（`ss -ltnp` 实测）；跨源 `POST/GET /api/cloud-fn` → **403**；同源 POST 放行并落到业务错误。改动：`viteCloudFnPlugin.mjs` 加 `devOriginAllowed()`（语义同生产 `originAllowed`）、`vite.config.js` 的 `host` 默认 `127.0.0.1`（要局域网调试须显式 `ADMIN_DEV_HOST=0.0.0.0`） |
| **B3 转化链路谎报送达（P0 静默丢单）** | ✅ **已修，产物级验证** | 回退分支由 `ok:true` 改为 **`ok:false` + `delivered:false`**，本机草稿不再被当作已提交；页面文案去掉「本机暂存；云端就绪后可同步」的假承诺；新的诚实文案已出现在构建产物 `dist/_astro/price-list.astro_astro_type_script_index_0_lang.*.js`；死代码 `listLocalPurchaseIntents` 删除 |
| **A4 前端假登录 + 明文口令** | ✅ **已按决策 A 落地，产物级验证** | ① 三处明文口令全部改为 **DEV 门控**（`import.meta.env.DEV ? (env \|\| '旧值') : ''`）→ 生产构建由 Vite 死代码消除移除；**实测 `dist/admin/` 内 `admin888`/`money888`/`verified_888` 命中文件数 = 0**（此前 `admin888` 与 `verified_888` 在入口 chunk、`money888` 在 Finance chunk）<br>② `verify-admin-dist` 的密钥正则**扩到这三个值** → 谁写回源码谁构建失败（已实测闸门通过）<br>③ 财务/合伙人二次门：未配置时**随管理会话直接开放**并在页面如实标注（`financeGateDisabled`/`gateDisabled`），不再用公开在包里的口令假装有门；空口令绝不当口令比对（否则空输入即解锁）<br>④ `verified_888` 魔法串删除，登录态改由**服务端会话探活**决定：新增 `GET /api/admin-session` → `{active}`（`probeAdminSession()`）；顺带修掉一个隐患——原先 `GET` 与 `DELETE` 同义（= 登出），任何预取/直链都会把运营踢下线，而前端从未用 GET 登出<br>⑤ 两个注入登录态的守卫脚本（`check-nav-dom`、`report:colors --verify`）改为从 `cloudFnErrors.js` 引入同一个 token 常量，不再各写一份魔法串<br>⚠️ **未验证**：界面行为（本环境无 Chrome）—— 探活路径只做了 Node 侧行为测试与编译级验证；生产首次生效后建议人工看一眼「刷新页面是否仍在线」「财务页是否直接打开」 |
| **A4 追加决策项（未做）** | 📋 | 若要**真正的**二次门（服务端校验 + 独立作用域 Cookie，即报告 §7 选项 B），需新增 `/api/finance-session` 并在 Cloudflare 配 `FINANCE_PROXY_PASSWORD`；当前决策 A 下财务/合伙人是「随管理会话开放」 |
| **C5 云函数 openapi 声明缺失** | ✅ **已补，并加守卫**（⚠ 需重新上传云函数才生效） | 逐函数对比「代码里真的调了 `cloud.openapi.<ns>.<method>`」与「`config.json` 的 `permissions.openapi`」，**17 个函数用到 openapi、共 27 项声明**，修前有 **4 个函数缺声明**：`grantStorePoints`/`submitComment`/`upsertUserProfile` 缺 `security.mediaCheckAsync`（音视频异步检测 → 内容安全形同虚设）、`identifySpecimen` 还缺 `security.msgSecCheck`。已补齐；新增 `check:fn-openapi`（8 项自检，含两条防正则吃注释的用例）<br>⚠️ **这 4 个函数的 `config.json` 必须在微信开发者工具里重新上传**才对线上生效 —— 本轮只改了仓库 |
| **D7 仓库卫生（构建产物双份 + PII 入库 + 孤儿代码）** | ✅ **已清，构建验证无损** | ① `public/admin/` 下 7 项与 `admin/public/` 逐字节相同的副本（`brand/`、`sanyou-minglu.pdf` 2.1MB、`partner-destiny-center.html` 520KB、`shanhai-capital-architecture-sandbox.html`、`shanhai-studio-startup-cost-model.html`、`robot-icon.svg`、`vite.svg`，共约 2.9MB）移出仓库；`.gitignore` 由「只挡 assets/ + index.html」改为整目录忽略 + 放行两个手写文件。**验证**：`rm -rf dist && npm run build` 后这些文件全部由 `admin/public/` 重新生成到 `dist/admin/`（`brand/vis-logo-D-mark.svg`、`sanyou-minglu.pdf`、`robot-icon.svg`、`shanhai-*.html` 均存在 ✓），线上资源不受影响<br>② **23 份 `miniprogram/scripts/*.result.json` 脚本运行产物**移出仓库（`.gitignore` 加 `/miniprogram/scripts/*.result.json`）——其中 **14 份含真实 `_openid`、2 份含昵称**（`cleanup-test-user-data.result.json` 实测含 `_openid` + 昵称「令狐冲大哥」+ 32 个关联用户）。抽查另三份含密钥**字段名**的（`merge-admin-ops-key`/`provision-manager-ui-password`/`provision-honorary-curators`）确认**只有 key 名与元数据、无密钥值**<br>③ 删除 3 个零引用组件（`AudienceCard`/`CommitmentBar`/`WIPNotice`）与 `src/content/who-ip.md`；`README.md` 的组件树不再宣传已删组件（原写「15 个组件」，实为 23 个顶层 / 38 个含子目录），路由清单补齐 `/price-list`、`/partner/brand`、`/foundation/*`、`/notes/*` |
| **仍待处置（需你确认）** | ⏳ | `Mountain_River_Ultimate_V17_Final.html`（根目录与 `admin/` 各一份，各 45.9KB）、两处 `.bak` 页面（`what.v0.1.astro.bak` 601 行、`foundation/_old-monolith.bak.astro` 524 行 —— 后者是 `src/data/foundationSixViews.ts`（256 行长版六观文案）的**唯一消费者**，删它等于删那版文案）。`docs/项目总览与后续工作框架.md` 早就写明退役需你确认，故本轮**未动** |
| **新增守卫 4 条（52 → 55）** | ✅ | `check:api-auth`（静态，11 项自检，含本地 dev 代理两条不变式）、`test:api-auth`（**行为**：真跑三个 `onRequest`，11 项断言 + 摘闸自检）、`check:site-fallbacks`（6 项自检）、以及此前的 `check:caller-openid-gate`。`npm run check:admin` **55 条全绿**；`npm run build` EXIT 0 |

> **验证方式说明**：`test:api-auth` 在 Node 里直接 import 三个 `onRequest` 并用真实 `Request` 驱动
> （Node 22 原生具备 Web Crypto/Request/Response），断言「无 Cookie / 过期 / 伪造签名 / 未配置口令 /
> 非白名单来源全部被拒」且「合法会话可过闸走到 503 AI_KEY_NOT_CONFIGURED」，
> 另含两条**负向对照**（换签名密钥即失效、无 Origin 无 Cookie 仍 401）证明断言不是空转。

---

*本报告为 2026-09-17 的快照。凡「子审计」级结论，原文都有 `file:line`；凡「线上实测」级结论，本轮均可直接复跑。
结论随代码演进会失效——改动后请重新执行 §2.3 的命令集，并同步修订本报告。*
