# feishu_inventory · 飞书库存镜像（只读）

拉取后可人工「应用为 HQ 成品库存」。未映射 SKU 不改 `products.stock`。

| 字段 | 说明 |
|------|------|
| `recordId` | 飞书 record_id |
| `skuName` / `skuId` / `qty` / `unit` | 映射列 |
| `productId` | 匹配到的藏品 _id |
| `raw` / `syncedAt` | |
