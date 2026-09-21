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
| `packagePhotos` | array\<string\> | **选填**（2026-09-21 新增）。发货时店长上传的包装实拍，元素是云存储 fileID（`cloud://…`）。由 `managerShipOrder` 在发货动作里归一化（`orderSummary.pickPackagePhotos`）后写入，并**同时**写入该笔发货私信 `user_messages.photos` —— 顾客在「山海有信」里直接看到。 |

> `packagePhotos` 的三条不变量（守卫 `npm run check:package-photos`）：
> 1. **可选**：没传时**不写这个键**（不是写空数组）——「没传图」与**存量订单**（根本没有该键）在读取侧完全等价；
> 2. 上限 6 张、去重、只收可渲染地址（`cloud://` / `https://`），**丢弃本机临时路径**（`wxfile://`、`http://tmp/…`）；
> 3. 需要超管审批的「敏感发货」走审批流时，图片必须随 `manageApprovals` 的 payload **原样回传**，否则那一支会静默丢图。

## 维护

字段变更同步 `makeOrder` 与 Admin ERP 订单模块。
