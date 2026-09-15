# store_purchases · 门店采购 / 小票关联

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

门店侧采购与小票认领关联数据。`claimStoreReceipt` / `manageApprovals` / `bindPlatformOrder` 等云函数读写。

**客户端不得直连**（与 `store_receipt_claims` 对齐）。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 认领/审批状态 |
| `openid` / `_openid` | string | 关联用户 |
| `amount` | number | 金额 |
| `platform` / `orderNo` | string | 平台单号 |

## 关联

- 规则：[`../rules/store_purchases.json`](../rules/store_purchases.json)
- 小票：[`store_receipt_claims.md`](./store_receipt_claims.md)
