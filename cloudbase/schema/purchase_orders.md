# purchase_orders · 正式订货单（门店 / 渠道）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 采购商工作台：`source=buyer_workbench`，建单 / 列表 / 支付全部经云函数 `payB2bPurchase`，回调 `b2bPayCallback`
  （**不**经 C 端 `payOrder`/`payCallback`；早期文档里的店长端 `utils/b2bPurchaseOrder.js` 已不存在）
- 供货方工作台：`payB2bPurchase` action `supplierList`（`supplierId` 取自花名册，不信客户端）
- Admin「订货履约」确认与列表；写入经 `manageStoreContent` 代理（仅超管）
- 官网 `purchase_intents` 一键转正式单

## 权限与访问路径（2026-09-28 收紧，修 R1）

规则：`read: doc._openid == auth.openid`，**`write: false`**。**不放行 Web 匿名**（匿名登录对公网任何人开放，2026-09-28 隐私核查实测）。

| 路径 | 读 | 写 |
|------|----|----|
| 小程序采购商（buyer-cart / buyer-orders） | `payB2bPurchase.list`（服务端按 `_openid` 过滤） | `create` / `pay` / `markOfflinePending` / `markPaidPreview`（归属 + 采购类角色校验） |
| 小程序供货方（orders） | `payB2bPurchase.supplierList` | —（运单回传待下一版） |
| ERP 订货履约 / 意向转单 / 出货回写 | `payB2bPurchase.adminList`（`adminOpsKey` → 超管） | `manageStoreContent`（`superAdminOnly`；禁 `remove`/`removeWhere`/`setDoc`；**禁写支付字段**） |
| ERP 确认对公到账 / 微信查单补记 / 微信退款 | — | `payB2bPurchase.adminConfirmOffline` / `adminReconcile` / `adminRefund`（`adminOpsKey` → 超管） |
| 微信支付回调 | — | `b2bPayCallback`（服务端） |

⚠️ 规则须在**新版 ERP（列表走 `adminList`）与小程序新版（改调云函数）都发布后**才能应用，否则线上 ERP 订货履约与旧版小程序建单会失败。线上回滚值见 `cloudbase/rules/README.md`。

蓝图：`admin/docs/订货履约与成品库存_Phase1_技术蓝图.md`

## 控制台步骤

1. 数据库 → 新建集合 → `purchase_orders`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/purchase_orders.json`](../rules/purchase_orders.json)
3. CLI：`cd admin && node scripts/provision-purchase-orders.mjs`

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `orderNo` | string | 如 `PO20260810001` |
| `source` | string | `store_manager` \| `price_list_convert` \| `admin` \| `buyer_workbench`（采购商工作台） |
| `intentId` | string\|null | 来源意向 id |
| `storeId` | string\|null | 小程序 `stores.storeId` |
| `storeName` | string | 门店/买方名称 |
| `buyerType` | string | `own_store` \| `channel` |
| `contactName` / `contactPhone` / `company` | string | 联系人 |
| `shipToAddress` | string? | 收货地址 |
| `note` | string? | 备注 |
| `_openid` / `buyerOpenid` | string? | 采购商台订单归属（`payB2bPurchase.create` 服务端写入；无归属的单小程序端不可支付） |
| `items` | array | skuId / productId? / name / quantity / unitPrice / priceLabel?（采购商台：单价由服务端按 `price_list_items` 计算） |
| `totalAmount` | number\|null | 合计（采购商台 = 服务端定价；`quote_required` 时为 null） |
| `pricingMode` | string? | `fixed`（可在线支付）\| `quote_required`（含区间价/议价，需总部报价） |
| `priceCheckedAt` | number? | 最近一次服务端定价时间 |
| `status` | string | 见状态机 |
| `paymentStatus` | string? | 采购商支付旁路：`unpaid` \| `pending` \| `paid` \| `offline_pending` \| `marked_paid` \| `pay_review`（回调金额不一致，待人工核对）\| `refunded`（C 端 orders 无关） |
| `paymentChannel` | string? | `wechat_jsapi` \| `offline` \| `preview_mark` |
| `payFen` / `payAttempt` / `paidAt` | number? | 应付分（服务端重算）/ 发起次数 / 到账时间 |
| `payOutTradeNo` | string? | 最近一次商户单号（兼容旧字段） |
| `payOutTradeNos` / `payTrades` | string[] / `{outTradeNo,fen,at}[]` | 历次发起的商户单号与当时应付分（最多 20）；回调按此匹配与核额（R5） |
| `transactionId` / `paidOutTradeNo` / `paidFen` / `payCallbackAt` | string / string / number / number | 回调确认到账的微信交易号、商户单号、实收分、时间 |
| `payAnomaly` / `payDuplicate` | object? | 金额不一致 / 已付单重复到账的取证记录 |
| `refund` / `refundedAt` | object? / number? | `{status: refunding\|refunded\|failed, outRefundNo, outTradeNo, fen, reason, requestedBy, refundedBy…}` |
| `offlineConfirmedBy` / `reconciledBy` | string? | 超管操作人（确认对公 / 查单补记） |
| `party` | string? | 供货方真数据隔离：`supplier_fulfillment` = 总部→第三方供货；缺省/其他 = 买方→总部（含 `buyer_workbench`） |
| `supplierId` | string? | 供货方绑定 id（`staff_members.supplierId` 或 openid）；仅 `party=supplier_fulfillment` 使用 |
| `expectedShipBy` | string? | 期望交期文案（供货方列表展示） |
| `logisticsCarrier` / `logisticsTracking` | string? | 供货方回传运单（写回待下一版） |
| `shipmentIds` | string[] | 出货单 id（P1） |
| `submittedAt` / `confirmedAt` / `shippedAt` / `receivedAt` | number? | 节点时间 |
| `createdAt` / `updatedAt` | number | |
| `createdBy` | string | `buyer_workbench` 或 `admin` |

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
| `_openid` + `source` + `createdAt` 降序 | 采购商「我的采购单」（`payB2bPurchase.list`；缺索引时云函数降级为客户端排序） |
| `payOutTradeNos` | 支付回调按商户单号定位 |
| `party` + `supplierId` + `status` | 供货方需求列表 |
