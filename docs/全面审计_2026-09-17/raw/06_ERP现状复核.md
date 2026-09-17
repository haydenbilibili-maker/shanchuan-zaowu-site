# 06 · ERP 现状复核（审计日期 2026-09-17）

> **专项**：`admin/docs/ERP系统专项审计_2026-09-16.md`（704 行，P0-1…P0-21）的**独立复核**。
> **对象**：`admin/`（Vue 3 + Element Plus，`App.vue` 5167 行）+ 其依赖的 `miniprogram/cloudfunctions/`（129 个）。
> **基线 HEAD**：`2db36dc feat(booking): 预约核销接入云函数 verifyBooking`（工作树干净，无未提交改动）。
> **方式**：只读。台账行号一律重新定位，未照抄。
> **证据级别**：`代码读到` = 直接读到当前文件内容；`命令实测` = 本次运行了命令并附输出摘要；
> `未运行` = 环境缺依赖/凭据，明确写出缺什么。
> **重要环境限制（影响多条）**：
> - `admin/node_modules/` **只有 3 个包，没有 vite**（`admin/node_modules/vite` 目录为空）→ `npm run check:sfc-dev` **本次跑不了**（报 `ERR_MODULE_NOT_FOUND: admin/node_modules/vite/index.js`）。
> - `npm run audit:collections` **跑不了**（缺 `TCB_SECRET_ID/TCB_SECRET_KEY`）→ 所有「线上规则」类结论**本轮无法验证**，只能读仓库规则。

---

## 0. 结论摘要

| 分类 | 条数 | 条目 |
| --- | --- | --- |
| **仍成立** | **10** | P0-1、P0-2、P0-9、P0-10、P0-11、P0-12、P0-13、P0-17、P0-18、P0-19 |
| **部分修复** | **5** | P0-3、P0-4、P0-5、P0-6、P0-8 |
| **已修复（本地）** | **6** | P0-7、P0-14、P0-15、P0-16、P0-20、P0-21 |
| **无法判定** | **0** | —（但 P0-1/P0-4/P0-11 的**线上侧**本轮无法复测，见 §5） |

> 计数校验：10（仍成立）+ 5（部分修复）+ 6（已修复）= **21**。摘要口径以 **10 条「仍成立」** 为准。

**三条最重要的判断（与台账不同的地方）**：

1. **台账附录 C 的「已完成」多数只在代码侧成立，核心功能仍未通**。P0-5 的 10 个集合里，
   ERP 侧 8 个已无直写（`COUPONS/POINT_RECORDS/USERS/SHIPPING_RULES/BOOKINGS/SUPPORT_TICKETS/FINANCE_RECORDS/STORE_LEDGER`
   经 `cdn*` 包装器 + 断言），但 **`products` / `orders` 仍有直写**，
   规则仍是 `write:false`（`cloudbase/rules/products.json`、`orders.json`）→ **点保存依旧不落库**，
   只是现在会**如实报错**而不是假成功。这属于「把谎话改成真话」，不等于「把功能修好」。
2. **P0-8 的机制描述已过时**：`Orders.vue` **确实调用了 `refundOrder`**（`:576`、`:614`，
   且 `refundOrder` 在两侧白名单里）。但 `refundOrder` 服务端要求 staff 身份
   （`refundOrder/index.js:7,489-492` 的 `assertStaff`），而 ERP 是 Web 匿名会话 →
   **点「退款」仍然退不了钱**，只是现在会弹「需在小程序完成退款」。结论仍成立，成因不同。
3. **P0-19（`stock_movements` 为空）结论成立，但仍无仓库内复现手段**：`manageStoreShipment/index.js`
   全文件仍 **0 处** `stock_movements` / 库存扣减；两个写入方（`admin/src/utils/b2bFulfillment.js:239`、
   `admin/src/utils/feishuSync.js:812`）都在**前端**，且都被前置的 `products` 写失败拦住。

---

## 1. P0-1…P0-21 现状复核表

状态口径：`仍成立` = 当前 HEAD 仍能读到台账描述的事实；`部分修复` = 同一问题被改小/改诚实，但核心未解决；
`已修复` = 当前 HEAD 已读不到原事实（**仅代表本地代码**，线上规则类未部署）。

| # | 台账结论（2026-09-16） | 现状 | 当前证据（file:line） | 级别 |
| --- | --- | --- | --- | --- |
| P0-1 | ERP 数据面匿名可读（56 集合 `auth != null` + 12 个 `read:true`） | **仍成立** | 匿名登录仍在：`admin/src/cloud.js:99-103`（`signInAnonymously`）、`admin/src/utils/cloudbaseCdnDb.js:100,109`；仓库规则实测 `read:true` **12** 份、`"auth != null"` **57** 份（`ls cloudbase/rules/*.json`=127）。**线上未复测**（缺 TCB 凭据） | 代码读到 |
| P0-2 | 前端不存在登录（`localStorage.sc_admin_token === 'verified_888'` + 常量口令） | **仍成立** | `admin/src/App.vue:2013`（读）、`:2046`（写 `'verified_888'`）、`admin/src/utils/cloudFnErrors.js:17`；口令常量 `admin/src/App.vue:1569`（`VITE_ADMIN_PASSWORD \|\| 'admin888'`）；全仓无 vue-router（`grep -rn "vue-router" admin/src` 命中 0） | 代码读到 |
| P0-3 | `confirmPayment.adminFulfill` 可免付款履约 | **部分修复** | `miniprogram/cloudfunctions/confirmPayment/index.js:16-20` 新增 `isAdminOpsCall(event)`，`:77-80` 非代理调用直接 `FORBIDDEN` → **未授权者已挡住**。但 `:19` 仍是明文比对同一个 `ADMIN_OPS_KEY`（= 超管共享密钥，无按人归属）；`:47-49` 的 `transactionId` **仍完全来自 `event`**，**仍不向微信核验**；`:51-59` 的写失败仍被 `.catch(console.warn)` 吞 | 代码读到 |
| P0-4 | 权限模型本体对公网开放读写（`admin_roles`/`admin_users`） | **部分修复** | ERP 侧写入路径已按决策 B 移除：`admin/src/components/PermissionManager.vue:19`（文案标「只读」）、`:384`/`:403` 仅 `fetchCollectionLimit` 读。但**线上集合规则**（`read`+`write` 均 `auth != null`）本轮**无法验证**，且这两个集合仍无鉴权消费方（`staffGuard` 走 `staff_members`/`workspace_acl`） | 代码读到 + 未运行 |
| P0-5 | 10 个集合「点保存但不落库」 | **部分修复** | 规则未变：`cloudbase/rules/{products,orders,coupons,finance_records,store_ledger,point_records,users,shipping_rules,bookings,support_tickets}.json` **全部 `write:false`**。ERP 侧：`COLLECTIONS.COUPONS/FINANCE_RECORDS/STORE_LEDGER/POINT_RECORDS/USERS/SHIPPING_RULES/BOOKINGS/SUPPORT_TICKETS` 的 `cdn*` 直写已 **0 处**；`PRODUCTS` 仍 2 处、`ORDERS` 仍 3 处（`grep -rn "COLLECTIONS\.\(PRODUCTS\|ORDERS\)"`，见 §3.4）。写层已改为权限被拒即抛：`admin/scripts/check-write-verify.mjs` 实测「残余 66 处（`updated:0` 类），权限被拒已由包装器集中抛出」 | 代码读到 + 命令实测 |
| P0-6 | `coupons` 与 `refunds` 在三个平台都没有可用写入路径 | **部分修复** | `refunds`：`admin/src/components/Refunds.vue:439-458` 的 `ensureRefundDoc` 走 `cdnAdd`/`cdnUpdate`，但 `orders` 那一步有断言（`:476`、`:517`）。`coupons`：`admin/src/components/Marketing.vue:723,726` 仍是 `cdnUpdate`/`cdnAdd` 直写 `coupons`（`write:false`）；`:673` 已加「集合未创建无法保存」提示与禁用，但**没有**「已创建但无权限」的分支。云函数侧仍无 `coupons` 写入 action | 代码读到 |
| P0-7 | `cdnUpsertDoc` 首次保存静默丢失（`try{update}catch{add}`） | **已修复** | `admin/src/utils/cloudbaseCdnDb.js:608-630` 已改为「先看写结果」（`if (writeApplied(res)) return res`），仅识别 `not exist` 类错误才转 `add`，权限/网络错误照抛；`:619-628` 有注释说明 CloudBase `update` 返回 `{updated:0}` 不抛错。`npm run test:write-layer` 在 `check:admin` 串内（本次未单跑，见 §5） | 代码读到 |
| P0-8 | 退款：ERP 侧批了、订单没动 | **部分修复** | 批/拒改为断言 + 失败弹窗：`admin/src/components/Refunds.vue:472-486`（批准）、`:512-521`（拒绝）。`Orders.vue` 已接线 `refundOrder`：`:576`（执行退款）、`:614`（确认收回）—— **台账「`refundOrder` 从未被调用」已过时**。但服务端 `refundOrder/index.js:489-492` 要 staff 身份，ERP Web 匿名 → **仍不会真正退款**，只是诚实提示（`:580-586`、`:582`） | 代码读到 |
| P0-9 | 财务门禁是前端常量 `money888` + `localStorage` 自签解锁 | **仍成立** | `admin/src/components/Finance.vue:1377`（`VITE_FINANCE_PASSWORD \|\| 'money888'`）；`admin/src/components/PartnerDestinyCenter.vue:91`（`DEFAULT_PASSWORD = 'admin888'`） | 代码读到 |
| P0-10 | 单一共享密钥 = 超管（`ADMIN_OPS_KEY`） | **仍成立** | `miniprogram/cloudfunctions/*/staffGuard.js` 命中 `ADMIN_OPS_KEY`（如 `manageApprovals/staffGuard.js`）；`confirmPayment/index.js:17-19` 同一密钥明文比对；`admin/scripts/viteCloudFnPlugin.mjs` 本地注入仍在（见 §3.5） | 代码读到 |
| P0-11 | 8 个集合无规则文件、线上却匿名可写 | **仍成立** | 仓库侧 `cloudbase/rules/{audience_campaigns,property_proposals,report_templates,user_audiences,store_design_versions,store_design_materials,strategy_research,feishu_shipments}.json` **全部不存在**（`test -f` 逐一实测）。线上部分**本轮未复测**；台账 C.3 已更正为「7 个存在且 `auth != null`，`feishu_shipments` 不存在」 | 代码读到 |
| P0-12 | 幂等唯一索引无仓库内创建/校验手段 | **仍成立** | 全仓 `dedupeKey` 命中 68 处在云函数 `index.js`（`grep -rn "dedupeKey" miniprogram/cloudfunctions/*/index.js \| wc -l` = 68），但 `admin/scripts/` 与 `miniprogram/cloudfunctions/` 内**没有任何** `createIndex`/`ensureIndex`（`grep -rln "createIndex\|unique.*index\|ensureIndex"` = 0 命中）；`miniprogram/docs/门店积分与代金券方案.md:324` 仍写「必须在云开发控制台手动建」 | 代码读到 |
| P0-13 | 真实可并发双发（4 处） | **仍成立** | `transferCoupon/index.js:35-55` 仍是 read-then-`update`（`:85`），无 `dedupeKey`、无 CAS；`earnPoints/index.js:97`（`count()`）→ `:121`（`add()`）仍是竞态；`upsertUserProfile/index.js:110-112` 的 `findGiftRecord` 是 read-then-write；`refundOrder/index.js` 的 `executeRefund`（`:114`）无原子状态占用 | 代码读到 |
| P0-14 | 品牌语言漂移：ERP 主色是「品牌绿」不是黑金 | **已修复（本地）** | `admin/src/styles/design-tokens.css:223-229` 已全部为 gold 系（`--el-color-primary: #6e5b28` = gold-700）；`admin/src/App.vue:4069/4443/4483/4834/4915` 五处注释已改为事实描述（原先自称「黑金效果」而底色是绿） | 代码读到 |
| P0-15 | 一键清库紧贴高频「保存」 | **已修复** | `admin/src/components/ComplianceCenter.vue:369-377` 已移入页底「危险操作」区；`:391-404` 新增 `confirmDestructive`（要求输入「重置」）；`:738-752` `resetAll` 经二手确认；三个分项重置 `:457/:498/:612` 同走确认 | 代码读到 |
| P0-16 | 没有模块级深链 | **已修复** | `admin/src/utils/moduleHash.js:11,16,22`（纯逻辑 + 单测）；`admin/src/App.vue:1931-1980`（`parseModuleHash`/`syncModuleHash`/`applyHashModule`）、`:3993` `hashchange` 监听；侧栏已数据驱动（`:205` `v-for="item in NAV_SIDEBAR_ITEMS"`） | 代码读到 |
| P0-17 | `refund_rejected` 是永久死锁状态 | **仍成立** | 唯一写入方仍是 `admin/src/components/Refunds.vue:513`；`admin/src/components/Orders.vue` 对 `refund_rejected` **0 处命中**（`grep -n "refund_rejected" Orders.vue` 无输出）；`miniprogram/cloudfunctions/refundOrder/index.js:413` 的 `allowFrom` 仍不含该值 | 代码读到 |
| P0-18 | 审批队列只显示超管审级 | **仍成立** | `admin/src/components/ApprovalQueue.vue:157` 仍硬编码 `scope: 'super_admin'`，`:161` 把它回写进 `scope.value` 展示；`miniprogram/cloudfunctions/manageApprovals/approvalRules.js:142-155` 仍会返回 `store_manager` | 代码读到 |
| P0-19 | `stock_movements` 永远为空 | **仍成立**（机制已更正） | `miniprogram/cloudfunctions/manageStoreShipment/index.js` 全文件 **0 处** `stock_movements`（台账 C.1 已更正「不是被 `products` 写失败阻断」）；两个写入方都在前端：`admin/src/utils/b2bFulfillment.js:239`（`cdnAdd(MOVE_COL, …)`，`MOVE_COL='stock_movements'` @ `:9`）、`admin/src/utils/feishuSync.js:812`（`cdnAdd(COLLECTIONS.STOCK_MOVEMENTS, …)`） | 代码读到 |
| P0-20 | 决策界面把演示/模拟数据当生产数据呈现（5 处） | **已修复** | ① `RecommendAlgorithmConfig.vue:206,347-361`（横幅「静态示意结果」+ `ElMessage.warning`）；② `StrategyResearch.vue:588`（CAC/ROI 卡片 note）、`:975`（竞品雷达）、`:4248` 漏斗数据仍在但 note 已标示意；③ `AICenter.vue:568-573,1129,1141,1164-1173,1200-1213,1255`（「前端模拟状态 · 未接入本地模型服务」）；④ `CompanionRobot.vue:1735-1744`（「（模拟数据）」）；⑤ `StrategyResearch.vue:352,410,523,1448,3983` 等示意标注。**但仍存在未标注清单，见 §3.6** | 代码读到 |
| P0-21 | 验收环境整页白屏（`<keep-alive>` 塞了两个子节点） | **已修复** | `admin/src/App.vue:259-282` 未注册告警 `el-alert` 已放在 `<transition>`/`<keep-alive>` **外面**；`:623` `<keep-alive v-else :max="10">` 只有一个子节点；`:1544` `INLINE_TAB_IDS = new Set(['1'])`；`:1552-1554` `unknownTabs` 改为 `computed`（只反映当前 tab）。~~`check:sfc-dev` 本次**未运行**（缺 vite）~~ | 代码读到 |

### 1.1 P0 状态分布

```
仍成立   10 ██████████
部分修复  5 █████
已修复    6 ██████
无法判定  0
```

### 1.2 逐条判定说明（为什么这么归类）

只列**判定有歧义**的条目；其余为「读到即定性」，见上表证据列。

| # | 判定 | 理由（一句话） |
| --- | --- | --- |
| P0-3 | 部分修复 | 「无鉴权即可免付款履约」已挡住 → 原表述不成立；但「明文共享密钥 + 不核验 `transactionId`」两项**逐字仍在** → 同一根因未除 |
| P0-4 | 部分修复 | ERP **客户端**写入路径已删（原表述的「可被任意篡改」在 ERP 侧不再成立）；**线上规则**是否仍 `write:auth != null` 本轮无法测 → 不敢判「已修复」 |
| P0-5 | 部分修复 | 判据是「点保存能不能落库」：**不能**（规则未变）→ 功能未修；判据是「会不会谎报成功」：**不会了**（包装器集中抛）→ 机制已修 |
| P0-6 | 部分修复 | `refunds` 有写入代码但依赖 `orders` 断言（后者必失败）；`coupons` 直写必失败且无云函数通道 → 「没有可用写入路径」**实质仍成立**，仅 UI 变诚实 |
| P0-8 | 部分修复 | 「批了订单没动」**仍成立**（staff 门禁）；「静默失败 + 假成功」已消除；「`refundOrder` 从未被调用」已被推翻 |
| P0-14 | 已修复 | 台账该条同时包含「token 是绿」与「5 处注释自相矛盾」两个事实，**两者都已消失**。品牌方向的**产品决策**属台账 §7.0，不属本条 |
| P0-20 | 已修复 | 台账明列 **5 处**，逐个复核均有标注；但「演示数据本身」仍在（本轮 §3.6 补了 8 条未列项）——这属**新增发现**而非本条的未完成 |
| P0-21 | 已修复 | 结构层面已修（告警在 `transition`/`keep-alive` 之外）；台账该条的**验证方式**（`check:sfc-dev`）本轮跑不了 → 代码读到即判定，验证留空 |

### 1.3 跨条共性（修复方向应合并，而非逐条打补丁）

| 共性根因 | 覆盖条目 | 一句话 |
| --- | --- | --- |
| **写路径未落库（规则 `write:false`）** | P0-5、P0-6、P0-8、P0-17、P0-19 | 全部同一件事：ERP 直写被线上规则拒。修法只有一条 —— 改走 `/api/cloud-fn` 代理 + 检查写结果 |
| **前端常量冒充鉴权** | P0-2、P0-9、P0-10 | `verified_888`/`admin888`/`money888`/`ADMIN_OPS_KEY` 四者同构：可读可复制的常量 |
| **无按人身份 → 审计身份恒为 `admin_web`** | P0-2、P0-4、P0-10、P0-18 | P0-4/P0-10/P0-18 的「修法」都卡在同一前置：没有真实账号体系 |
| **读完再写（read-then-write）** | P0-12、P0-13 | 唯一索引是唯一解，而索引只能控制台手建 |
| **静默失败被改成「诚实报错」但功能未通** | P0-5、P0-6、P0-8、P0-19 | 这是本轮整改的**主导形态**：可观测性大幅改善，可用性零改善 |

> **对整改台账的评价**：附录 C.1 有 37 条记录，其中至少 **6 条的「✅ 已完成」应读作「已如实报错」**
> （C.1 中 P0-5 的三条、P0-8、P0-17 与批次 20）。这不影响已做工作的价值（假成功比失败更危险），
> 但如果把 C.1 当作「P0 剩余量」来读，会**系统性低估**尚未解决的量。建议 C.1 增加一列
> 「功能是否真通」以区分两类完成。

---

## 2. 三处注册一致性核查（含命令与结果）

### 2.1 规范要求（`AGENTS.md:18-22`）

| 步骤 | 文件 | 角色 |
| --- | --- | --- |
| 1 | `admin/src/utils/modulesRegistry.js` 的 `GROUPS` / `MODULES` | 域身份 + 条目身份（唯一来源） |
| 2 | `admin/src/config/adminNavDomains.js` 的 `NAV_CURATION` | 策展（只写 `id`+`desc`） |
| 3 | `admin/src/App.vue` 的 `TAB_COMPONENT_MAP` | 挂组件 |

### 2.2 可复现命令（本次实际执行）

```bash
# ① 官方守卫（已覆盖本任务四个方向中的三个）
cd /home/admin/shanchuanzaowu && npm run check:nav-sources
# 输出：导航事实来源守卫：508 项通过，0 项失败（7 个域 / 58 个条目）

# ② 独立三方差集（本审计写的只读脚本，不依赖 Vite）
node /tmp/audit6/registry-diff.mjs
```

`registry-diff.mjs` 的做法：`import` 两个模块拿到 `GROUPS`/`MODULES`/`MODULE_ALIASES`；
`NAV_CURATION` **未导出**（`adminNavDomains.js:37`）故按其源码文本解析 `{id:…}`（与守卫同法）；
`TAB_COMPONENT_MAP` 从 `App.vue` 文本解析 `'id': () => ({ comp: X })`。

### 2.3 差集结果（实测输出）

| 检查项 | 结果 | 明细 |
| --- | --- | --- |
| 规模 | — | `GROUPS` 7 / `MODULES` 86 / 规范模块 **65** / `NAV_CURATION` 条目 **58** / `TAB_COMPONENT_MAP` 键 **64** |
| **MODULES 有但 NAV_CURATION 未策展** | **0**（规范模块口径） | 未策展的 7 个是域自身（`nav-overview`…`nav-intelligence`），由 `GROUPS` 派生、不需策展 |
| **NAV_CURATION 引用了不存在的 id** | **0** | `curated_not_in_MODULES: []` |
| **TAB_COMPONENT_MAP 缺失的 id** | **1**：`1 藏品档案库` | 由 `App.vue:1544` 的 `INLINE_TAB_IDS = new Set(['1'])` + `:277` 内联 `v-if="currentTab === '1'"` 渲染，属**设计例外**（已登记并有守卫断言） |
| **TAB_COMPONENT_MAP 里指向不存在组件的项** | **0** | 55 个组件名逐个在原文件核对「有 `import` / `const X = asyncWith(...)` 定义」，无一缺失（本轮脚本验证） |
| TAB_COMPONENT_MAP 多余键 | **0** | 64 键全部在 `MODULES_BY_ID` |
| TAB_COMPONENT_MAP 含别名键 | **0** | `MODULE_ALIASES` 交叉为 0 |
| **GROUPS 与 NAV_CURATION 域不一致** | **0** | `curated_domain_not_in_GROUPS: []`、`GROUPS_domain_without_curation: []`、`group_mismatch: []`、`GROUPS_navId_dup: []`、`curated_duplicate_ids: []` |
| 策展条目指向别名 | **0** | `curated_alias_entries: []` |

**结论**：`AGENTS.md` 的「三处注册」规范**当前被严格遵守**。唯一「不一致」是 `1 藏品档案库` 不在
`TAB_COMPONENT_MAP`，但这是**有意的内联渲染**（依赖 `App.vue` 大量本地状态），且已被
`INLINE_TAB_IDS` + 守卫显式覆盖——**不是遗漏**。

### 2.4 `check:nav-sources` 能否检出这些？

读源码（`admin/scripts/check-nav-sources.mjs`，508 项断言）后逐项对照：

| 任务 B 要求检出的问题 | 守卫是否覆盖 | 依据 |
| --- | --- | --- |
| MODULES 有但 NAV_CURATION 未策展 | ✅ | `check-nav-sources.mjs:97-103`「所有规范模块都已策展进导航域」 |
| NAV_CURATION 引用了不存在的 id | ✅ | 同文件 `:110-113`「策展数据无多余 id」 |
| TAB_COMPONENT_MAP 缺失的 id | ✅（合并 `INLINE_TAB_IDS`） | `:157-165`「每个规范模块都有渲染方」 |
| TAB_COMPONENT_MAP 里指向不存在组件的项 | ❌ **未覆盖** | `:145-152` 只用正则抠 **key**，`comp:` 的值从未被解析，也没有「import 是否解析得到」的检查 |
| GROUPS 与 NAV_CURATION 域不一致 | ✅ | `:63-76`（域集合/顺序/标题/overline/图标）+ `:82-96`（条目 group 与所在域一致） |
| 额外：`MODULES_BY_ID[key]` 不存在 | ✅ | `:166-170`「TAB_COMPONENT_MAP 的键都在注册表里」 |

**本次实测**：`npm run check:nav-sources` → **508 项通过，0 项失败**，exit 0。

**守卫的空白（新增发现 P2-1）**：它无法发现「两个 id 挂到同一个组件」「组件名拼错但恰好同名局部变量」
「`comp` 指向的文件不存在」这三类。第三类会由 `check:sfc-dev` 的静态 import 解析间接拦住，
但那道守卫**本次因缺 vite 跑不了**（`admin/node_modules` 未装齐）。建议给 `check-nav-sources`
补一条 `comp` → import 映射断言（无需 Vite，纯文本即可）。

---

## 3. 新增发现（P0/P1/P2）

### 3.1 【P1】巨型单文件的维护性代价（`App.vue` 5167 行）

| 项 | 实测 | 证据 |
| --- | --- | --- |
| 行数/职责混杂 | `<template>` **1310 行**（:1–1311）、`<script setup>` **2702 行**（:1313–4015）、`<style>` **1150 行**（:4017–5167） | `awk` 分段实测 |
| 顶层函数 | `function`/`async function` **9 个**，其余为 60 个 `ref/computed/reactive` + 大量箭头常量 | `grep -c` |
| 全局 `reloadKey` + `keep-alive` | `:623` `<keep-alive :max="10">`、`:627` `:key="currentTab + '-' + reloadKey"`、`:1622-1623` `reloadKey = ref(0)` / `forceReloadCurrent()`。`keep-alive` 缓存的是**带 key 的 vnode**，key 变化 → 旧实例被丢弃重建；`:max="10"` 时**刷新会泄漏旧实例**直到超出上限才淘汰 | `App.vue:623-631,1622-1623` |
| 无 `onActivated` | 全仓 `onActivated`/`onDeactivated` **0 处** | `grep -rn "onActivated\|onDeactivated" src/` → 0 |
| 清理缺口 | `onMounted` **177 处** vs `onUnmounted` **34 处** + `onBeforeUnmount` **4 处**（≈ 38/177 有清理） | 全仓计数 |
| `setInterval` 泄漏 | 8 处 `setInterval`；`admin/src/utils/aiHelper.js:514` `setInterval(cleanExpiredCache, 10*60*1000)` **在模块顶层**且 `clearInterval` 全仓对不上（`aiHelper.js` 无 `clearInterval`）；其余 7 处在 `.vue` 内，多数有 `clearInterval`（`AICenter.vue:1228`、`CompanionRobot.vue:2166`、`RealtimeMonitor.vue:987`、`Dashboard.vue:1243`、`ossCompanionTts.js:152,198`、`aliyunCompanionTts.js:145`） | `grep -rn "setInterval" src/` +
`for f in $(grep -rl setInterval src/); do grep -q clearInterval $f || echo $f; done` → 仅 `aiHelper.js` |
| 隐式全局事件总线 | `App.vue:1654-1661` 注册 `toggle-sidebar`/`sidebar-groups-collapse`/`sidebar-groups-expand`/`tabs-close-others`/`tabs-close-all`/`reload-current`/`logout`/`export-current`；`:3983-4002` 另有 `sc-admin-session-expired`/`storage`/`pinned-changed`/`RECENT_CHANGED_EVENT`/`keydown`/`switch-tab`。派发方散落在 `src/utils/modulesRegistry.js:287-317`（`ACTIONS` 的 `event:` 字段）与 4 个组件（`AIStrategicBrain.vue:1238`、`StrategyResearch.vue:2614,2672`、`ProductConceptGenerator.vue:759`）→ **无类型、无契约、无订阅者清单**，删一个监听器不会有任何编译期报错 | `grep -rn "dispatchEvent(new CustomEvent"` |

> 判据说明：以上是**代码读到**的量化事实；「`keep-alive` 刷新是否真的泄漏实例」属运行时行为，
> 需浏览器实测（本次未做，见 §5）。

### 3.2 【P2】`admin/src/utils/` 职责重叠

| 现象 | 实测 | 证据 |
| --- | --- | --- |
| 同名导出函数多份 | 仅 `maskPhone` 一个跨文件重名 | `grep -h "^export …" src/utils/*.js \| … \| uniq -d` → `maskPhone` |
| `utils/` 体量 | **14962 行**，最大 `aiHelper.js` **1775 行**、`feishuSync.js` 921 行、`cloudbaseCdnDb.js` 689 行 | `wc -l src/utils/*.js` |
| 近似职责并存（未重名但同域） | 财务三件套 `financeSync.js`(438) / `financeSandboxBridge.js`(350) / `financeDuplicateCleanup.js`(227) + `financialData.js`(245) + `financeDailyParse.js`；飞书两件套 `feishuSync.js`(921) / `feishuRosterSync.js`(387)；门店 `storeStorage.js`(404) / `storeLedgerSync.js`(310) / `storeData.js`(197)；TTS 三件套 `ttsHelper.js`(385) / `ossCompanionTts.js`(339) / `aliyunCompanionTts.js`(174) | `wc -l` + 目录列举 |
| 包 `cloudbaseCdnDb.js` 被绕过直写 | **14 处** `db.collection(` 出现在 `cloudbaseCdnDb.js` 之外，其中 **11 处是真正的写/读绕过**（`getCdnDatabase()` 拿 db 后自建调用）：`financeSync.js:78,119,137,145,191,203,205`、`financeDuplicateCleanup.js:206`、`storeLedgerSync.js:238,257,264`；另 3 处在 `cloud.js:…`（连接自检） | `grep -rn "db\.collection(" src/ --include=*.vue --include=*.js \| grep -v src/utils/cloudbaseCdnDb.js` |

> 影响：审计 C.1 声称「权限被拒从逐调用点校验**下沉为包装器集中抛出**」
> （`cdnAdd/cdnUpdate/cdnRemove/cdnSet` 统一 `assertNoWriteError()`）。上述 **11 处绕过包装器**的直写，
> 其写结果**没有任何集中校验**——同一个「谎报成功」的根因在这条路径上仍然敞开。

### 3.3 【P2】空态/错误态/加载态现状（抽样 5 个高频页）

命令：对每个文件 `grep -c 'el-empty\|ErpEmpty'`、`'empty-text'`、`'loadError'`、`'v-loading'`、`'el-alert'`。

| 页面 | 文件 | 空态 | 错误态 | 加载态 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **Orders** | `src/components/Orders.vue` | `el-empty` ×2（`:187,192`） | ✅ `loadError` ×6，`:74-86` `el-alert` 与空态互斥（注释 `:73`） | `v-loading` ×1 | **三类齐全**（审计要求已落地） |
| **Finance** | `src/components/Finance.vue` | `el-empty` ×1（`:864`，仅重复日账清理弹窗）；其余 20+ 处空态是 **`innerHTML` 字符串**（`:940,3041,3170,3447,4064,4512,4766,4846,4855,5016,5138,5263,5409`），全文件 `innerHTML` **50 次** | ❌ `loadError` **0 处** | ❌ `v-loading` **0 处**（图表区自绘） | **错误态缺失**：取数失败与「本月暂无数据」在 UI 上不可区分 |
| **Members** | `src/components/CRM.vue` | `ErpEmpty` + `el-empty` ×2（`:45`） | ⚠️ 仅 `ElMessage.error`（`:272,360`，会消失），**`loadError` 0 处**，列表仍渲染空态 | `v-loading` ×1 | **错误态靠 toast**（审计 P1「表单校验靠 toast」同型） |
| **Products（内联于 App.vue）** | `src/App.vue` | `empty-text` ×1（`:455`「暂无藏品，点击右上角录入」） | ❌ `loadError` **0 处** | `v-loading` ×1 | **错误态缺失**；且 `products` 写入恒被拒（P0-5）→ 错误提示与空态混在一起 |
| **Categories** | `src/components/Categories.vue` | `empty-text` ×1，值为 **`" "`（单个空格）**（`:225`，关联预览表） | `loadError` **0 处**，`el-alert` ×2（`:15,26` 为集合缺失告警） | `v-loading` ×3 | **空态为空白**：`empty-text=" "` 当前仍在 |

> 口径诚实声明：`el-empty`/`empty-text` 计数**不能**代表空态覆盖率（见台账 C.1「空态覆盖率口径修正」）。
> 上表只报「这个文件里是否存在这几类元素」，**不推论覆盖率**。

### 3.4 【P2】直写集合清单（`cloudbaseCdnDb.js` 包装器未覆盖的高频直写）

`grep -rn "cdnAdd\|cdnUpdate\|cdnRemove\|cdnSet\|cdnUpsert" admin/src/ | grep -c "COLLECTIONS\.<C>"` 实测：

| 集合 | 规则 | 直写处数 | 位置 |
| --- | --- | --- | --- |
| `PRODUCTS` | `{read:true, write:false}` | **2** | `src/App.vue:1370`（`updateProduct`，含断言）、`src/components/Finance.vue:3814`（`assertStockWrite`，含断言） |
| `ORDERS` | `{read:"auth != null", write:false}` | **3** | `src/components/Refunds.vue:472,512`（均有断言）、`:552`（**无断言**）、`src/components/Orders.vue:574`（**无断言**，裸 `cdnUpdate('orders', …)`） |
| 其余 8 个 | `write:false` | **0** | 已无 `COLLECTIONS.<C>` 直写 |

> **两处未断言的真问题**：`Refunds.vue:552` 与 `Orders.vue:574` 都在「先写 `orders` 置 `refunding`」的
> 前置步骤上——写失败会被外层 catch 当成「Hmm 退款失败」提示，但**不会**阻止流程继续调用云函数，
> 也不会告诉运营「状态前置失败」。对照 `Refunds.vue:476/517` 的断言写法，这两处属漏网。

### 3.5 【P2】`cloudbaseCdnDb.js` 之外的 `db.collection` 绕过

见 §3.2 表末行：**11 处**业务级绕过集中在 `financeSync.js` / `storeLedgerSync.js` / `financeDuplicateCleanup.js`。
这三者的共同点是**会 `remove()`/`update()`/`add()` 云账本**（`financeSync.js:119,137,145`；
`storeLedgerSync.js:238,257,264`），也就是审计 P1 点名的「同步时静默删云端重复」。
`admin/src/utils/financeSync.js:276-285` 的 `success:true` 是否仍在，需读原文确认（本次未逐行读，见 §5）。

另：`admin/scripts/viteCloudFnPlugin.mjs` 在 dev/preview 都挂载并注入 `ADMIN_OPS_KEY`（P1 原项），
本轮未读其当前实现，标为**未复核**。

**本轮新增发现的可复现命令汇总**（全部只读，按需逐条复跑）：

```bash
cd /home/admin/shanchuanzaowu
# 3.1 巨型文件
awk '/^<template>/{s=NR} /^<\/template>/{e=NR} END{print "template",s,e}' admin/src/App.vue
awk '/^<script/{s=NR} /^<\/script>/{e=NR} END{print "script",s,e}'   admin/src/App.vue
awk '/^<style/{s=NR} /^<\/style>/{e=NR} END{print "style",s,e}'      admin/src/App.vue
grep -rn "setInterval" admin/src/ --include=*.vue --include=*.js
for f in $(grep -rl setInterval admin/src/); do grep -q clearInterval "$f" || echo "无 clearInterval: $f"; done
grep -rn "onActivated\|onDeactivated" admin/src/ | wc -l          # → 0
grep -rn "onMounted" admin/src/ --include=*.vue | wc -l            # → 177
grep -rn "onUnmounted\|onBeforeUnmount" admin/src/ --include=*.vue | wc -l  # → 38
# 3.2 工具重叠 / 绕过包装器
grep -rhn "^export function \|^export async function \|^export const " admin/src/utils/*.js \
  | sed "s/.*export \(async \)\?\(function \|const \)\?//;s/[=(].*//" | sort | uniq -d   # → maskPhone
grep -rn "db\.collection(" admin/src/ --include=*.vue --include=*.js | grep -v cloudbaseCdnDb.js
# 3.3 空/错/加载态
for f in Orders Finance CRM Categories; do p=admin/src/components/$f.vue; \
  printf "%-10s empty=%s loadError=%s loading=%s alert=%s\n" "$f" \
  "$(grep -c 'el-empty\|ErpEmpty\|empty-text' $p)" "$(grep -c loadError $p)" \
  "$(grep -c v-loading $p)" "$(grep -c el-alert $p)"; done
# 3.4 直写集合
grep -rn "COLLECTIONS\.ORDERS" admin/src/ --include=*.vue --include=*.js
# 3.6 演示清单
grep -rni "mock\|演示\|示意\|模拟\|示例数据\|硬编码\|写死" admin/src/ --include=*.vue --include=*.js -l
# 3.7 死文件
for f in admin/src/components/*.vue admin/src/components/ai/*.vue; do b=$(basename "$f" .vue); \
  n=$(grep -rl "\b$b\b" admin/src/ --include=*.vue --include=*.js | grep -v "^$f$" | wc -l); \
  [ "$n" -eq 0 ] && echo "UNREFERENCED: $f"; done
```

### 3.5.1 关键计数（本轮实测快照，供下次对比）

| 指标 | 值 | 变化趋势（对比台账 2026-09-16 记录） |
| --- | --- | --- |
| `App.vue` 行数 | **5167** | 台账未记；已知含 1310 行模板 / 2702 行脚本 / 1150 行样式 |
| `src/utils/` 总行数 | **14962** | 台账未记 |
| 静默吞错（`check:silent-catch`） | **0 处 / 45→0 文件** | 台账记「151 → 0」；本轮实测 0 ✓ |
| CDN 直写未校验（`check:write-verify`） | **66 处 / 51 调用点**（+37 处变量名不可判定） | 台账记「基线 53 / 本次 51」；与台账一致 |
| 写路径走代理 | **约 35 处** | 台账未记 |
| 色彩残留字面量 | **120 种**（棘轮未增长） | 台账记 120 种 ✓ |
| 模板内联品牌色残留 | **0 处** | 台账记「必须恒为 0」✓ |
| 疑似正文色不达 AA | **674 处 / 64 色** | 台账记 674 处 ✓ |
| 非权威源页面（D5） | **16 处**（`D1=0 / D2=0 / D3=4 / D4=0 / D5b=2`，其中含明文 API Key） | 台账记 D5=16 ✓（我上一版按尾部片段误记为 8，已用 `grep -E "^D[0-9]"` 复核订正） |
| 代理白名单 | **服务端 30 / 前端 30，逐项一致** | 台账记 27/27 → 已扩到 30（含 `refundOrder`、`verifyBooking`） |
| 规范模块数 | **65**（`MODULES` 86 − 21 别名） | 台账记 86 → 65 别名口径已落地 |
| `cloudbase/rules/*.json` | **127** 份（`read:true` 12 份、`write:true` **0** 份） | 台账记 127 份 ✓；`write:true` 0 份是新证据 |
| `miniprogram/cloudfunctions/` | **129** 个 | 台账记「27 个云函数代理入口」为白名单口径，非总数 |


### 3.6 【P1】「演示模块」补全清单（台账 §P0-20 只列 5 处）

grep 口径：`mock|Mock|演示|示意|模拟|示例数据|硬编码|写死|固定.*条`（含大小写，`src/**/*.{vue,js}`）。

**① 已加标注（台账已完成，逐处复核）**

| # | 位置 | 形态 | 标注 |
| --- | --- | --- | --- |
| 1 | `src/components/RecommendAlgorithmConfig.vue:206,347-361` | `mockResults` 5 条硬编码当「算法测试完成」 | ✅ 横幅「下方为静态示意结果，不是真实算法输出」+ `ElMessage.warning`（`:361`） |
| 2 | `src/components/StrategyResearch.vue:4240-4250` | 漏斗 `[138000,8500,1800,830]` | ✅ `:588` note 点明「人数、环比转化、CAC、ROI **均为示意数据**」 |
| 3 | `src/components/AICenter.vue:1039` | `defaultModelList`「示例数据，实际应该从API获取」，模型状态参与 UI | ⚠️ 有注释但**未在界面标注**（P0-20 只覆盖了开/关机/重启的 `setTimeout`，`:1129-1213`） |
| 4 | `src/components/CompanionRobot.vue:1735-1744` | `mockWeather` 硬编码 | ✅ 文案「今日天气（**模拟数据**）」 |
| 5 | `src/components/AICenter.vue:1129-1213` | `setTimeout` 假装服务启停 | ✅ 标签「前端模拟状态 · 未接入本地模型服务」（`:573`） |

**② 台账未列、但同样属「演示/示意」的清单（本轮新增）**

| # | 位置 | 形态 | 界面是否标注 | 严重度 |
| --- | --- | --- | --- | --- |
| 6 | `src/data/aiFeatureRegistry.js:51,229` | `capability: 'demo'` + `capabilityLabel: '演示'` 两条（智能库存、供应链优化） | ✅ 有 `capabilityHint` | 低 |
| 7 | `src/data/operationsManualData.js` | 7 处「示意/模拟」（`:49,51,135,310,900,901,915,983`） | ✅ 文本内自带「示意」 | 低 |
| 8 | `src/data/governanceEmbed.js:48` | 「第三批 · **演示稿**（摘录逐步补齐）」 | ✅ 标「演示稿」 | 低 |
| 9 | `src/components/StrategyResearch.vue:3176,3550,3983` | 硬编码 `aggressive: {orderCount:280, avgPrice:780, margin:52, fixedCost:118000}`、`total: 1800000` | ⚠️ 部分（`:3983` 标「示意」）；`:3176`/`:3550` 未见标注 | 中 |
| 10 | `src/components/StrategyResearch.vue:4310` | 「门店热力图（柱状示意）」 | ✅ | 低 |
| 11 | `src/utils/propertyEvalModel.js:471` | 评估案例文本内「数值仅作**示意**」 | ✅ | 低 |
| 12 | `src/components/Marketing.vue:237,843` | `.goods-cover-mock` | 不适用（**CSS 类名**，非数据） | — |
| 13 | `src/App.vue` | 命中 `mock/演示/示意` 但需逐处确认；本轮只验证了 `:455` 空态文案，**未逐处读** | 未判定 | 待查 |

**③ 本次**未发现**「无任何标注且驱动决策」的新增高危演示项**——台账 P0-20 修复后，最危险的四处
（算法测试、漏斗/CAC、模拟服务启停、模拟天气）都已标注。剩余风险集中在 **AICenter 的默认模型列表**
（`defaultModelList` 被当真实可用模型展示）与 **StrategyResearch 的 `:3176/:3550` 硬编码策略参数**。

### 3.7 【P2】未使用/死文件核实

台账 §P2 列 3 个死文件，本轮逐个核实：

| 文件 | 现状 | 命令 |
| --- | --- | --- |
| `admin/src/config/sidebarNav.js` | ✅ **已删除**（`test -f` 失败） | 台账 C.1 已记录 |
| `admin/src/components/ExhibitionManager.vue` | ❌ **仍在**，全仓引用数 **0** | `for f in src/components/*.vue; do b=$(basename $f .vue); grep -rl "\b$b\b" src/ \| grep -v "^$f$" \| wc -l; done` → 0 |
| `admin/src/components/HelloWorld.vue` | ❌ **仍在**，全仓引用数 **0** | 同上 |

扩展核查（`src/components/*.vue` + `src/components/ai/*.vue` 全量）：**共 2 个未被引用**，
即上表后两个；**无新增死组件**。（`admin/scripts/` 内的 `.mjs` 另见 §3.8。）

### 3.8 【P2】`admin/package.json` 与 `admin/scripts/` 实况差集

`admin/package.json` 的 `scripts` **只有 10 条**（`dev/build/preview/build:xietian-fragment/provision:*×6/seed:*×2`），
而 `check:*`/`test:*`/`report:*`/`audit:*` **全部定义在根 `package.json`**（共 78 条）。差集如下：

| 方向 | 结果 |
| --- | --- |
| 根 `package.json` 指向不存在的 `admin/scripts/*` | **0**（无悬空入口） |
| `admin/scripts/*.mjs` **没有任何 npm 入口** | **19 个**（见下） |

19 个未接线脚本（命令：`node -e` 遍历 `admin/scripts/*.mjs` 与根 scripts 串比对）：

```
aliyunNlsPopSign.mjs            apply-database-rules.mjs        build-xietian-html.mjs
provision-all.mjs               provision-content-collections.mjs   provision-feishu-bridge.mjs
provision-fulfillment-p1.mjs    provision-miniapp-ops.mjs       provision-price-list.mjs
provision-purchase-intents.mjs  provision-purchase-orders.mjs   seed-benchmark-research.mjs
test-content-board.mjs          test-content-db.mjs             test-content-flow.mjs
viteAliyunNlsPlugin.mjs         viteCloudFnPlugin.mjs           viteFeishuBitablePlugin.mjs
viteOssTtsPlugin.mjs
```

**分类**：
- **真正的入口缺口（6 个）**：`test-content-board.mjs`、`test-content-db.mjs`、`test-content-flow.mjs`、
  `apply-database-rules.mjs`、`provision-feishu-bridge.mjs`、`seed-benchmark-research.mjs`
  —— 前三个是测试（`test:*` 家族里唯独它们没入口，**不在 `check:admin` 串里，等于没有守卫效力**）；
  后三个是运维脚本，`AGENTS.md:26` 声称「`check:admin`（10 条静态守卫）」但实际串了 **18 条**，
  文档与实现已不同步。
- **正常（未接线但设计如此）**：4 个 `vite*Plugin.mjs` 由 `vite.config.js` 直接 import；
  6 个 `provision-*.mjs`/`seed-*` 有 `admin/package.json` 的 `provision:*`/`seed:*` 入口（从根跑不到，
  但 `-w admin` 可跑）；`build-xietian-html.mjs`、`aliyunNlsPopSign.mjs` 有 admin 入口。

> **可复现命令**：
> ```bash
> node -e "
> const p=require('./package.json');const refs=Object.values(p.scripts).join(' ');const fs=require('fs');
> for (const f of fs.readdirSync('admin/scripts')) if (f.endsWith('.mjs') && !refs.includes('admin/scripts/'+f)) console.log(f)"
> ```

---

## 4. 台账中已过时/需修订的表述

| # | 台账原文（位置） | 现状事实 | 需改成 |
| --- | --- | --- | --- |
| 1 | P0-8：「`Orders.vue` 兜底文案自认『请在小程序处理真实退款』」「**`refundOrder` 从未被调用**」（`§0 P0-8`、`§5.2` 第 200 行） | `admin/src/components/Orders.vue:576` 与 `:614` **确实调用了** `refundOrder`，且 `refundOrder` 在两侧白名单（`functions/_lib/cloudbaseCallFn.mjs:25`、`admin/src/utils/cloudbaseCdnDb.js:141`） | 「ERP 已接线 `refundOrder`，但服务端要求 staff 身份（`refundOrder/index.js:489-492`），Web 匿名调用必被拒 → **仍不退钱**，只是不再假成功」 |
| 2 | P0-19：「两个写入点都被**前置的 `products` 写失败阻断**」（`§0 P0-19`） | C.1 末尾已自行更正；本轮复核确认 `confirmPayment` 语义下 `products` 写**不抛错**，不阻断 | 已在 C.1 更正，§0 原表未同步 → 建议在 §0 该行加「⚠ 机制见 C.1 更正」 |
| 3 | P0-5：列 `products` 为「点保存不落库」的 10 个之一 | 成立，但 ERP 侧 `PRODUCTS` 直写只剩 **2 处且都有断言**；`ORDERS` 剩 3 处，其中 **2 处无断言**（`Refunds.vue:552`、`Orders.vue:574`） | 补一句「残余未断言的直写集中在『状态前置』步骤」 |
| 4 | P1「交互与一致性」：「`keep-alive :max="10"` + 全局 `reloadKey`（`App.vue:616,620,1571-1572`）」 | 行号已移位；当前为 `App.vue:623,627,1622-1623`。`onActivated` 仍 **0 处**，该结论成立 | 行号更新为 `:623-631`、`:1622-1623` |
| 5 | P2：「只剩死文件 `components/ExhibitionManager.vue`、`components/HelloWorld.vue`、`config/sidebarNav.js`」 | `sidebarNav.js` 已删；**前两个仍在**（引用数均 0） | 改为「剩 2 个死文件」，并补「全量扫描无新增死组件」 |
| 6 | P2：「21 个『已并入X』仍是独立模块」/「命令面板对同一屏给出两条结果」 | 命令面板已加 `resolveModuleTarget()`/`dedupeByTarget()`（`modulesRegistry.js:177-184`），`MODULES_CANONICAL` = **65**（`modulesRegistry.js:171`） | 结论已过时，但**别名条目仍留在 `MODULES`**（保留搜索别名），描述应改为「同名两行已修，别名条目仍在（有意保留）」 |
| 7 | P2：「`App.vue:1634-1649` `TAB_TO_GROUP` 定义后从未使用」 | 全仓 `TAB_TO_GROUP` **0 命中**（已删） | 标记已完成 |
| 8 | §1.1：「`npm run check:nav-dom`（需先 `npm run dev:admin`）」 | 仍成立；但 `dev:admin` 本次**跑不起来**（`admin/node_modules` 缺 vite） | 补一句环境前置：`pnpm/npm install -w admin` 需先完成 |
| 9 | §1.1：「`npm run check:admin`（10 条静态守卫，约 10s）」（`AGENTS.md:26` 同） | 实际串 **18 条**（根 `package.json` 的 `check:admin` 定义） | 数字改为 18，或说明「含 4 个 test + 4 个 report」 |
| 10 | P2：「`App.vue:1512` 未注册 tab **静默回退驾驶舱**」 | 已改为 `console.error` + 可见 `el-alert`（`App.vue:2129-2140`、`:259-282`），`unknownTabs` 为 `computed` | 标记已完成 |

---

## 5. 未验证与存疑

### 5.1 环境导致本轮**未运行**的命令（明确缺什么）

| 命令 | 状态 | 缺什么 | 影响结论 |
| --- | --- | --- | --- |
| `npm run check:sfc-dev` | ❌ `ERR_MODULE_NOT_FOUND`（`admin/node_modules/vite/index.js`） | `admin/node_modules` 只有 3 个包，vite 未安装 | **P0-21 的「dev 管线编译通过」本轮未能复现**，只核了模板结构 |
| `npm run audit:collections` | ❌ exit 2（「缺少 `TCB_SECRET_ID`/`TCB_SECRET_KEY`」） | `admin/.env` | P0-1/P0-4/P0-11 的**线上规则侧**全部无法复测 |
| `npm run check:nav-dom` | 未尝试 | 需先 `npm run dev:admin`（而 dev 依赖 vite，起不来） | 深链/侧栏/对比度的**浏览器实测**本轮全部缺失 |
| `npm run test:write-layer` / `report:colors:strict` / `report:data-sources:strict` | 未单跑 | —（`report:colors`、`report:data-sources`、`check:nav-sources`、`check:silent-catch`、`check:write-verify`、`check:proxy-allowlist` 已跑通过） | P0-7 的单测证据为「读代码 + 台账记录」，非本轮实测 |

**已实际跑通的命令与输出**（供复核）：

| 命令 | 输出摘要 | exit |
| --- | --- | --- |
| `npm run check:nav-sources` | 「508 项通过，0 项失败（7 个域 / 58 个条目）」 | 0 |
| `npm run check:silent-catch` | 「当前 0 处 / 基线 0 处（0 个文件）」 | 0 |
| `npm run check:write-verify` | 「走代理约 35 处；变量名不可判定 37 处（已知盲区）；CDN 直写未校验 **66 处**（残余 `updated:0` 类，权限被拒已由包装器抛出）；棘轮基线 53/本次 51」 | 0 |
| `npm run check:proxy-allowlist` | 「服务端 30 项 / 前端 30 项，逐项一致，无单边条目」 | 0 |
| `npm run report:colors` | 「⑤ 模板内联品牌色残留 **0 处**；⑥ 疑似不达 AA **674 处 / 64 色**；棘轮 120 种未增长」 | 0 |
| `npm run report:data-sources` | 「D1=0 / D2=0 / D3=4 / D4=0 / **D5=16** / D5b=2；棘轮未恶化」（尾部曾被我误读为「8 个页面」，实为列表片段，见 §3.5.1 订正） | 0 |
| `node /tmp/audit6/registry-diff.mjs` | 三方差集（见 §2.3） | 0 |

### 5.2 存疑（读到了现象，但不敢下结论）

1. **`financeSync.js:276-285` 的 `success:true` 是否仍在** —— 本轮未逐行读 `financeSync.js` 全文，
   只读了它的 `db.collection` 行。P1「财务口径倒置」的当前形态**未判定**。
2. **AICenter `defaultModelList`（`:1039`）是否以真实模型口吻展示** —— 只读到「示例数据」注释与
   列表定义，**未读其渲染模板**，无法判定是否属「演示当真实」。
3. **`keep-alive` + `reloadKey` 是否真的泄漏旧实例** —— 静态只能看到 key 变化会丢弃 vnode；
   是否「泄漏」需 DevTools 实测。**需人工在浏览器复核。**
4. **`Refunds.vue:552` / `Orders.vue:574` 两处无断言直写的实际后果** —— 写失败被外层 catch 吞成
   一条笼统错误提示；**用户看到的是什么文案**未实测。
5. **`admin/src/utils/aiHelper.js:514` 顶层 `setInterval`** —— 模块顶层定时器在 SPA 生命周期内
   只执行一次（模块单例），**不构成「重复注册泄漏」**；但 `cleanExpiredCache` 失败且无 `clearInterval`，
   无法在登出/切页时停止。是否算缺陷取决于产品预期，**存疑**。
6. **`check:write-verify` 的「变量名不可判定 37 处」** —— 守卫自述是盲区，这 37 处里是否藏着
   `products`/`orders` 级别的真问题，**未逐处读**。
7. **P0-5 的 8 个「已无直写」集合** —— 结论基于 `COLLECTIONS.<CONST>` 字面量与字面量字符串两种写法的
   grep。若有第三写法（如 `getCollectionName()` 动态返回，见 `Marketing.vue:455,463`），
   仍可能漏计。**这是本轮最可能低估的地方。**

### 5.3 未复核的相邻项（本轮范围外，但复核 P0 时擦到）

- `admin/scripts/viteCloudFnPlugin.mjs` 的 `ADMIN_OPS_KEY` 注入（P1）——未读当前实现。
- `miniprogram/cloudfunctions/*/staffGuard.js` 的 `canOperateStore` 默认开放语义（P1）——未复核。
- 两份 allowlist 与线上云函数的**实际部署一致性**（`check:fn-sync` 未跑）。

---

## 附：本轮新增/使用的只读脚本

| 脚本 | 作用 | 是否入库 |
| --- | --- | --- |
| `/tmp/audit6/registry-diff.mjs` | 三处注册差集（`GROUPS`/`MODULES`/`NAV_CURATION`/`TAB_COMPONENT_MAP`/组件解析） | ❌ 临时脚本；逻辑已在 §2.2 给出，建议收编为 `check:nav-sources` 的补充断言 |

> **审计纪律声明**：本轮**未修改任何仓库文件**。`/tmp/audit6/` 为进程外临时目录；
> 仓库内唯一写入是本报告本身（`docs/全面审计_2026-09-17/raw/06_ERP现状复核.md`）。
