# 店长 / 店员 / Admin 对齐升级

**日期**：2026-08-21  
**云环境**：`cloud1-8gnkty5bfff9f0bf`　**AppID**：`wxf2550373b010b447`  
**关联**：`docs/财务账本对齐方案.md`、`docs/门店积分上线操作清单.md`

---

## 1. 盘点结论

### 1.1 四端现状

| 端 | 路径 | 数据源 | 核心能力 |
|----|------|--------|----------|
| 店长小程序 | `subpackages/business/manager/`（~3000 行巨页） | 云开发直连 + 云函数 | 账本、订单发货/退款、藏品、内容、门店、看板、定制… |
| 店员小程序 | `subpackages/business/staff/` | 云函数 `grantStorePoints` / `getMemberPass` / `storeCheckIn` | 核销、消费赠分、流水、到店 |
| 门店积分管理 | `subpackages/business/store-points/` | 同上 + `manageStaff` | 流水撤销、规则、店员账号（店长） |
| Admin ERP | `shanchuanzaowu/admin` | **同一云环境** CDN SDK（`orders`/`products`/`finance_records`/`store_ledger`）+ localStorage 账本缓存 | 财务、订单、商品、门店、履约中心等 |

### 1.2 最大不一致（升级前）

1. **财务双集合**：店长写 `daily_revenues`，Admin 读写 `finance_records`/`store_ledger`，互不同步。  
2. **订单写路径分裂**：店长有 `managerShipOrder`，另有直写 `status=shipped` 死代码；Admin 直写集合，**跳过站内信/微信物流**，退款直改 `refunded` **不调微信退款**。  
3. **入口重叠**：店长 Tab「核销」与店员后台重复；「我的」页店长看不到现场工作台。  
4. **积分≠钱**：门店消费金额进 `store_purchases`，易被误当成财务营收。  
5. **manager/index.js 过大**：继续往里加 Tab 风险高（已用 store-points / staff 减负）。

---

## 2. 本次已落地

### 财务 SSOT（第一支柱）

- 云函数 `syncFinanceData`：**已部署**到 `cloud1-8gnkty5bfff9f0bf`
- `store_ledger` 为门店日结 SSOT，镜像 `finance_records`；兼容 `daily_revenues`
- 商城对账字段 `mpOnline` / `mpRefund` / `mpNet`（不计入门店 NET）
- 店长账本接 `utils/storeLedger.js`；「商城对账」按钮

### 权限与入口（P0）

- 店长菜单：现场能力深链到店员工作台（`?tab=`）
- 原 Tab「核销」改为跳转店员后台，不再在巨页堆核销
- 「我的」：店长可见「现场工作台」+「店长后台」；纯店员仍只见店员后台
- 店员页文案明确：赠分不计成长值、不自动入账本

### 订单写路径（P1）

- 店长 `shipOrder` 统一走 `openShipModal` → `managerShipOrder`
- Admin `Orders.vue` 发货改调 `managerShipOrder`；退款改调 `refundOrder`
- `refundOrder/payConfig`：识别 `MESSAGE_ADMIN_OPENIDS`；可选 `ADMIN_OPS_KEY` + `VITE_ADMIN_OPS_KEY` 供 Web 运维退款
- 主包 `utils/orderStatus.js`：状态标签与 GMV 口径常量

### 文档

- `docs/财务账本对齐方案.md`
- 本文档
- Admin `docs/财务数据多端同步说明.md` 指向新方案

---

## 3. SSOT 如何工作

### 3.1 财务

```
店长录入 / Admin 同步
        ↓
  store_ledger (SSOT, storeId|date)
        ↓ 镜像
  finance_records ← Admin 财务页主读
        ↑
  reconcile_online_orders → 仅写 mp*（小程序 GMV）
```

| 指标 | 字段 | 含运费 | 扣退款 |
|------|------|--------|--------|
| 门店营收 | `netAmount` = POS+门店扫码+现金−门店退款 | 门店实收 | 是 |
| 小程序 GMV | `mpOnline` = orders.totalPrice | 是 | 支付日记全额；退款记 `mpRefund` |
| 积分消费额 | `store_purchases.amount` | — | **不是财务** |

### 3.2 订单

| 操作 | 正确写路径 | 禁止 |
|------|------------|------|
| 发货 | 云函数 `managerShipOrder` | 直写 `orders.status=shipped` |
| 退款 | 云函数 `refundOrder`（须 `refunding`/`aftersales`） | 直写 `refunded` 不调微信 |
| 读列表 | 集合 `orders`（两端同源） | — |

状态机：`pending_pay → paid → shipped → received`；售后 `refunding/aftersales → refunded`。

### 3.3 商品/库存

- 集合 `products` 两端同源（Admin CDN + 小程序店长藏品 Tab）
- **库存写回**：支付履约 `fulfillOrder` 扣库存；退款 `refundOrder` 回滚
- Admin 改库存可直写；**暂无自动对账报表**（见「未做」）

#### 藏品录入能力对齐（2026-09-08）

原则：**能力最大**——任一端已有则另一端补齐；行为不一致时统一到更完整一方。

| 能力 | Admin | 店长 | 本轮 |
|------|-------|------|------|
| 多图轮播 / 设封面排序 | ✅ | ✅（已补） | 店长对齐 |
| SKU 规格图 + 强校验 | ✅ | ✅（已补） | 店长对齐 |
| 新建默认 `inArchive/孤品/supportsCustom` | true / stock=1 / false | 已对齐 | 统一到 Admin |
| stock→孤品联动 | ✅ | ✅（已补） | 店长对齐 |
| AI 一键补齐（分类+保护+学名） | ✅ | ✅（已补） | 店长对齐 |
| 档案/营销筛选 + 清过期秒杀 | ✅ | ✅（已补轻量） | 店长对齐 |
| 搜索 / 毛利率 | ✅（已补搜索+毛利列） | ✅ | Admin 补搜索+毛利 |
| 富文本 WYSIWYG | RichHtmlEditor | textarea + 消毒 | 店长仅消毒；编辑器留 Admin |
| 批量调价/调库存/导出/永久删除 | ✅ | ❌ | 刻意留 Admin（运维面） |
| 分类管理 CRUD | Categories 模块 | 店长内嵌 | 两端各有入口 |

---

## 4. 权限矩阵

| 能力 | 店员 staff | 店长 manager | Admin Web |
|------|------------|--------------|-----------|
| 会员码/预约核销 | ✅ | ✅（走店员工作台） | 预约模块可读 |
| 消费赠分 | ✅ | ✅ | ❌ |
| 撤销赠分 / 规则 / 店员账号 | ❌ | ✅ store-points | 员工模块另册 |
| 营收账本读写 | ❌ | ✅ | ✅ finance |
| 订单发货 | ❌ | ✅ managerShipOrder | ✅ 同云函数 |
| 微信退款 | ❌ | ✅ refundOrder | ✅ 需 ops key 或小程序 |
| 藏品/内容/看板 | ❌ | ✅ | ✅ |
| 鉴权来源 | `staff_members` + `MESSAGE_ADMIN_OPENIDS` + `users.isAdmin` | 同左 | CDN 登录；退款建议配 `ADMIN_OPS_KEY` |

写操作一律以云函数 `staffGuard` / `isUserAdmin` 为准，客户端 role 仅 UI。

---

## 5. 未做 / 后续排期

| 项 | 优先级 | 说明 |
|----|--------|------|
| 拆分 `manager/index.js` 为多页 | P1 | 订单/内容/定制独立分包页，降低维护成本 |
| 支付成功实时增量账本 | P2 | 现为手动「商城对账」+ 可选定时器 |
| Admin 财务页展示 `mp*` 列 | P2 | 字段已写入，UI 未加列 |
| 库存对账报表 | P2 | products.stock vs 订单扣减差异告警 |
| Admin 批量发货禁止假单号 | P1 | 仍可生成临时 SF 单号，建议强制手填 |
| `managerShipOrder` 增加店长鉴权 | P1 | 当前任意可调云函数的身份可发货，需补 staffGuard |
| 定时触发器夜间对账 | P2 | `reconcile_online_orders` + `refresh_store_ledger` |

---

## 6. 部署与验数

### 6.1 必部署云函数

| 函数 | 状态 | 环境变量 |
|------|------|----------|
| `syncFinanceData` | **已 CLI 部署** | `MESSAGE_ADMIN_OPENIDS` |
| `refundOrder` | **需重新部署**（payConfig 增强） | `MESSAGE_ADMIN_OPENIDS`，可选 `ADMIN_OPS_KEY` |
| `managerShipOrder` | 确认线上为最新 | — |

Admin 若用 Web 退款：云函数配 `ADMIN_OPS_KEY`，构建注入 `VITE_ADMIN_OPS_KEY`。

### 6.2 集合

确认存在：`store_ledger`、`finance_records`、`finance_settings`、`daily_revenues`、`staff_members`、`store_purchases`、`orders`、`products`。

**已于 2026-08-21 用 `scripts/provision-finance-ledger.cjs` + Admin `.env` 密钥核验**：上述财务四表均已存在；并补建 `date` / `storeId+date` / `_updateTime` 查询索引。积分三表按约定 skip。未改任何既有集合 ACL。未创建未使用的 `ledger_daily`。

### 6.3 验数步骤

1. **角色入口**：店长「我的」见店长后台 + 现场工作台；店员只见店员后台。  
2. **现场深链**：店长看板点「现场核销」→ 店员页 Tab0。  
3. **账本**：店长记一笔 POS → 云库 `store_ledger`/`finance_records` 同日一致 → Admin「从云端下载」可见。  
4. **商城对账**：点「商城对账」→ 出现 mp 行，门店 NET 不变。  
5. **发货**：Admin 或店长发货 → `orders.status=shipped` 且有 `logistics`；顾客收到站内信（若开通）。  
6. **退款**：订单先变 `refunding` → `refundOrder` → `refunded` + 库存回滚；**禁止**只改状态。  
7. **积分**：赠分后账本金额不变、成长值不变。

### 6.4 历史迁移（一次）

```js
// 云函数测试
{ "action": "sync_daily_revenues", "storeId": "store_shanhaizaowu", "limit": 200 }
```
