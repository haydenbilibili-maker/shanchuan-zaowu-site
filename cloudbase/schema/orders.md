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
| `giftMeta.receiverVerify` | boolean | **选填**（2026-09-28 N3）。送礼人设了礼笺领取核验（受礼人手机号）。**只存布尔**：号码的加盐哈希与尾号在仅云函数可读写的 `gift_receiver_verify`（本集合 `read: auth != null`，不得落手机号）。写入方 `manageGift.setReceiverPhone`；无此键 = 未设核验（含全部历史单，保持现行领取行为）。 |
| `giftMeta.receiverBoundSource` | string | 受礼人绑定来源：`receive_page` / `share_link`（`bindReceiver`）、`phone_verify_account` / `phone_verify_manual`（`verifyReceiver` 核验通过即绑定）、`claim_link`（凭礼笺领取：受礼人主动点「收下」，2026-10-11） |
| `giftMeta.claimMode` | string | **选填**（2026-10-11 凭礼笺领取）。`'link'` = 不填受礼人手机号、凭礼笺链接领取（只限 `invite_address` / `store_pickup`）；打开不绑定，须主动收下，条件写入保证一份一人。设了手机号（`receiverVerify: true`）即以手机号核验为准。写入方 `makeOrder`（带 `gift_claim_link_v1`）、`manageGift.setReceiverPhone`（清号 = 转为凭礼笺领取）。无此键 = 原行为。 |
| `giftMeta.claimPasscode` | boolean | **选填**。凭礼笺领取是否加了 6 位口令。**只存布尔**：口令本身在 `gift_receiver_verify.passcode`（仅云函数可读写，只回给送礼人）。 |
| `giftMeta.claimName` / `giftMeta.claimedByLinkAt` | string / date | 凭礼笺收下时受礼人自填的称呼（≤12 字，选填）与收下时间；送礼人据此看到「谁收下了」。 |
| `giftMeta.claimResetCount` / `giftMeta.claimResetAt` | number / date | 送礼人「作废并换新链接」次数与最近时间（`manageGift.resetShareLink`：换 `shareToken`、解绑原领取人、自提换 `claimCode`）。 |
| `certMeta` | object | **选填**（2026-09-28 N5）。证书首次签发后固化：`issuedAt`（签发时间，首次写入后不变）+ 按版式 `holder` / `gift_holder` / `gift_voucher` 各一项 `{ fileID, sig, openid, savedAt }`（本人那一版证书图）。写入方 `getCareSpecimens.saveCertificate`。存量单无此键 → 签发时间读时推导为最接近的真实签收时间（`receiveTime` → `giftMeta.claimedAt` → `pickupClaimedAt` → `autoReceivedAt`，见 `giftHolder.certIssuedAt`），不迁移。 |
| `packagePhotos` | array\<string\> | **选填**（2026-09-21 新增）。发货时店长上传的包装实拍，元素是云存储 fileID（`cloud://…`）。由 `managerShipOrder` 在发货动作里归一化（`orderSummary.pickPackagePhotos`）后写入，并**同时**写入该笔发货私信 `user_messages.photos` —— 顾客在「山海有信」里直接看到。 |

> `packagePhotos` 的三条不变量（守卫 `npm run check:package-photos`）：
> 1. **可选**：没传时**不写这个键**（不是写空数组）——「没传图」与**存量订单**（根本没有该键）在读取侧完全等价；
> 2. 上限 6 张、去重、只收可渲染地址（`cloud://` / `https://`），**丢弃本机临时路径**（`wxfile://`、`http://tmp/…`）；
> 3. 需要超管审批的「敏感发货」走审批流时，图片必须随 `manageApprovals` 的 payload **原样回传**，否则那一支会静默丢图。

## 维护

字段变更同步 `makeOrder` 与 Admin ERP 订单模块。
