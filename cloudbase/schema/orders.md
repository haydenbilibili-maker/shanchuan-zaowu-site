# orders · 交易订单

> 加厚于审计跟进 2026-09-14。写权限：客户端 `write: false`，经 `makeOrder` / `payOrder` / `confirmPayment` / `payCallback` / `refundOrder` / `managerShipOrder` 等云函数。

## 用途

C 端下单、支付、履约、退款的主订单集合。

## 权限

见 `database-rules/orders.json`：`read: auth != null`，`write: false`。

## 核心字段（代码实证）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 订单 ID |
| `_openid` | string | 下单用户 |
| `orderNo` | string | 业务单号 `ORD…` |
| `status` | string | `pending_pay` / `paid` / `shipped` / `received` / `refunding` / `refunded` / … |
| `products` | array | 行项目快照（含价格、数量、SKU） |
| `totalPrice` / `goodsPrice` / `shippingFee` | number | 金额 |
| `address` | object | 收货地址（礼赠/自提场景可能缺省） |
| `storeId` | string | 门店（自提等） |
| `fulfillmentType` | string | `express` / `store_pickup` / `gift_invite` |
| `source` | string | `cart` / `gift` / `custom` |
| `giftMeta` / `customMeta` | object | 礼赠 / 定制扩展 |
| `couponId` / `couponValue` | string/number | 用券 |
| `createTime` / `payExpireTime` | date | 创建与支付超时 |
| `refundPolicy` | object | 退款策略快照 |

## 维护

字段变更同步 `makeOrder` 与 Admin ERP 订单模块。
