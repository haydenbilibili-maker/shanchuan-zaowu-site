# ops_purchases · 采购单（门店 + 工作室）

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

采购 SSOT。小程序 / ERP `managePurchaseOrder` 读写；飞书「采购记录」按 `feishuRecordId` upsert。
仪表盘见 `managePurchaseOrder` purchaseDashboard / `getStudioDashboard`。

**客户端不得直连**。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 采购状态机 |
| `amount` / `total` | number | 金额 |
| `storeId` / `channel` | string | 门店或渠道 |
| `feishuRecordId` | string | 飞书幂等键 |
| `items` | array | 明细行 |

## 关联

- 规则：[`../rules/ops_purchases.json`](../rules/ops_purchases.json)
- 出货对照：[`ops_shipments.md`](./ops_shipments.md)
