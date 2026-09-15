# ops_shipments · 门店出货单

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

出货 SSOT。`manageStoreShipment` 录入与仪表盘；飞书出货表双向同步。
可与 `ops_purchases` 对照净差额。

**客户端不得直连**。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 出货状态 |
| `sku` / `productName` | string | 品项 |
| `qty` | number | 数量 |
| `storeId` | string | 目标门店 |
| `feishuRecordId` | string | 飞书幂等键 |

## 关联

- 规则：[`../rules/ops_shipments.json`](../rules/ops_shipments.json)
