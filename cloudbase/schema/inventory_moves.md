# inventory_moves · 出入库流水（库存唯一事实）

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

2026-11-27 产品负责人拍板「库存以出入库流水为准」。每一次库存变化写一条流水；
成品台账 [`studio_inventory`](./studio_inventory.md) 与原材料台账 [`studio_raw_inventory`](./studio_raw_inventory.md)
只是流水的累加结果（原子 `_.inc`，不再整表覆盖）。

写入方（全部经共享模块 `inventoryMoves.js`，副本逐字节一致，`check:shared-modules` 守卫）：

| 来源 | 云函数 | 流水 |
|------|--------|------|
| 粘贴盘点 / 飞书成品库存同步 | `manageStudioInventory` | `count`（观测值 − 台账） |
| 唯一件登记 / 手工调整 | `manageStudioInventory` | `in` / `adjust` |
| 原材料手工改数 / 飞书原材料同步 | `manageStudioRawInventory` | `count` |
| 采购单 → 已入库 | `managePurchaseOrder` | 原材料 `in` |
| 出货单 → 已发货 | `manageStoreShipment` | 成品 `out`（唯一件按 `serialNo`） |
| 已发出的出货单取消 | `manageStoreShipment` | 成品 `return` |

**客户端不得直连**（规则 `read/write: false`）；查看经 `manageStudioInventory` 的 `listMoves`。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | `mv_` + sha1(idemKey)：**幂等键**，同一单据同一行只记一次 |
| `ledger` | string | `finished`（成品）/ `raw`（原材料） |
| `type` | string | `opening` 开账 / `in` / `out` / `return` / `count` / `adjust` |
| `delta` | number | 有符号数量变化 |
| `before` / `after` | number | 作用前后台账数量（记录时点） |
| `itemName` / `spec` / `serialNo` | string | 品项；唯一件带 `serialNo` |
| `ledgerId` | string | 作用到的台账行 `_id` |
| `refType` / `refId` / `refNo` | string | 关联单据：`purchase` / `shipment` / `snapshot` / `feishu` / `manual` |
| `operator` / `note` | string | 操作人 / 原因 |
| `applied` | boolean | 台账是否已 inc（false = 写了流水但台账未更新，`verifyLedger` 可查） |
| `createdAt` | number | 毫秒时间戳 |

## 关联

- 规则：[`../rules/inventory_moves.json`](../rules/inventory_moves.json)
- 业务摸底与方案：`miniprogram/docs/业务模块摸底_出货SKU库存采购_2026-11-27.md`
