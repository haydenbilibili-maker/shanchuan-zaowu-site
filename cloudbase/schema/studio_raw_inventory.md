# studio_raw_inventory · 工作室原材料库存

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

多平台进货的原材料库存。飞书「库存管理」同步写入本集合。
成品见 [`studio_inventory.md`](./studio_inventory.md)。

云端：`manageStudioRawInventory` / `getStudioDashboard` / 库存仪表盘聚合。
**客户端不得直连**。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` / `sku` | string | 品名 / SKU |
| `qty` | number | 数量 |
| `platform` / `source` | string | 进货来源平台 |
| `feishuRecordId` | string | 飞书幂等键 |

## 关联

- 规则：[`../rules/studio_raw_inventory.json`](../rules/studio_raw_inventory.json)
