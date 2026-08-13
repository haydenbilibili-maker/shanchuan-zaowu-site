# feishu_purchases · 飞书采购镜像（只读）

从「标本工作室采购库存管理系统」采购表拉取。Admin 不回写飞书采购。

| 字段 | 说明 |
|------|------|
| `recordId` | 飞书 record_id |
| `orderNo` / `skuName` / `skuId` / `qty` / `supplier` / `status` / `date` | 映射列 |
| `raw` | 原始 fields（排错） |
| `syncedAt` | number |
