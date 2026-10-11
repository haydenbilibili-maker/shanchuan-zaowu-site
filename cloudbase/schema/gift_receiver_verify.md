# gift_receiver_verify · 礼笺领取核验（受礼人手机号）

> 2026-09-28 产品负责人点名（N3），蓝图 `miniprogram/docs/礼赠_证书与养护闭环_2026-09-28.md` §8。
> 送礼人为礼赠预留「受礼人手机号」；受礼人打开礼笺要领取 / 绑定时须核验通过才成为持有人。

## 为什么是独立集合

`orders` 的规则是 `read: auth != null`（任何登录用户都能读任意订单文档），
所以手机号明文、以及可被暴力还原的无盐哈希都**不得**写进 `orders`。
订单上只留布尔标记 `giftMeta.receiverVerify`（见 `cloudbase/schema/orders.md`）。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ 读写（仅 `manageGift`） |

规则文件：`cloudbase/rules/gift_receiver_verify.json` = `{ "read": false, "write": false }`

## 写入方（云函数）

- `manageGift`：`setReceiverPhone`（送礼人设置 / 修改 / 清除，TA 领取前）、`verifyReceiver`（受礼人核验：记失败次数 / 记通过者）

## 幂等 / 防重

- 文档 `_id` = 订单 `_id`，一单一份；重设号码会重置盐、失败记录与通过者。
- 限次：每人每单每小时 5 次失败、每单每小时 20 次失败（多账号轮试），超出返回 `VERIFY_LOCKED`。

## 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` / `orderId` | string | 礼赠订单 ID |
| `giverOpenid` | string | 设置人（送礼人） |
| `salt` | string | 每份随机盐（16 字节 hex） |
| `phoneHash` | string | `sha256(salt + ':' + 11 位手机号)`；空串 = 已清除核验 |
| `phoneTail` | string | 尾号 4 位，**只回给送礼人**展示 |
| `attempts` | array<{o, t}> | 近 1 小时核验失败记录（`o` 核验者 openid，`t` 毫秒时间戳），最多保留 50 条 |
| `verifiedOpenid` / `verifiedAt` / `verifyMethod` | string / date / string | 核验通过者、时间、方式（`account` 微信授权手机号 / `manual` 手动输入 / `passcode` 领取口令） |
| `updatedAt` | date | 最近设置时间 |
| `passcode` | string | **凭礼笺领取的 6 位口令**（2026-10-11，选填）。只回给送礼人；受礼人比对通过只记 `verifiedOpenid`（`verifyMethod: 'passcode'`），**不等于收下**。凭礼笺领取的单 `salt` / `phoneHash` / `phoneTail` 为空串；作废换链接时重写本文档（新口令、清空通过者与失败记录）。 |

**不存**手机号明文；失败响应只含「不一致 + 剩余次数」，不回任何号码片段。
