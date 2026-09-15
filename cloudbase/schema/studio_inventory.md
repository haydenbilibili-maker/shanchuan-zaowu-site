# studio_inventory · 工作室成品库存

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

成品标本台账 / 盘点（已做好的标本成品）。飞书「成品库存」经同步 upsert。
原材料请见 [`studio_raw_inventory.md`](./studio_raw_inventory.md)，勿混入本集合。

云端读写：`manageStudioInventory` / `getStudioDashboard` / `manageStoreShipment`（SKU 搜索）。
**客户端不得直连**（规则 `read/write: false`）。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sku` / `name` | string | SKU / 品名 |
| `qty` / `quantity` | number | 现存数量 |
| `status` | string | 在库态 |
| `feishuRecordId` | string | 飞书记录幂等键 |
| `updatedAt` / `createdAt` | number/Date | 时间戳 |

## 关联

- 规则：[`../rules/studio_inventory.json`](../rules/studio_inventory.json)
- 快照：[`studio_inventory_snapshots.md`](./studio_inventory_snapshots.md)
