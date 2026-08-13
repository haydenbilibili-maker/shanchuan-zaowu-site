# stock_movements · 总部成品库存流水

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

- 记录总部仓（`warehouseId=hq`）成品出入库
- 只追加、不删改；余额以写时 `balanceAfter` 为准
- **不含**飞书原材料

## 字段

| 字段 | 说明 |
|------|------|
| `warehouseId` | 固定 `hq` |
| `productId` / `skuId` / `skuName` | 商品 |
| `delta` | 变动量（出货为负） |
| `balanceAfter` | 变动后库存 |
| `type` | `outbound_ship` \| `inbound_manual` \| `adjust` \| `return_in` |
| `refType` | `fulfillment_shipment` \| `purchase_order` \| `manual` |
| `refId` | 关联单据 |
| `note` / `operator` / `createdAt` | |

## 规则

见 [`../rules/stock_movements.json`](../rules/stock_movements.json)
