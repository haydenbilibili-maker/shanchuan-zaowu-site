# ops_settlement_bills · 工作室账单（**结算唯一权威**）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）
SSOT：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md`（v1.2）§4.5 / §6

## ⚠️ 先读这条：为什么结算状态只有这一个权威

裁决 10 给出货单加了「结算状态」，裁决 11 又要独立账单集合。**若两处都能写结算状态，就是两个账本**，
以后必然出现「出货单说没结、账单说结了」且无法判定谁对。因此：

| 角色 | 说明 |
|---|---|
| **权威** | **本集合**。结算状态只在本集合被写（`manageStudioSettlement` 的 `bill.*`） |
| **派生** | `ops_shipments.settleStatus` / `billId` / `billNo` / `paidMarkedAt` / `settledAt`，由账单状态变更时**单向同步**下来（列表/仪表盘不必连表） |
| **禁止** | `manageStoreShipment` 只**继承**结算字段、**绝不从入参读取**（其 `normalizePayload` 已如此实现，冒烟实测客户端伪造 `settleStatus:'settled'` 会被忽略） |

守卫 `check-settlement-single-ledger` 钉死这条（含注入验证）。

## 用途

门店（付款方）向工作室（收款方）结款。一张账单**汇总该门店多张出货单**，
两步确认：**店长标「已付款」→ 超管「确认收款」**（裁决 12）。

- **写**：`manageStudioSettlement`；建账单/撤回/确认收款/作废**仅超管**；
  `bill.markPaid` 由**店长**操作（且服务端按门店范围二次判定，**失败即拒**）
- **读**：超管 / 店长（店长只看得到与操作本门店账单）
- **客户端不得直连**：规则 `{"read":false,"write":false}`

## 控制台步骤

1. 数据库 → 新建集合 → `ops_settlement_bills`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/ops_settlement_bills.json`](../rules/ops_settlement_bills.json)
3. 云函数 `manageStudioSettlement` 首次调用会自动建集合

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `billNo` | string | `SB{YYYYMMDD}{4位序号}`，如 `SB20260914-0001` |
| `storeId` / `storeName` | string | 账单归属门店（付款方） |
| `periodFrom` / `periodTo` | string | 由纳入单据的 `shipmentDate` 最小/最大值**推导**（不是手填） |
| `shipmentIds` | string[] | 纳入的出货单 id |
| `shipmentCount` / `itemCount` / `totalQty` | number | 冗余汇总 |
| `materialCostCents` / `packagingCostCents` / `laborCostCents` / `totalCents` | number | **分**；`totalCents` = 三分项之和 |
| `totalAmount` | number | **元**（= `totalCents` / 100），与 `ops_shipments.totalAmount` 同单位 |
| `laborRatePct` | number\|null | 生成账单时的单据级费率快照 |
| `status` | `unsettled` \| `paid_pending` \| `settled` \| `void` | 状态机见下 |
| `paidMarkedAt` / `paidMarkedBy` / `paidMarkedByName` / `paidNote` | | 门店标已付款 |
| `settledAt` / `settledBy` / `settledByName` / `settleNote` | | 超管确认收款 |
| `voidedAt` / `voidedBy` / `voidNote` | | 作废 |
| `createdAt` / `createdBy` / `createdByName` / `updatedAt` / `updatedBy` | | 审计 |
| `deleted` | boolean | 软删标记 |

> `statusLabel` **不落库**：展示标签一律由 `mapBill` / `shipmentDefaults.mapRow` 在读取时派生，
> 避免出现第二份真相（本集合与出货单都不写标签字段）。

## 状态机

```
unsettled ──标已付款──► paid_pending ──确认收款──► settled（终态，同时终结其下所有出货单）
    │                        │
    └──作废──► void（终态）   └──撤回到未结──► unsettled
```

- `settled` / `void` 是**终态**，不可再流转
- **确认收款 = 终结**（裁决 13）：账单 `settled` + 其下每张出货单 `settleStatus='settled'` **且** `status='completed'`
- **幂等**：重复「标已付款」/「确认收款」直接短路（`noop`），不重复写、不重复通知
- **不设收款前置条件**（裁决 14，钱可先到），但**待核价的单在预览列表里就置灰不可选**

## 推荐索引

| 字段 | 说明 |
|------|------|
| `storeId` + `status` | 门店账单列表 / 未结查询 |
| `status` + `createdAt` | 待确认收款队列 |
| `billNo` | 单号检索（生成序号时按前缀计数） |
