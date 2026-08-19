# purchase_orders · 正式订货单（门店 / 渠道）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序店长端下单 / 提交 / 收货（主入口：直连本集合，`miniprogram/utils/b2bPurchaseOrder.js`）
- Admin「订货履约」确认与列表
- 官网 `purchase_intents` 一键转正式单

蓝图：`admin/docs/订货履约与成品库存_Phase1_技术蓝图.md`

## 控制台步骤

1. 数据库 → 新建集合 → `purchase_orders`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/purchase_orders.json`](../rules/purchase_orders.json)
3. CLI：`cd admin && node scripts/provision-purchase-orders.mjs`

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `orderNo` | string | 如 `PO20260810001` |
| `source` | string | `store_manager` \| `price_list_convert` \| `admin` |
| `intentId` | string\|null | 来源意向 id |
| `storeId` | string\|null | 小程序 `stores.storeId` |
| `storeName` | string | 门店/买方名称 |
| `buyerType` | string | `own_store` \| `channel` |
| `contactName` / `contactPhone` / `company` | string | 联系人 |
| `shipToAddress` | string? | 收货地址 |
| `note` | string? | 备注 |
| `items` | array | skuId / productId? / name / quantity / unitPrice / priceLabel? |
| `totalAmount` | number\|null | 估算合计 |
| `status` | string | 见状态机 |
| `shipmentIds` | string[] | 出货单 id（P1） |
| `submittedAt` / `confirmedAt` / `shippedAt` / `receivedAt` | number? | 节点时间 |
| `createdAt` / `updatedAt` | number | |
| `createdBy` | string | openid 或 `admin` |

## 状态机（P0）

`draft` → `submitted` → `confirmed`（P1 起进入 shipping/shipped/received）  
可取消：`draft` \| `submitted` → `cancelled`  
意向转单：直接进入 `submitted`（可再确认）

## 推荐索引

| 字段 | 说明 |
|------|------|
| `createdAt` 降序 | 列表 |
| `status` + `createdAt` | 筛选 |
| `storeId` + `createdAt` | 按店 |
| `orderNo` | 单号查询 |
