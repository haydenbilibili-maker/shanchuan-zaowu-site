# 山海造物 · 订货履约与成品库存 · Phase 1 技术蓝图

> 版本 v1.0 · 2026-08-10 · 面向 `shanchuanzaowu` monorepo（Admin Vue3 + 小程序店长端 + CloudBase）  
> 原则：**加法不重构**。复用现有模块注册、`purchase_intents` 线索、`products.stock` 总部成品仓、店长后台与 `managerShipOrder` 履约范式。不接入飞书原材料、不做多仓/门店独立库存。

---

## 0. 目的与范围

### 0.1 已拍板决策（产品边界）

| # | 决策 | 落地含义 |
|---|------|----------|
| 1 | 飞书继续管**原材料**；Admin 只管**成品 / 门店货** | 原材料不进本账本；对接见 [`飞书多维表对接_技术蓝图.md`](./飞书多维表对接_技术蓝图.md) |
| 2 | **小程序店长端为主**，官网 / Admin 为辅，信息一致 | 订货单写入优先走云函数；三端读写同一集合 |
| 3 | **总部统一仓** + 发给门店 | 仅 `warehouseId = hq`；门店收货确认，不做店仓账与调拨 |
| 4 | 渠道意向**尽快升级**为可履约正式订货单 | `purchase_intents` 保留为线索；一键转 `purchase_orders` |

### 0.2 Phase 1 目标

把「门店/渠道订货 → 总部确认 → 出货 → 收货 → 总部成品库存变动」跑成有状态、有流水、三端一致的闭环。

### 0.3 Phase 1 做

- 正式订货单集合与状态机（覆盖自营店 + 渠道）
- 小程序店长端：选品下单、提交、查看进度、确认收货（主入口）
- Admin：接单确认、生成出货单、填物流、查看库存流水；意向一键转正式单
- 官网 `/price-list`：仍可提交意向；Admin 转单后进入同一履约管线
- 总部成品库存：以 `products.stock` 为仓存；出货扣减、手工入库/盘点写流水

### 0.4 Phase 1 不做

- ❌ 飞书原材料双写（P3 起只读镜像 + 人工应用成品库存，见飞书对接蓝图）
- ❌ 门店独立库存账、跨店调拨、批次/效期/仓位
- ❌ 与 C 端 `orders` 合并（B2B 订货 ≠ 零售订单）
- ❌ 订货在线支付 / 对账开票（可二期接财务）
- ❌ ERP 店铺合规档案（`storeStorage`）强制迁云（订货用小程序 `stores.storeId`）

---

## 1. 架构总览

```
                    ┌─────────────────────────────────────────────┐
                    │         purchase_orders（正式订货单）          │
                    │  draft → submitted → confirmed → shipping     │
                    │       → shipped → received → closed           │
                    └───────────┬─────────────────┬───────────────┘
          主写 ▲                │                 │ 转单
               │                ▼                 │
  店长小程序 ──┼── managePurchaseOrder            │
  (主入口)     │         │                        │
               │         │ 确认后生成               ▼
  官网 price-list ──► purchase_intents ──一键转──► purchase_orders
  (辅：线索)          (保留)              Admin
                                     │
                                     ▼
                          fulfillment_shipments（出货单）
                          pending → shipped → delivered
                                     │
                                     │ 发货成功
                                     ▼
                          stock_movements（总部成品流水）
                          + products.stock 扣减/回补
                                     │
                                     ▼
                          门店确认收货（店长）→ PO = received
```

**一句话**：订货单是履约真相；店长端主写；Admin 确认与出货；库存只记总部成品仓流水。

---

## 2. 复用清单

| 复用项 | 路径 | 用途 |
|--------|------|------|
| 采购意向线索 | `purchase_intents` + `PurchaseIntents.vue` + `src/lib/purchaseIntent.ts` | 转正式单来源；不删集合 |
| 价目 SKU | `src/data/priceList.ts` | B 端订货选品（可与 `products` 映射表扩展） |
| 总部成品数量 | `products.stock` / `skus[].stock` | HQ 仓存字段（本期不新建仓表） |
| C 端扣库范式 | `miniprogram/cloudfunctions/*/stockUtils.js` | 出货扣库逻辑可抽公共或镜像 |
| 店长发货范式 | `managerShipOrder` | 出货写物流字段风格对齐 |
| 门店运营主数据 | `stores.storeId`（小程序） | 订货单 `storeId` 外键 |
| 模块注册 | `modulesRegistry.js` / `sidebarNav.js` / `App.vue` | 挂载升级模块 |
| 集合三处同步 | `admin/src/cloud.js` ↔ `cloudbase/rules` ↔ `cloudbase/schema` | 新集合规范 |

---

## 3. 模块与入口

### 3.1 Admin（辅）

| id | 名称 | 分组 | 说明 |
|----|------|------|------|
| `52` | **订货履约**（由「采购管理」升级） | 业务运营 → 交易履约 | 内 Tab：订货单 / 意向线索 / 出货单 |
| `53` | **成品库存**（新建） | 业务运营 → 商品资产 | HQ 库存列表 + 流水 + 手工入库/盘点 |

组件建议：

- `components/FulfillmentCenter.vue`（壳 + tabs）
  - `PurchaseOrders.vue` · `PurchaseIntents.vue`（现有改造）· `FulfillmentShipments.vue`
- `components/FinishedGoodsInventory.vue`

### 3.2 小程序店长端（主）

在 `subpackages/business/manager` 新增 Tab（或现有订单 Tab 下二级）：**门店订货**

能力：

1. 选门店（`stores`）→ 浏览可订 SKU（Phase 1：价目表镜像或 `products` 标记 `b2bOrderable`）
2. 建草稿 / 提交订货单
3. 列表按状态筛选；确认收货
4. 只读看出货物流（关联 `fulfillment_shipments`）

云函数（推荐单一入口）：`managePurchaseOrder`

| action | 谁调用 | 说明 |
|--------|--------|------|
| `createDraft` / `updateDraft` | 店长 | 写草稿 |
| `submit` | 店长 | → `submitted` |
| `list` / `get` | 店长 / Admin | 列表详情 |
| `confirm` | Admin（或店长只读） | → `confirmed`，可预生成出货草稿 |
| `cancel` | 店长（仅 draft/submitted）/ Admin | 取消 |
| `receive` | 店长 | → `received` → `closed` |
| `convertFromIntent` | Admin | 意向 → 正式单 |
| `createShipment` / `ship` | Admin | 出货 + 扣 `products.stock` + 写流水（Admin 亦可走 `b2bFulfillment.js`） |
| `listShipments` | Admin / 店长 | 出货单列表 |
| `adjustStock` | Admin | 手工入库/盘点（**P2**） |

鉴权：对齐 `MESSAGE_ADMIN_OPENIDS` / 现有店长口令策略；**写库存与发货必须走云函数**，禁止 Admin 前端直改 `stock` 绕过流水（藏品库原有「批量调库存」可逐步改为调 `adjustStock`）。

### 3.3 官网（辅）

- 继续写 `purchase_intents`（字段不变）
- 可选 Phase 1.1：提交成功页提示「将由总部转为正式订货单」
- 不在官网直接创建 `purchase_orders`（避免匿名滥建正式单）

---

## 4. CloudBase 数据模型

### 4.1 `purchase_orders`（正式订货单）

```json
{
  "_id": "string",
  "orderNo": "PO20260810001",
  "source": "store_manager | price_list_convert | admin",
  "intentId": "ref purchase_intents | null",
  "storeId": "store_shanhaizaowu | null",
  "storeName": "string",
  "buyerType": "own_store | channel",
  "contactName": "string",
  "contactPhone": "string",
  "company": "string?",
  "shipToAddress": "string?",
  "note": "string?",
  "items": [
    {
      "skuId": "string",
      "productId": "string?",
      "name": "string",
      "quantity": 1,
      "unitPrice": 0,
      "priceLabel": "string?"
    }
  ],
  "totalAmount": 0,
  "status": "draft | submitted | confirmed | shipping | shipped | received | closed | cancelled",
  "shipmentIds": ["ref fulfillment_shipments"],
  "submittedAt": 0,
  "confirmedAt": 0,
  "shippedAt": 0,
  "receivedAt": 0,
  "createdAt": 0,
  "updatedAt": 0,
  "createdBy": "openid | admin",
  "_openid": "string"
}
```

**状态机**

```
draft ──submit──► submitted ──confirm──► confirmed ──createShipment──► shipping
                                                      │
cancel(draft|submitted)                               ▼
   │                                            shipped ──receive──► received ──► closed
   ▼
cancelled
```

规则建议：`create` 店长/云函数；`update` 收紧为云函数或非匿名（与 `purchase_intents` A2 路线一致）。Phase 1 可暂用 `auth != null` + 云函数业务校验。

### 4.2 `fulfillment_shipments`（总部→门店/渠道 出货单）

与 C 端 `orders.logistics` 分离，避免语义混淆。

```json
{
  "_id": "string",
  "shipmentNo": "SH20260810001",
  "purchaseOrderId": "ref purchase_orders",
  "storeId": "string?",
  "items": [{ "skuId": "string", "productId": "string?", "name": "string", "quantity": 1 }],
  "status": "pending | shipped | delivered | cancelled",
  "logistics": {
    "carrier": "顺丰速运",
    "trackingNumber": "string",
    "shipTime": 0
  },
  "stockDeducted": true,
  "createdAt": 0,
  "updatedAt": 0
}
```

发货成功时：

1. 校验 HQ `products.stock` 充足  
2. 扣减库存  
3. 写 `stock_movements`（`type: outbound_ship`）  
4. PO 状态 → `shipped`（若全部明细已发；支持一期整单发、二期分批发）

### 4.3 `stock_movements`（总部成品流水）

```json
{
  "_id": "string",
  "warehouseId": "hq",
  "productId": "string",
  "skuId": "string?",
  "skuName": "string?",
  "delta": -2,
  "balanceAfter": 10,
  "type": "outbound_ship | inbound_manual | adjust | return_in",
  "refType": "fulfillment_shipment | purchase_order | manual",
  "refId": "string",
  "note": "string?",
  "operator": "openid | admin",
  "createdAt": 0
}
```

**库存真相**：`products.stock` = 总部成品可用量；流水只追加、不删改。飞书原材料**不**写入本表。

### 4.4 `purchase_intents`（保留）

- 状态仍可 `pending | contacted | closed`
- 新增可选字段：`convertedOrderId`、`convertedAt`（转单后回写）
- `closed` 在转单成功后自动或半自动设置

### 4.5 SKU 映射（轻量）

Phase 1 允许订货行只有价目 `skuId` + 名称；发货扣库前须绑定 `productId`。  
Admin 确认单时可补全映射；或维护 `configs` 文档 `b2b_sku_map`：`{ priceListSkuId → productId }`。

---

## 5. 三端一致性约定

| 动作 | 主入口 | 集合变化 | 禁止 |
|------|--------|----------|------|
| 门店下单 | 店长 `managePurchaseOrder` | `purchase_orders` | Admin/官网直插绕过云函数（官网仅意向） |
| 意向转单 | Admin | intent + new PO | 改 intent 当正式履约 |
| 确认订货 | Admin | PO → confirmed | 无确认直接发货（可配置开关，默认关） |
| 出货 | Admin 云函数 `ship` | shipment + stock + movement + PO | 前端只改 status 不扣库 |
| 收货 | 店长 | PO → received/closed | Admin 代收货仅作兜底并留操作者 |
| 调库存 | Admin 库存页 → `adjustStock` | stock + movement | 藏品库静默改数字且无流水（迁移期可双写告警） |

---

## 6. 分期与里程碑

| 阶段 | 交付 | 验收要点 |
|------|------|----------|
| **P0** | `purchase_orders` + 店长下单/提交/列表 + Admin 订货单列表与确认 + 意向一键转单 | 自营店可从店长端下单；渠道意向可转正式单；状态一致 |
| **P1** | `fulfillment_shipments` + 发货扣 HQ 库存 + 店长收货 | 发货后 `products.stock` 与流水一致；收货闭环 |
| **P2** | 模块 `53` 成品库存 UI + 手工入库/盘点 + 藏品库调库存改走流水 | 任意库存变动可追溯 |
| **P3** | 飞书多维表对接：只读采购/库存镜像、出货回写、人工应用 HQ 库存 | 见 [`飞书多维表对接_技术蓝图.md`](./飞书多维表对接_技术蓝图.md) |

建议实施顺序：**先 P0 文档落地集合与云函数骨架 → 店长 Tab → Admin 升级 52 → P1 出货扣库**。

---

## 7. 注册与工程清单（实施时勾选）

- [x] `admin/src/cloud.js` → `COLLECTIONS` 三集合常量
- [x] `cloudbase/schema|rules` · `purchase_orders` / `fulfillment_shipments` / `stock_movements`
- [x] `docs/cloudbase-collections.md` 登记 P5
- [x] `admin/scripts/provision-purchase-orders.mjs` + `provision-fulfillment-p1.mjs`（已执行）
- [x] 云函数 `managePurchaseOrder`（`ship` / `receive` / `listShipments`；需开发者工具重传）
- [x] 店长订货页 + 确认收货
- [x] Admin 订货履约：确认 / 出货扣库 / 出货单 Tab / 意向转单
- [x] `modulesRegistry.js` / `sidebarNav.js` / `App.vue` / 能力边界文档
- [ ] 模块 `53` 成品库存 UI + 手工入库盘点（**P2**）
- [x] 飞书对接骨架：`syncFeishuBitable` + 订货履约「飞书对接」Tab（**P3**；需配置密钥并部署）

---

## 8. 风险与待定

| 项 | 说明 | 建议默认 |
|----|------|----------|
| 价目 SKU ↔ `products` 未一一对应 | 扣库前必须有 `productId` | 确认单时强制映射 |
| 店长鉴权偏弱（客户端口令） | 与现网一致；库存写操作依赖云函数 + openid 白名单 | P0 沿用；P2 收紧 |
| 分批发货 | 复杂度高 | P1 整单一次发齐 |
| 渠道无 `storeId` | `buyerType=channel`，地址用联系人字段 | 允许 `storeId` 空 |
| 与 C 端抢同一 `products.stock` | 零售与 B2B 共用 HQ 成品仓 | 接受共用；二期可标 `stockReserved` |

---

## 9. 成功标准（Phase 1 结束）

1. 店长可为指定 `storeId` 提交订货单，Admin 可见并确认。  
2. 官网意向可一键转为同一套 `purchase_orders` 并履约。  
3. 出货后总部 `products.stock` 减少，且存在对应 `stock_movements`。  
4. 店长确认收货后订货单关闭。  
5. 飞书原材料仍以多维表为真相；Admin 只读镜像，成品库存须人工确认后才写入 `products.stock`。
