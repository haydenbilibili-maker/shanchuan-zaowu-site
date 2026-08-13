# feishu_sync_logs · 飞书多维表同步审计

## 用途

`syncFeishuBitable` 每次 inspect / pull / push / apply 写一条。

## 字段

| 字段 | 说明 |
|------|------|
| `action` | inspect / pullPurchases / pullInventory / pushShipments / applyInventory |
| `ok` | boolean |
| `message` | 摘要 |
| `stats` | { pulled, upserted, skipped, pushed, applied } |
| `createdAt` | number |
