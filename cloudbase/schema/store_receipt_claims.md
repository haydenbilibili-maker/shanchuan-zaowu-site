# store_receipt_claims · 门店小票积分认领

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

用户提交门店小票认领积分；`claimStoreReceipt` 写入，店长审批经 `manageApprovals`。

**客户端不得直连**（`read/write: false`）。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 申请人 |
| `status` | string | pending / approved / rejected |
| `amount` / `points` | number | 金额或积分 |
| `images` | string[] | 小票图 |
| `reviewedBy` / `reviewedAt` | — | 审批信息 |

## 关联

- 规则：[`../rules/store_receipt_claims.json`](../rules/store_receipt_claims.json)
