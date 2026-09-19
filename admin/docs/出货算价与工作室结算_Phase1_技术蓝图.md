# 山海造物 · 出货算价与工作室结算 · Phase 1 技术蓝图

> 版本 **v1.2 · 2026-09-19** · 面向 `shanchuanzaowu` monorepo（小程序店长/超管端 + Admin Vue3 + CloudBase）
>
> **变更记录**
> - **v1.2**（2026-09-19）：产品负责人追加交互要求 —— **解析结果改为「逐行可编辑页面」**
>   （材料可搜索、等级、包装、手工费都能选），不再是弹层里的「预览+确认」。
>   配套裁决 22（手工费率**单据级默认 + 行级可覆盖**）、裁决 23（编辑范围**仅保存前**）。
>   引擎同步支持行级费率，并加守卫钉住「显式传 0 不等于没传」。
> - **v1.1**（2026-09-19）：产品负责人追加裁决 4 条 → 账单**手动勾单**生成、`qtyPerUnit` 建字段默认 1 不启用、
>   真毛利口径 = 出货额 −（材料费+包装费）（手工费算工作室收入）、**首批价目表数据由产品负责人自行填写**
>   （见 [`出货价目表_首版填写清单.md`](./出货价目表_首版填写清单.md)）。ERP 两模块（81/82）未被驳回，视为已定。
> - v1.0（2026-09-19）：首版，含 17 条口径与数据模型。

> 原则：**加法不重构**。复用现有 `ops_shipments` 账本、`dispatchMessage` 通知层、`getStudioDashboard` 仪表盘、`managePurchaseOrder` 的付款状态机范式。
> **本蓝图是本次升级的唯一口径来源。口径变更必须改本文件并升版本号，不许只在聊天里改。**

---

## 0. 业务场景（先对齐现实）

工作室（**供货方 / 收款方**）从 1699、淘宝、闲鱼等渠道订原材料，加工成标本成品后**出货给自己家的两家店**
（**山川造物** `store_shanhaizaowu`、**星宸标本** `store_xingchen`，即**付款方**）。

痛点：门店给工作室结款时**没有价格依据**。现在小程序店长端的出货单粘贴解析**只产出「品名 + 数量」**，
`unitPrice/totalPrice` 一律落 0（`miniprogram/cloudfunctions/manageStoreShipment/shipmentDefaults.js:230-239,392-401`），
于是出货观测台长期报「有单无金额」。

本升级要打通的是这条链：

```
粘贴出货单文本
  → 解析出「材料（含姿态） + 包装方式」两段
  → 查价目表：材料×等级 → 材料费 ；包装×尺寸 → 包装费
  → 手工费 =（材料费 + 包装费）× 费率
  → 汇总成「本单对门店的出货总价」
  → 通知超管 + 店长（工作台 / 工作信息）去付款
  → 门店标「已付款」→ 超管「确认收款」→ 订单终结
  → 同步到 工作室仪表盘 + 工作室账单
```

### 0.1 真实样本（产品负责人提供，2026-09-19）

```
2026，9.14出货
山川造物
独角仙展翅玻璃罩-2
独角仙没展翅玻璃罩-4
华艳色蟌-2
蒲公英玻璃罩-4
雅灰蝶冰箱贴-3
翠蓝眼蛱蝶-7
杂蝶冰箱贴-8
爱神凤蝶玻璃罩-2
爱神凤蝶框-3

星宸标本
爱神凤蝶造景-1
天堂凤蝶造景-1
爱神凤蝶玻璃罩-2
大蓝闪玻璃罩-1
扩头深山锹甲-2
印尼金锹-2
华艳色蟌-2
黄裳眼蛱蝶造景-2
翠蓝眼蛱蝶造景-2
熊风王-2
杂蝶冰箱贴-10
雅灰蝶冰箱贴-3
```

**从样本读出的四条事实**（全部影响设计）：

| # | 事实 | 影响 |
|---|---|---|
| 1 | 品名 = **材料前缀 + 包装后缀**（`独角仙展翅玻璃罩`、`雅灰蝶冰箱贴`、`爱神凤蝶框`、`爱神凤蝶造景`） | 可以**拆解匹配**，不必按整名维护几千条 |
| 2 | 姿态是**材料的一部分**（`独角仙展翅` vs `独角仙没展翅`） | 材料表按「材料+姿态」整名维护；中间残余非空即报红，**不猜** |
| 3 | 存在**简称**（`大蓝闪` = `大蓝闪蝶`）与疑似笔误（`熊风王`？） | 价目表每条**必须可挂别名** |
| 4 | 存在**裸名**（`华艳色蟌` ×2、`翠蓝眼蛱蝶`、`扩头深山锹甲`、`印尼金锹`、`熊风王`） | 6 行没有包装段 → 按裁决 **报红，必须人工选包装** |
| 5 | **等级 `A1/A2` 与尺寸 `20*10` 在真实单据里根本没出现** | 两个维度要**建**（表能填），但匹配时**没写就落到「默认行」** |

**样本统计（逐行数过，作为验收基线）**：**21 行 / 65 件**；其中 **15 行**材料+包装齐全、
**6 行裸名**（涉及 **5 个材料**：华艳色蟌、翠蓝眼蛱蝶、扩头深山锹甲、印尼金锹、熊蜂王）。
去重后共 **14 个材料**（含姿态）与 **4 类包装**（玻璃罩 / 冰箱贴 / 框 / 造景）。


---

## 1. 已拍板口径（产品负责人裁决 2026-09-19，共 13 条，**不可推翻**）

| # | 问题 | 裁决 | 落地含义 |
|---|---|---|---|
| 1 | 品名怎么取价 | **拆解匹配**：前缀找「材料（含姿态）」+ 后缀找「包装」，两段各自取价再加总 | 价目表条数少；新增包装不用重录材料 |
| 2 | 等级/尺寸维度 | **两个都建**，匹配时**没写就用「默认行」** | 表结构支持 A1/A2、20*10；今天的单据也能算对 |
| 3 | 裸名（没写包装） | **报红，必须人工选包装** | 不静默、不默认，宁可让人点一下 |
| 4 | 简称/笔误 | 价目表每条**可配多个别名** | 照抄 `STORES.aliases` 先例（`shipmentDefaults.js:22-25`） |
| 5 | 取不到价的行 | **允许写入**，标「待核价」+ 单据带未核价标记，**阻塞结算** | 不阻断录单（货已发），但把没价变成看得见的待办 |
| 6 | 算出的价能否改 | **允许改，必须留痕**（改前值 / 改后人 / 时间） | 结算金额涉及两家门店分钱，改动必须可追溯 |
| 7 | 谁有权改价 | **只有超管能改**，但店长那侧显示「价格已调整 / 改前值」 | 工作室是定价方；付款方有知情权 |
| 8 | 手工费率粒度 | **全局一个默认值 + 每张出货单可手动覆盖** | 先跑通，出现「某类活更费工」再加维度 |
| 9 | 价目表维护位置 | **ERP 专门模块（表格批量编辑）+ 小程序只读** | 几十~几百行结构化数据，ERP 录入效率远高于手机 |
| 10 | 结算建模 | 出货单加**独立「结算状态」字段**，**与物流状态并行** | 钱和货解耦，不塞进 `STATUS_FLOW` |
| 11 | 账单 | **新建独立账单集合**，一张账单**可汇总多张出货单** | 见 §4.5 **单一权威**设计 |
| 12 | 确认收款 | **两步**：门店标「已付」→ 超管「确认收款」 | 双方都留痕 |
| 13 | 确认收款后 | **终结**：结算「已结清」+ 物流「已完成」 | 一步动作两件事 |
| 14 | 收款前置条件 | **不设前置**（钱可先生效），但**未核价必须拦截** | 现实里常常先打款 |
| 15 | 等级形式 | **自由文本** + 每条材料指定一个「默认等级」行 | 以后加 A3/B1 不用改代码 |
| 16 | 历史 0 元单 | 提供**「重算历史单」按钮**，产品负责人手动触发 | 不自动回填 |
| 17 | 飞书回写 | **回写「单价 + 总价」**，并**顺手修掉现有 bug** | 见 §9.2 |
| 18 | 账单生成方式 | **手动：选门店 + 超管自己勾选要结的出货单** | 不自动生成；可只结 3 张，也可按月全勾（`v1.1` 追加） |
| 19 | `qtyPerUnit` | **建字段，默认 1、现在不启用** | 表结构留好扩展点，但 ERP 里不必填，避免维护负担（`v1.1` 追加） |
| 20 | 真毛利口径 | **毛利 = 出货额 −（材料费 + 包装费）**，**手工费算工作室收入不减** | 修正现有 `netProfit = 营收 − 采购总额`（`getStudioDashboard/index.js:557`）**根本没扣材料成本**的问题（`v1.1` 追加） |
| 21 | 首批价目表数据 | 产品负责人**自行填写**空白清单 | 我不编价格；清单见 [`出货价目表_首版填写清单.md`](./出货价目表_首版填写清单.md)（`v1.1` 追加） |
| 22 | 手工费率粒度 | **单据级默认 + 行级可覆盖（默认不启用）** | 平时只用页面上的「本单手工费率」；遇到「这个造景特别费工」才给某行单独设（`v1.2` 追加） |
| 23 | 可编辑页面的范围 | **只编辑「保存前」的解析结果** | 已保存的单要改价仍走超管「改价留痕」（裁决 6/7），两条路不混（`v1.2` 追加） |
| 24 | 解析结果的呈现 | **逐行可编辑页面**（不是弹层预览确认） | 材料**可输入搜索**、等级、包装、手工费都要能选；改任一项立即重算该行与整单（`v1.2` 追加） |

> 条目数超过 13 是因为第 12 条之后是同一轮的后续确认；全部为产品负责人明确选择。
> **口径变更必须改本表并升版本号，不许只在聊天里改。**


---

## 2. 现状事实（已核实，带证据）

| 主题 | 事实 | 证据 |
|---|---|---|
| 出货单账本 | `ops_shipments`，**一条记录 = 一张单**（一店+一日期），明细在 `items[]`；`batchId` 串一次粘贴的多店单 | `shipmentDefaults.js:490-533`、`index.js:488-525` |
| 解析器 | 只认 `^(.+)-(\d+)$`：最后一个 `-数字` 是数量，其余**全是品名** | `shipmentDefaults.js:230-239` |
| 解析器**无价格** | `parseItemLine` 只产 `itemName/qty` → `unitPrice=0`、`totalPrice=0` | `shipmentDefaults.js:392-401` |
| 单据级单价 bug | `unitPrice` **仅 items 长度 == 1 时有值，多明细强制 0** | `shipmentDefaults.js:502` |
| 飞书回写 bug | 回写只回 `unitPrice`，映射表**连「总价」都没有** → 多明细单回写飞书写 0 单价 | `feishuSync.js:99-116,428-446` |
| 状态机 | 7 值纯物流：`draft/confirmed/pending/shipped/received/completed/cancelled` | `shipmentDefaults.js:40-68` |
| **收货/结算概念** | 全模块零命中（`收款\|付款\|结算\|paid\|payment\|settle\|receivable`） | 侦察确认 |
| 两种粒度并存 | 粘贴=一店一单多明细；飞书=`一行飞书记录 = 一张单明细单` | `index.js:640-643`、`shipmentDefaults.js:679-738` |
| 营收口径 | 写入当天即**全额计入营收**，不区分是否收款 | `shipmentDashboard.js:511-524` |
| 原材料库存 | **已存在** `studio_raw_inventory`，**已带 `unitPrice` + `stockValue`** | `rawDefaults.js:43,53-54` |
| 等级维度 | **全仓零命中**（唯一 `A1/A2` 是 `purchase_intents.md` 的安全规则级别） | 侦察确认 |
| 包装价 | 最接近的是 `custom_configs`（`type:'packaging'` + `priceDelta`），但那是 **C 端定制加价**，与 B 端成本价**语义相反** | `cloudbase/schema/custom_configs.md:20-28` |
| 手工费 | **不存在**；`operationsManualData.js:14,320` 把「成本核算与定价模型」列为**待办** | — |
| 工作室仪表盘 | **已存在**：页面 `subpackages/manager/studio-dashboard` + 云函数 `getStudioDashboard`，**超管专属**，且**已把出货单当营收** `revenueTotal` / `netProfit = 营收 − 采购` | `getStudioDashboard/index.js:522,557`；页面 `:104 guardStaffPage('super_admin')` |
| 通知层 | 全仓**唯一**通知层 `dispatchMessage` → 写 `user_messages` + 镜像 `notification_logs` | `dispatchMessage/core.js:105,108` |
| 「工作信息」 | = 消息页的 `queue=workflow` 视图，是「我的」页工作台框阵**置首**磁贴 | `messages/index.js:85`；`pages/user/index.js:167-175` |
| 收件人解析先例 | `listStaffOpenidsByRoles` 读 `staff_members` 按角色取 openid | `payCallback/staffNotify.js:74-126` |
| 付款状态机先例 | `managePurchaseOrder` 的 `pending_pay/paid` + `STATUS_FLOW` | `purchaseDefaults.js:33-53,63-75` |
| 账单 | **零存量**：`docs/`、`admin/docs/` 均无「账单/结算」蓝图 → 属从零定义 | 侦察确认 |

### 2.1 一个必须先讲清的结论：谁付谁收

工作室出货给**自己的两家门店** → **店长是付款方，超管是收款方**，双方都是**有 openid 的员工**。
所以「通知相关人支付货款」用 `dispatchMessage` + `staff_members` 就做得到。

> ⚠️ 反过来若将来要通知**外部客户**付款，`ops_shipments` 只有 `customerName/buyerName` **文本字段、没有 openid**
> （`shipmentDefaults.js:457-471`），必须先解决身份绑定 —— 本 Phase 不做。

---

## 3. 架构总览

```
                    ┌──────────────── 价目表（新，ERP 维护 / 小程序只读） ────────────────┐
                    │  studio_material_prices      studio_packaging_prices            │
                    │  材料名(含姿态) + 等级 + 别名   包装名 + 尺寸 + 别名                  │
                    │  unitPrice / isDefaultGrade   unitPrice / isDefaultSize          │
                    └───────────────────────┬─────────────────────────────────────────┘
                                            │ 查价（纯函数，服务端唯一）
              configs/studio_settlement ────┤
              （手工费率 30% 等全局单值）      │
                                            ▼
  粘贴文本 ──► manageStoreShipment.parseText ──► quotePrice ──► 逐行 材料费/包装费/手工费
  单条录入 ──►                                  （预览与写入共用同一引擎）
                                            │
                                            ▼ 写入时快照定价（价目表以后改价不影响已出货单）
                                   ops_shipments（+ 结构化明细 + 算价快照 + 结算字段）
                                            │
                        ┌───────────────────┼────────────────────┐
                        ▼                   ▼                    ▼
              dispatchMessage        manageStudioSettlement    getStudioDashboard
              「待支付」通知          ┌──────────────────┐      + 未收款 / 已结清 KPI
              超管 + 店长              │ ops_settlement_bills │
                                     │ 未结 → 已付待确认 → 已结清 │
                                     └──────────────────┘
                                      确认收款 = 终结：
                                      账单 settled + 其下所有单
                                      settleStatus=settled + status=completed
```

---

## 4. 数据模型

### 4.1 `studio_material_prices` · 原材料价目表（**新集合**）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | **匹配键**：材料名（**含姿态**），如 `独角仙展翅`、`大蓝闪蝶`、`华艳色蟌` |
| `normName` | string | ✅ | `name` 归一化后的值（见 §5.1），**唯一约束与索引用它**，避免全角/空格造成重复行 |
| `displayName` | string | | 展示名，如 `独角仙（展翅）`；空则回落 `name` |
| `aliases` | string[] | | 别名（简称/笔误）：`['大蓝闪']`、`['熊蜂王']`。**归一化后参与匹配** |
| `grade` | string | ✅ | 等级，**自由文本**（`A1`/`A2`/`极品`…）。默认 `'默认'` |
| `isDefaultGrade` | boolean | ✅ | 同一 `normName` 下**恰好一行**为 `true` → 文本没写等级时用它 |
| `unitPrice` | number | ✅ | 该等级单价（元 / `unit`） |
| `qtyPerUnit` | number | ✅ | **每件成品消耗的材料单位数**，默认 `1`（见 §5.3「单位换算」） |
| `unit` | string | | `只` / `张` / `套` |
| `category` | string | | 复用 `工具\|标本`（`rawDefaults.js:15`） |
| `status` | `active\|inactive` | ✅ | 停用行不参与匹配（历史单快照不受影响） |
| `note` | string | | 备注 |
| `sort` | number | | 排序 |
| `createdAt/updatedAt/updatedBy` | | | 审计，照抄 `manageStudioRawInventory/index.js:131-137` |

**唯一约束**：`normName + grade` 唯一。
**完整性约束**（由 §8 守卫 `check:price-book-integrity` 保证校验逻辑存在）：
- 同一 `normName` 下**恰好一行** `isDefaultGrade === true`
- `unitPrice >= 0`、`qtyPerUnit > 0`
- **别名不得跨材料冲突**（同一别名归一化后只能指向一个 `normName`）

### 4.2 `studio_packaging_prices` · 包装价目表（**新集合**）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | **匹配键**：包装方式，如 `玻璃罩`、`冰箱贴`、`框`、`造景` |
| `normName` | string | ✅ | 归一化值，唯一约束用它 |
| `aliases` | string[] | | 别名，如 `['玻璃 罩']`、`['相框']` |
| `size` | string | ✅ | 尺寸，**自由文本**，如 `20*10`、`15*8`；默认 `'默认'` |
| `isDefaultSize` | boolean | ✅ | 同一 `normName` 下**恰好一行**为 `true` |
| `unitPrice` | number | ✅ | 包装件单价 |
| `qtyPerUnit` | number | ✅ | 每件成品消耗的包装数，默认 `1` |
| `unit` | string | | `个` / `套` |
| `status` / `sort` / `note` / 审计字段 | | | 同 §4.1 |

> **为什么两张表而不是一张**：产品负责人的心智模型就是「原材料价目表」和「包装价目表」两份；
> 两者字段不同（`grade` vs `size`）、维护节奏不同。**不合并**，但由**同一个云函数**管理，登记面只多一份。
>
> **明确不动的表**：`custom_configs`（C 端定制加价）**保持原样**。它的 `priceDelta` 是**对外加价**，
> 本蓝图的 `unitPrice` 是**对内成本价**，语义相反，**严禁混用或互相回写**（`cloudbase/schema/custom_configs.md:20-28`）。

### 4.3 `configs/studio_settlement` · 结算配置（**单文档，复用既有 `configs` 集合**）

```jsonc
{
  "_id": "studio_settlement",
  "enabled": true,           // 算价总开关（缺字段默认【关】，与 showXxx 同先例）
  "laborRatePct": 30,        // 手工费率（%），裁决 8
  "requirePackaging": true,  // 裸名是否报红，裁决 3
  "rounding": "cent",        // 取整到分（金额一律以「分」做整数运算，见 §5.4）
  "updatedAt": 0, "updatedBy": ""
}
```

**为什么放 `configs` 而不是新建集合**：它是**全局单值**，正是仓库既有「小配置进 `configs` 单文档」的模式
（`b2b_catalog`、`feishu_bitable` 都这样，`admin/src/utils/cloudbaseCdnDb.js:203-208`）。
不新建集合 = 少一套 rules/schema/database-rules 登记。

> ⚠️ **不动 `manageStoreContent` 的白名单**：该云函数只放行 4 个 doc id
> （`STORE_CONTENT_SET_DOC_IDS`，`manageStoreContent/index.js:44-45`），未列入的会被降级成 update。
> 本配置的读写**全部走新云函数** `manageStudioSettlement`，**不经过 `manageStoreContent`**，因此无需改白名单。

### 4.4 `ops_shipments` 追加字段（**不新建出货表**）

**行级（`items[]` 每行）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `materialId` / `materialName` / `materialGrade` | string | 命中的材料行（`materialId` = 价目表 `_id`） |
| `packagingId` / `packagingName` / `packagingSize` | string | 命中的包装行 |
| `unitMaterialCostCents` / `unitPackagingCostCents` / `unitLaborCostCents` | number | **分 / 件**（整数），见 §5.4 |
| `unitTotalCents` / `lineTotalCents` | number | **分 / 件** 与 **分 / 行**（`lineTotalCents` = `unitTotalCents × qty`） |
| `unitPrice` / `totalPrice` | number | **已有字段**，改为算价结果（元，2 位小数） |
| `pricingStatus` | `priced\|unmatched\|ambiguous\|manual` | `unmatched`=取不到价；`ambiguous`=多义；`manual`=人工填/改 |
| `pricingNote` | string | 未匹配原因原文，直接给用户看 |
| `laborRatePct` | number\|null | **行级费率覆盖**（裁决 22）：`null` = 用单据级；**显式 `0` 是合法值**（这一行不收手工费） |
| `laborRateSource` | `line\|shipment` | 本行实际生效费率的来源，留痕用（账单对账要能说清这行按几个点算的） |
| `priceAdjusted` | boolean | 是否被人工改过 |
| `priceAdjustments[]` | array | `{at, by, byName, field, from, to, reason}` —— **裁决 6 的留痕** |

**单据级**

| 字段 | 类型 | 说明 |
|---|---|---|
| `pricingStatus` | `priced\|incomplete` | `incomplete` = 存在未核价行 → **阻塞结算**（裁决 5） |
| `materialTotal` / `packagingTotal` / `laborTotal` | number | 三分项合计（分） |
| `laborRatePct` | number | **本单费率快照**（覆盖后存本单值，裁决 8） |
| `pricedAt` / `pricedBy` | | 算价时间/人 |
| `settleStatus` | `unsettled\|paid_pending\|settled` | **派生字段**（见 §4.5），**不得直接写** |
| `billId` / `billNo` | string | 所属账单 |
| `paidMarkedAt/By` `settledAt/By` | | 由账单同步下来，供列表直接显示 |

### 4.5 `ops_settlement_bills` · 工作室账单（**新集合 · 结算唯一权威**）

| 字段 | 类型 | 说明 |
|---|---|---|
| `billNo` | string | `SB{YYYYMMDD}{4随机}`，照抄 `genShipmentNo`（`shipmentDefaults.js:171-179`） |
| `storeId` / `storeName` | string | 账单归属门店 |
| `periodFrom` / `periodTo` | string | 账期（默认当月） |
| `shipmentIds` | string[] | 汇总的出货单 id |
| `shipmentCount` / `itemCount` / `totalQty` | number | 冗余汇总 |
| `materialTotal` / `packagingTotal` / `laborTotal` / `totalAmount` | number | 金额（分） |
| `laborRatePct` | number | 生成时费率快照 |
| `status` | `unsettled\|paid_pending\|settled` | 账单状态机（§6.2） |
| `paidMarkedAt/By/ByName` `paidNote` `paidProof` | | 门店标已付（凭证可选） |
| `settledAt/By/ByName` `settleNote` | | 超管确认收款 |
| `pricingIncomplete` | boolean | 含未核价单 → 禁止生成（生成前拦截） |
| `createdAt/createdBy/updatedAt/updatedBy/deleted` | | 审计 + 软删 |

#### ⚠️ 单一权威设计（**本蓝图最关键的一条架构决定**）

裁决 10 给出货单加了结算状态，裁决 11 又要独立账单集合。**如果两者都能改结算状态，就是两个账本**，
以后必然出现「出货单说没结、账单说结了」且无法判定谁对。

**因此定死**：

1. **账单是结算权威**（authority）。结算状态只在账单上被**写**。
2. **出货单的 `settleStatus` / `billId` / `paidMarkedAt` / `settledAt` 是派生的**，
   只由账单状态变更时**单向同步**下来（为了列表/仪表盘不必连表）。
3. **`manageStoreShipment` 不得写 `settleStatus`**（由守卫 `check-settlement-single-ledger` 钉死 + 注入验证）。
4. 一张出货单**同时只能属于一张未结清的账单**（生成时校验）。

---

## 5. 算价引擎（纯函数，**服务端唯一实现**）

新建 `miniprogram/cloudfunctions/manageStoreShipment/pricingEngine.js`：

- **零 db 依赖的纯函数** → 预览 action 与写入 action **require 同一份**，杜绝「预览价与落库价漂移」；
- 可直接被守卫单测 require（照抄 `test-wish-wall.mjs` 对纯函数的测法）；
- **客户端一律不算价**：单条录入的 `formAmountPreview` 也改调 `quotePrice`（现状 `shipment-ops/index.js:676-686` 是本地算的）。

### 5.1 归一化（`normalizeName`）

`trim` → 全角转半角（含 `＊→*`、`×→*`、全角数字/字母）→ 去所有空白与零宽字符（`\u200b-\u200d\ufeff`）
→ 拉丁字母统一大写。**`normName` 落库时即算好**，匹配时对输入做同样归一化。

### 5.2 拆解匹配（`resolveLine`）

```
输入：itemName（归一化后）+ 可选 gradeHint / sizeHint
① 材料前缀匹配：遍历材料表 active 行，取「normName 或任一 alias 是输入前缀」的**最长命中**
   ├─ 命中 → materialRow；剩余串 = 输入去掉该前缀
   └─ 未命中 → pricingStatus='unmatched'，note='未找到原材料'
② 等级识别：在剩余串紧邻位置尝试匹配该 material 的已知 grade 文本
   ├─ 命中 → 用该 grade 行
   └─ 否则 → 用 isDefaultGrade 行（裁决 2/15）
③ 包装后缀匹配：在剩余串里取「normName 或任一 alias 是剩余串后缀」的**最长命中**
   ├─ 命中 → packagingRow，residual = 剩余串去掉该后缀
   ├─ 剩余串为空 → pricingStatus='unmatched'，note='未写包装方式'（**裁决 3：报红**）
   └─ 未命中 → pricingStatus='unmatched'，note='未找到包装方式'
④ 尺寸识别：同 ②，命中则用该 size 行，否则 isDefaultSize 行
⑤ 残余校验：residual 非空 → pricingStatus='ambiguous'，note='残留未识别：xxx'（**不猜**）
⑥ 多义检测：若某一步存在**等长**的多个命中 → pricingStatus='ambiguous'，列出候选
```

**匹配示例（用真实样本验证）**

| 输入 | 材料命中 | 剩余 | 包装命中 | 结果 |
|---|---|---|---|---|
| `独角仙展翅玻璃罩` | `独角仙展翅` | `玻璃罩` | `玻璃罩` | ✅ |
| `独角仙没展翅玻璃罩` | `独角仙没展翅` | `玻璃罩` | `玻璃罩` | ✅ |
| `大蓝闪玻璃罩` | `大蓝闪蝶`（别名 `大蓝闪`） | `玻璃罩` | `玻璃罩` | ✅ |
| `雅灰蝶冰箱贴` | `雅灰蝶` | `冰箱贴` | `冰箱贴` | ✅ |
| `爱神凤蝶框` | `爱神凤蝶` | `框` | `框` | ✅ |
| `华艳色蟌` | `华艳色蟌` | `''` | — | ❌ 报红「未写包装方式」 |
| `熊风王` | `熊蜂王`（别名 `熊风王`） | `''` | — | ❌ 报红「未写包装方式」 |

> 前缀/后缀**都必须取最长命中**，否则 `爱神凤蝶` 会被 `爱神`（若存在）抢先命中。

### 5.3 金额计算

```
材料费(分) = round(materialUnitPrice × 100) × materialQtyPerUnit × qty
包装费(分) = round(packagingUnitPrice × 100) × packagingQtyPerUnit × qty
手工费(分) = round((材料费 + 包装费) × laborRatePct / 100)
行小计(分) = 材料费 + 包装费 + 手工费
本单总价(分) = Σ 行小计
```

**手工费率的取值优先级**（裁决 8 + 22）：

```
① 行级 line.laborRatePct —— 显式传了就用它，**包括显式传 0**
② 单据级 ctx.laborRatePct —— 页面上的「本单手工费率」，默认带出全局配置值（30%）
③ 全局配置 configs/studio_settlement.laborRatePct
```

> ⚠️ **不许用真值判断**（`line.laborRatePct ? … : …`）：`0` 是合法费率（这一行不收手工费），
> 用真值判断会把它当成「没传」而回落到单据级 → **免手工费的行被静默加价**。
> 引擎已按「`undefined`/`null`/`''` 才算没传」实现，守卫 `test:studio-pricing` 的 G7–G10 钉住，
> 并有一条注入专门证明这个坑能被检出。

**单位换算（`qtyPerUnit`）**：材料单价按「只」、成品按「件」计价。
样本里 `独角仙展翅玻璃罩-2` = 2 件 × 1 只 = 2 只。**默认 `qtyPerUnit = 1` 即当前正确**；
但「一个造景用 3 只蝶」这类必须能表达，所以字段现在就建好（**默认 1、暂不启用**）。

### 5.4 取整与浮点（**财务正确性硬要求**）

**全程用「分」做整数运算，最后才转元**。理由：逐行 `÷100` 再浮点累加会产生 0.01 级误差，
两家门店分钱 + 对账场景下不可接受。规则：
- 单价存**元**（`unitPrice`，人读），算价时 `×100` 取整为分；
- 手工费**按行**计算后四舍五入到分，再累加（口径：每行独立成价，行小计之和 = 单总价）；
- 落库时 `unitPrice`/`totalPrice`/`totalAmount` 仍是**元（2 位小数）**，保持既有字段语义与飞书/看板兼容；
- 分单位值另存（`unit*Cents` / `lineTotalCents`），供日后审计对账。

> ⚠️ **字段名必须自带单位**（`unit*Cents` = 分/件、`lineTotalCents` = 分/行）。
> 这是被真实事故逼出来的规矩：最初字段叫 `materialCostCents`（每件）与 `totalCents`（整行），
> 两个名字看起来同级、实际单位不同 —— 汇总时若对两者都乘 `qty`，**总额正好翻倍**，
> 而且不报错、类型也对，只有对账时才发现。详见 `docs/AI施工错题本.md` 的 **E18**。
>
> **单据级合计按定义取分项之和**（`totalCents = materialCostCents + packagingCostCents + laborCostCents`），
> 而不是"另算一遍再指望两处一致" —— 让不变量成为**结构性**的。
> 守卫 `test:studio-pricing` 的 E19/E20/E21 三条不变量 + 一条**专门复现该翻倍 bug 的注入**钉住它。

### 5.5 定价快照与重算（**防止历史单被改价**）

- 写入时把命中的 `materialId/grade/packagingId/size` + 费率 + 金额**快照进单据**。
- **价目表以后改价，不影响任何已存在的单**（快照隔离）。
- **重算**是**显式动作**（裁决 16）：`repriceShipments`，**仅超管**，**仅对未结清的单**生效，
  **已结清的单永不重算**，且写审计（改前/改后总额、操作人、时间）。
- 必须先 `dryRun: true` 报影响面（哪些单、总额变化），确认后才真跑。

### 5.6 未匹配数据的表示（**不许用 0 冒充合法价**）

`unmatched` / `ambiguous` 行的 `unitPrice = null`（**不是 0**）。
现状 `0` 的问题是它**看起来像合法价**，看板据此报「有单无金额」却分不出「没价」和「真的是 0 元」。
单据级 `pricingStatus='incomplete'` → **阻塞结算**（裁决 5）。

---

## 6. 流程与状态机

### 6.1 结算状态 vs 物流状态（**两个正交维度，裁决 10**）

```
物流状态（既有，不动）：draft → confirmed → pending → shipped → received → completed
结算状态（新增，独立）：unsettled → paid_pending → settled
```

**禁止把结算状态塞进 `STATUS_FLOW`**（`shipmentDefaults.js:60-68`）—— 否则钱和货互锁，
「已发货但没结款」就无法表达。

### 6.2 账单生命周期

```
        生成账单（超管手动：选门店 → 勾选未结清且已核价的单 → 生成，裁决 18）
                      │
                      ▼
                 unsettled（未结）
                      │  门店点「已付款」（可填备注/凭证）
                      ▼
              paid_pending（已付待确认）
                      │  超管点「确认收款」
                      ▼
        settled（已结清）══► 终结副作用（§6.3）
```

- **生成方式**：**手动勾单**（裁决 18）。超管选门店 → 列出该店所有 `unsettled` 且 `priced` 的单 → 勾选 → 生成。
  勾选界面默认按 `shipmentDate` 倒序，并显示每单金额与合计，便于「按月全勾」或「只结某几张」。
- **生成前置**：账单内所有单 `pricingStatus === 'priced'`；否则拒绝并列出未核价单（裁决 14）。
  未核价的单**在勾选列表里就置灰不可选**，并直接显示原因，不让超管勾完才被拒。
- **不设收款前置**：允许「未签收先结清」（裁决 14），但仪表盘**单独列出**这类单。
- **作废**：`voidBill` 仅超管，仅 `unsettled` 可作废，其下单据回到未结并可重新入账。

### 6.3 「确认收款」= 终结（裁决 13）

一个动作，四件事，**必须在一个云函数调用内完成**（幂等）：

1. 账单 `status = 'settled'`，写 `settledAt/By/ByName`
2. 账单下**每一张**出货单：`settleStatus='settled'`、`settledAt/By`
3. 账单下**每一张**出货单：`status='completed'`（物流终结）
4. 发通知（§7）

**幂等**：已 `settled` 的账单重复调用直接返回成功，不重复写、不重复通知（照抄仓库既有幂等纪律）。

---

## 7. 通知（**复用 `dispatchMessage`，不发明新通道**）

新增 3 个模板（形状照抄 `payCallback/inAppMessage.js:20-30`，`category:'ops'`、`queue:'workflow'`）：

| 模板 | 触发时点 | 收件人 | 文案要点 |
|---|---|---|---|
| `studio_shipment_priced` | 出货单写入且已核价 | **超管 + 该门店店长** | 「新出货单 SH… 待支付 ¥X，共 N 件 M 行」`actionUrl` → 出货单详情 |
| `studio_bill_paid_marked` | 门店标「已付款」 | **超管** | 「星宸标本 已标付款 ¥X，待确认收款」`actionUrl` → 账单详情 |
| `studio_bill_settled` | 超管确认收款 | **该门店店长** | 「9 月货款 ¥X 已结清」`actionUrl` → 账单详情 |

**收件人解析**：照抄 `payCallback/staffNotify.js:74-126 listStaffOpenidsByRoles`
（读 `staff_members` 按 `status:'active'` + 角色匹配；超管走 `SUPER_ADMIN_OPENIDS` + `workspace_acl/super_admins` 兜底）。

**为什么不用 C 端用户通道**：收付双方都是员工，`queue:'workflow'` 正是「工作信息」入口
（`messages/index.js:85`），且有现成的角标 + 跑马灯 + 声音（`utils/workNoticeCatalog.js:4`）。

**若单据含未核价行**：仍通知，但文案改为「有新出货单，**有 N 行待核价**，暂不生成账单」——**不许报一个假金额**。

---

## 8. 界面

### 8.1 ERP（新增 2 个模块 · 裁决 9）

| id | 名称 | 域 | 组件 | 做什么 |
|---|---|---|---|---|
| `81` | **价目表配置** | `STUDIO` / 工作室 | `PriceBookManager.vue` | 原材料价 + 包装价 两个 Tab 的表格批量编辑；费率与规则；完整性校验提示（同一 name 只能一个默认行） |
| `82` | **工作室账单** | `STUDIO` / 工作室 | `StudioBills.vue` | 账单列表/筛选/详情/明细导出；对账核对（只读 + 超管可作废） |

> **两模块而不是一个带 Tab 的模块**：账单是财务对账（天天看）、价目表是定价配置（偶尔改），
> 读者与变更频率都不同；且仓库已有「报价单配置」(57) 独立成模块的先例。
> **这是我在蓝图里替你定的，若要合成一个模块请驳回。**
>
> 新 id 取 `81`/`82`（当前最大 `80`，`admin/src/utils/modulesRegistry.js:50` 段）。

### 8.2 小程序 · 出货单「逐行可编辑」页面（**新页面** · 裁决 24）

**为什么新开页面而不是在弹层里做**：一单实测 21 行（`§0.1` 样本），
每行要放「材料 + 等级 + 包装 + 尺寸 + 手工费」5 个可交互控件 —— 弹层里屏幕根本不够，
用户也无法滚动核对整单。`shipment-ops` 现有的弹层保留为**快捷入口**，核对与修正进本页。

`subpackages/extra/shipment-edit/index.{js,json,wxml,wxss}`：

**每行 = 一张可编辑卡片**

```
┌──────────────────────────────────────────────┐
│ #1  独角仙展翅玻璃罩-2          [删除]        │  ← 原始行文本（只读，便于对照）
│ 原材料  [独角仙展翅        ▾]  ← 可输入搜索   │
│ 等级    [默认            ▾]                   │  ← 该材料的等级行（默认=默认行）
│         材料费 ¥180.00/件                     │
│ 包装    [玻璃罩          ▾]  ← 可输入搜索     │
│ 尺寸    [20*10           ▾]                   │  ← 该包装的尺寸行
│         包装费  ¥45.00/件                     │
│ 手工费  [ 30 ]%  □ 本行单独设                 │  ← 裁决 22：默认收起，勾选才出现
│         手工费  ¥67.50/件                     │
│ 数量    [- 2 +]                               │
│ ──────────────────────────────────────────── │
│ 行小计  ¥585.00                               │
└──────────────────────────────────────────────┘
```

**页面结构**

```
单据头   出货日期 / 门店 / 本单手工费率 [ 30 ]%（默认带出全局配置）
明细区   逐行卡片；未核价行整卡红边 + 顶部显示 `pricingNote`
底部常驻 材料 ¥x  ·  包装 ¥x  ·  手工 ¥x  ·  **合计 ¥x**  ·  [保存]
```

**关键交互规则**

| 规则 | 说明 |
|---|---|
| **材料/包装可搜索** | 输入即查（服务端 `searchPriceBook`，按名称 + **别名**匹配），显示 `名称 / 等级或尺寸 / 单价`；选中后自动带出该条目的默认等级（尺寸）行 |
| **等级/尺寸是二级下拉** | 只列**该材料（该包装）已配置的等级（尺寸）**；没有多档时只有一个「默认」项 |
| **改任一项立即重算** | 该行 + 整单合计同帧更新；**算价一律问服务端**（`quotePrice`），客户端不算钱（蓝图 §5） |
| **未核价行不阻断保存** | 按裁决 5 允许保存，但整单带「待核价」标记且**阻塞结算**；卡片红边 + 明确原因 |
| **裸名行** | 保存前必须选包装（裁决 3）；未选时保存成功但那行是未核价，页面顶部提示「还有 N 行待核价」 |
| **手工费** | 单据级一个输入框（默认 30%）；每行有「本行单独设」勾选，勾了才出现行级输入框（默认不启用） |
| **客户端不算钱** | `quotePrice` 返回逐行金额与汇总，页面只渲染 —— 杜绝「预览价与落库价漂移」 |

**入口与出口**
- **入口**：`shipment-ops` 粘贴解析成功后 → `navigateTo` 本页并带上解析结果（`rawText` + 逐行 `itemName/qty`）；
  也可从 `shipment-ops` 的「逐行新建」进本页空白起单。
- **出口**：保存 → 调 `manageStoreShipment.createFromParsed`（**服务端强制重算，不信任前端传的价**）→ 返回 `shipment-ops`。
- **不做**（裁决 23）：本页**不负责编辑已保存的单**。已保存单要改价走超管「改价留痕」（裁决 6/7）。

**`shipment-ops` 其余部分**
- **单条录入**：`formAmountPreview` **改调 `quotePrice`**（不再本地算，`shipment-ops/index.js:676-686`）。
- **列表**：未核价单据带「待核价」徽标；已结清带「已结清」徽标。
- **详情**：本单待付金额 + 结算状态 + 所属账单；超管可见「改价」（留痕）按钮。

### 8.3 小程序 · 工作室账单（**新页面**，超管专属）

`subpackages/manager/studio-bills/index.{js,json,wxml,wxss}`：
- `onLoad` → `guardStaffPage('super_admin')`（照抄 `studio-dashboard/index.js:104`）
- 列表：按门店/账期/状态筛选；卡片显示 `billNo / 门店 / 账期 / 金额 / 状态`
- 详情：「纳入的出货单」清单 + 「确认收款」按钮（`paid_pending` 才可点）
- 入口三处：`utils/moduleRoutes.js`、`utils/workspaceRoles.js`（`MENU_KEYS` + `TAB_MENU_KEY` + 超管菜单）、hub 磁贴 `manager/manager/index.wxml`

### 8.4 小程序 · 店长侧

- 出货单详情：显示「本单待付 ¥X」+「标记已付款」（**仅本店单**）。
- 被改过价的单：显示 **「价格已调整」** 徽标 + 可展开看改前值（裁决 7）。
- `studio-dashboard`（超管）：新增 KPI「未收款金额 / 已结清金额 / 待确认收款笔数」，并**拆开**现有营收口径
  （现状 `revenueTotal` 在写入当天即全额计入，`getStudioDashboard/index.js:522`）。

---

## 9. 改动面与登记清单（**照抄这份，别漏**）

### 9.1 新集合登记（每个集合 **5 处**）

> AGENTS.md 写「三处同步」，实际是 **5 处**（`docs/并发工作流注册表.json` 自己写的是四处）。以本表为准。

| # | 位置 | 守卫 |
|---|---|---|
| 1 | `admin/src/cloud.js` 的 `COLLECTIONS` | 间接（靠第 5 处） |
| 2 | `cloudbase/rules/<name>.json` | ✅ `check:fn-collection-rules`（只覆盖**云函数里 `db.collection` 引用到**的集合） |
| 3 | `cloudbase/schema/<name>.md` | ❌ 无守卫（本次**补一条**，见 §10） |
| 4 | `miniprogram/database-rules/<name>.json` | ❌ 无守卫（**AGENTS.md 漏列了这处**） |
| 5 | `admin/src/utils/dataSources.js` 的 `CONCEPTS` + `SOURCE_REGISTRY` | ✅ `report:data-sources:strict` |

**本次涉及**：`studio_material_prices`、`studio_packaging_prices`、`ops_settlement_bills`（3 个新集合）。

### 9.2 代码改动面

| 区域 | 文件 | 改什么 |
|---|---|---|
| 算价引擎 | `manageStoreShipment/pricingEngine.js` | **新建**（纯函数：归一化/拆解匹配/金额/取整） |
| 出货云函数 | `manageStoreShipment/shipmentDefaults.js` | `normalizeItems` 加结构化字段白名单（`:383-418`）；`normalizePayload` 透传；新增 `PAYMENT_*`/`PRICING_*` 常量；**修 `:502` 单据级 unitPrice bug** |
| 出货云函数 | `manageStoreShipment/index.js` | 新增 `quotePrice`、`adjustLinePrice`（仅超管）、`repriceShipments`（仅超管，dry-run）；写入前**强制服务端重算**、不信任前端 |
| 出货前端 | `subpackages/extra/shipment-ops/index.js/.wxml` | 粘贴解析成功后跳编辑页；`formAmountPreview` 改调 `quotePrice`；未核价/已结清徽标 |
| **可编辑页** | `subpackages/extra/shipment-edit/**` | **新建**（裁决 24）：逐行卡片 + 材料/包装搜索选择器 + 等级/尺寸二级下拉 + 单据级与行级手工费率；改任一项即重算 |
| 价位搜索 | `manageStudioSettlement` 的 `searchPriceBook` | 供编辑页选择器搜索（名称 + **别名**），返回可选等级/尺寸与单价 |
| 结算云函数 | `cloudfunctions/manageStudioSettlement/` | **新建**：`priceBook.*`（材料/包装/费率 CRUD）+ `bill.*`（生成/列表/详情/标已付/确认收款/作废）+ 终结副作用 + 通知 |
| 仪表盘 | `cloudfunctions/getStudioDashboard/index.js` | 营收三拆（出货额/已结清额/未结算额）+ KPI；`:522-557` 口径修正 |
| 通知 | `dispatchMessage` 模板表 | 新增 3 个模板（`workOrderSubscribe.js:33-48` 登记 `queue:'workflow'`） |
| 新页面 | `subpackages/extra/shipment-edit/**`（裁决 24）、`subpackages/manager/studio-bills/**` + `app.json` | **新建** 两套四件套 + 分包登记 |
| 入口 | `utils/moduleRoutes.js`、`utils/workspaceRoles.js`、`manager/manager/index.wxml` | 账单页入口三处 |
| ERP | `modulesRegistry.js` / `adminNavDomains.js`（**只写 id+desc**）/ `App.vue` / `dataSources.js` | id `81`/`82` 两模块（**共 4 处**，第 4 处是 `dataSources.js`） |
| ERP 组件 | `admin/src/components/PriceBookManager.vue`、`StudioBills.vue` | **新建** |
| 云函数登记 | `miniprogram/cloudbaserc.json` | 登记 `manageStudioSettlement` |
| ERP 代理 | `functions/_lib/cloudbaseCallFn.mjs` + `admin/src/utils/cloudbaseCdnDb.js` | **两处白名单同加**，否则 `check:proxy-allowlist` 红 |
| 飞书 | `admin/src/utils/feishuSync.js` | 回写补「总价」列（`:99-116,428-446`）；修多明细单价 bug |
| staffGuard | `manageStudioSettlement/staffGuard.js` | 从 `manageStaff/staffGuard.js` 同步（56 份副本，用 `sync-staff-guard.sh`） |
| 埋点 | `miniprogram/utils/analytics/eventSchema.js` + `admin/src/utils/analyticsSchema.js` | 新增事件**双端同一行同位置**；`*_gate` 需进 `FUNNELS` |
| 文档 | `admin/docs/README.md` + 本文件 | 登记本蓝图 |

### 9.3 被守卫拦住的风险点（**动手前逐个过**）

| 守卫 | 会因什么红 |
|---|---|
| `check:fn-collection-rules` | 新集合被云函数引用却缺 `cloudbase/rules/<name>.json` |
| `report:data-sources:strict` | 新集合/云函数未登记 `dataSources.js` |
| `check:proxy-allowlist` | `ALLOWED_FUNCTIONS` 与 `ADMIN_PROXY_FUNCTIONS` 只加一侧 |
| `check:write-verify:strict` | ERP 新组件用 CDN 直写却无写结果校验（**优先走代理**） |
| `check:analytics-schema` | 埋点只改一端 / 触发点未登记 |
| `check:nav-sources` | ERP 模块漏第 2 处（`NAV_CURATION`）/ 在 `NAV_CURATION` 里重抄 `title`/`icon` |
| `check:page-paths` `check:require-paths` `check:asset-refs` `check:subpackage-refs` `check:wxml-conditions` | 新页面四件套不全 / `app.json` 未登记 |
| `check:docs-index` | 本蓝图未登记 `admin/docs/README.md` |
| `check:dialog-ratchet` | 新 UI 用 `wx.showToast`/`showModal`（**棘轮只许降**）→ 用 `AppToast`/`AppModal` 或就地文案 |
| `check:silent-catch` / `lint:wxml` / `check:wxss-syntax` | 空 catch / WXML 语法 |
| `check:shared-modules` | `staffGuard.js` 副本与真源不一致 |
| `check:guards-coverage` | 新增守卫未抬 `guards/_meta.json:10` 的 `minGuards`（当前 **93**） |

> ⚠️ **单写者约束**：`package.json`、`miniprogram/app.json`、`admin/src/cloud.js`、`cloudbase/**`、
> `functions/**`、`miniprogram/utils/analytics/**`、`admin/src/utils/analyticsSchema.js`
> 在 `docs/并发工作流注册表.json` 里归 `integration` 流。本任务**必然要改这些文件** →
> 按章程应作为**变更请求**随分支一起提交，`check:workstream-ownership` 当前是 `warn` 模式。

---

## 10. 守卫与自检计划（**每条都必须能证明自己会失败**）

| # | 守卫 | 断言什么 | 注入（必须被检出） |
|---|---|---|---|
| 1 | `test-studio-pricing` | 前缀取最长命中、后缀取最长命中、别名命中、默认等级、默认尺寸、尺寸识别、裸名报红、残余非空报红、等长多义报红、**未匹配写 null 不写 0**、分单位取整、**快照隔离**（改价目表不改已定价单） | ①短掉 `isDefaultGrade` 逻辑 ②把未匹配改回写 `0` ③去掉别名匹配 ④前缀改成"最先命中"而非最长 |
| 2 | `check-price-book-integrity` | 完整性校验函数：同一 `normName` 恰好一个 default、`normName+grade` 唯一、单价 ≥ 0、**别名跨材料冲突**检测 | ①构造两行都 `isDefaultGrade:true` ②构造跨材料同名别名 |
| 3 | `check-settlement-single-ledger` | `settleStatus` **只能**由 `manageStudioSettlement` 写；`manageStoreShipment` 不得出现直接写 | 在 `manageStoreShipment` 注入一行写 `settleStatus` |
| 4 | `test-studio-bill` | 账单状态机、**终结副作用**（账单 settled → 其下所有单 settled + completed）、未核价拦截生成、确认收款**幂等**、作废回退 | ①去掉"每张单都完成"循环 ②去掉幂等短路 ③去掉未核价拦截 |
| 5 | `check-collection-docs`（**新增，补 §9.1 第 3 处的空缺**） | 云函数引用到的每个集合都必须有 `cloudbase/schema/<name>.md`（现状完全没守卫） | 删掉一个已有 schema 文件 |

> 第 5 条是**顺带补的历史空洞**：`cloudbase/schema/` 一直没人守，而 `cloudbase/schema/ops_shipments.md`
> 已经严重滞后（只列 5 字段，实际 20+）。按 AGENTS.md「同类错误第二次发生必须补守卫」，值得补。

---

## 11. 分期与验收

### P0（本轮：**能算钱 + 能收款**）
1. 两张价目表 + `configs/studio_settlement` + `manageStudioSettlement` 的 `priceBook.*`
   （含 `searchPriceBook`：按名称 **+ 别名**搜索，供编辑页的材料/包装选择器用）
2. `pricingEngine.js` + `quotePrice` + **逐行可编辑页面**（裁决 24）+ **未核价拦截**
3. `ops_shipments` 新字段 + 定价快照（含修 `:502` bug）
4. 账单 `bill.*`：生成 / 标已付 / **确认收款终结** / 作废
5. 3 条通知模板
6. `getStudioDashboard` 未收款 KPI + 营收三拆
7. 守卫 1-4 + 集合登记（§9.1）
8. 店长端「标记已付款」+ 超管端账单列表/确认收款页

**验收标准（可复现）**
- 用 §0.1 的 9.14 真实样本粘贴（**21 行 / 65 件**）→ **15 行**（材料+包装齐全的）**都算出价**、
  **6 行裸名**（华艳色蟌×2 / 翠蓝眼蛱蝶 / 扩头深山锹甲 / 印尼金锹 / 熊风王）**明确标红要求选包装**、
  **没有一行静默为 0**
- 在**逐行可编辑页**（裁决 24）上：改某行材料 → 该行与整单合计**立即重算**；
  给某行勾「本行单独设手工费」填 0 → **该行手工费为 0**（不得回落单据级）；
  把 6 行裸名逐一选上包装 → 整单从「待核价」变成「已核价」
- **客户端不算钱**：断网或云函数报错时**不得**显示任何金额（宁可空白，不给假数字）
- 改一次价目表 → **已存在的单价格不变**（快照隔离）
- 含未核价行时：**生成账单被拒**并列出是哪几行
- 点确认收款 → 账单 `settled` + 其下每张单 `settleStatus=settled` 且 `status=completed` + 店长收到工作信息；**再点一次不重复写、不重复通知**
- `npm run check:admin` 全绿；新守卫 `--selftest` 全检出

### P1
9. ERP 两模块：价目表维护（表格批量编辑）+ 工作室账单对账
10. 「重算历史单」（dry-run → 确认）+ 超管改价留痕 UI + 店长侧「价格已调整」
11. 飞书回写扩展（总价列）

### P2
12. 月账单自动生成 / 逾期提醒
13. 真毛利口径（见 §12-③）

---

## 12. v1.1 追加裁决（**已拍板，实施依据**）

| # | 事情 | 裁决 | 落地要点 |
|---|---|---|---|
| ① | **账单生成方式** | **手动勾单**（裁决 18） | `createBill({storeId, shipmentIds[]})`；勾选列表只列 `unsettled` + `priced` 的单，未核价单**置灰不可选并显示原因**；不提供自动按月生成（P2 可再加） |
| ② | **`qtyPerUnit`** | **建字段，默认 1、不启用**（裁决 19） | 两张价目表都建该字段；ERP 表单显示但**非必填**，留空即 1；算价引擎按其值计算，默认路径等价于现状 |
| ③ | **真毛利口径** | **毛利 = 出货额 −（材料费 + 包装费）**；**手工费算工作室收入，不减**（裁决 20） | `getStudioDashboard` 的 `netProfit` 口径改为「Σ(材料费+包装费)」而非「采购总额」；**同时保留**采购口径为独立指标，避免你已看惯的数字消失 —— 两者并列展示并各自标注口径 |
| ④ | **首批价目表数据** | 产品负责人**自行填写**（裁决 21） | 不编价格。空白清单见 [`出货价目表_首版填写清单.md`](./出货价目表_首版填写清单.md)（材料 14 条含姿态与预填别名 / 包装 4 类待补尺寸） |

> ④ 是**实现上游的硬依赖**：价目表没数据 → 算价引擎虽可写但无法端到端验收。
> P0 实现可与填表**并行**（引擎、守卫、账单流程都不依赖具体价格），但 §11 的验收标准必须等数据到位才能跑通。


---

## 13. 风险与已知取舍

| # | 风险 | 处置 |
|---|---|---|
| 1 | **双账本**（账单 vs 出货单都写结算状态） | 已定 **账单唯一权威 + 出货单派生**（§4.5），并由守卫 3 钉死 |
| 2 | 价目表没维护 → 全部报红 | ① P0 先 seed 一批常用材料/包装（从 9.14 样本反推）②未匹配可视化 + 允许**手工填价并留痕**（不留白） |
| 3 | `ops_shipments` **两种粒度**（粘贴多明细 vs 飞书单明细） | 统一按**单**结算（与现有 `totalAmount` 口径一致）；飞书那种单明细单天然兼容 |
| 4 | 历史单 0 元 | 重算按钮（P1），**只对未结清单**，dry-run 先行 |
| 5 | 手工费被当成成本 | §12-③ 待你定；蓝图默认**不减** |
| 6 | 价目表与 `custom_configs` 混用 | 蓝图明确禁止（§4.2）；两者语义相反 |
| 7 | 集成官文件冲突 | 随分支提变更请求；`check:workstream-ownership` 为 `warn`，不静默 |
| 8 | 单位换算（只 vs 件） | `qtyPerUnit` 字段已留（§12-②） |

---

## 14. 与既有蓝图/文档的关系

- **不推翻** [`订货履约与成品库存_Phase1_技术蓝图.md`](./订货履约与成品库存_Phase1_技术蓝图.md)：
  那条线是「门店/渠道**订货**（进）」，本蓝图是「工作室**出货**（出）」，互为反向，共用 `ops_shipments` 之外的集合互不重叠。
  该蓝图 §0.4 明确「❌ 订货在线支付 / 对账开票（可二期接财务）」—— **本蓝图即那二期的「出货侧对账」**，方向相反不冲突。
- **不推翻** [`飞书多维表对接_技术蓝图.md`](./飞书多维表对接_技术蓝图.md)：飞书仍是库存/出货的同步面；
  本蓝图只**扩字段**（单价/总价），不改同步方向与 SSOT。
- [`C端行为埋点说明.md`](./C端行为埋点说明.md)：新增事件按其双端登记规则办。

---

> **下一步**：产品负责人确认 §12 三件事 → 开 `feat/shipment-settlement` 分支 → 按 §11 的 P0 顺序实现，
> 每个 P0 项都配 §10 的守卫与注入。
