# fulfillment_shipments · 总部→门店/渠道出货单

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

- 从已确认 `purchase_orders` 生成出货单
- 发货时扣减总部 `products.stock` 并写 `stock_movements`
- 与 C 端 `orders.logistics` 分离

蓝图：`admin/docs/订货履约与成品库存_Phase1_技术蓝图.md`

## 控制台

1. 新建集合 `fulfillment_shipments`
2. 规则见 [`../rules/fulfillment_shipments.json`](../rules/fulfillment_shipments.json)
3. CLI：`cd admin && node scripts/provision-fulfillment-p1.mjs`

## 字段

| 字段 | 说明 |
|------|------|
| `shipmentNo` | `SHYYYYMMDD###` |
| `purchaseOrderId` / `orderNo` | 关联订货单 |
| `storeId` / `storeName` | 门店 |
| `items[]` | skuId / productId / name / quantity |
| `status` | `pending` \| `shipped` \| `delivered` \| `cancelled` |
| `logistics` | carrier / trackingNumber / shipTime |
| `stockDeducted` | 是否已扣 HQ 库存 |
| `createdAt` / `updatedAt` / `createdBy` | |
