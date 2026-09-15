# studio_inventory_snapshots · 成品库存盘点快照

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

`manageStudioInventory` 盘点/对账时写入的历史快照，便于回溯数量变化。

**客户端不得直连**（`read/write: false`）。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `snapshotAt` | number | 快照时间 |
| `items` / `rows` | array | 当时库存摘要 |
| `source` | string | 触发来源（手动/同步） |
| `operatorOpenid` | string | 操作人（若有） |

## 关联

- 规则：[`../rules/studio_inventory_snapshots.json`](../rules/studio_inventory_snapshots.json)
- 主表：[`studio_inventory.md`](./studio_inventory.md)
