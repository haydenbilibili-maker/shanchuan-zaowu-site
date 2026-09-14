# deposit_intents / deposit_rules · 售罄孤品定金

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- `deposit_rules`：定金规则单例（doc `key=default`），超管可配。
- `deposit_intents`：买家定金意向与状态机，小程序「想要」页会读自己的记录判断「已登记/已付定金」。

云端读写全部经云函数 `manageDeposit`（`getRules` / `saveRules` / `listIntents` / `openExpired` / `forfeitIntent` / `sweepBalanceDue`）；
ERP 端模块见 `admin/docs/定金管理_Phase1.md`。

## 控制台步骤

1. 新建集合 `deposit_rules`、`deposit_intents`
2. 权限 → 自定义安全规则 → 分别粘贴 [`../rules/deposit_rules.json`](../rules/deposit_rules.json)（`false/false`）与
   [`../rules/deposit_intents.json`](../rules/deposit_intents.json)（仅本人可读、**write:false**）

## 字段

### deposit_rules

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 固定 `default` |
| `enabled` | boolean | 是否启用定金玩法 |
| `depositRatio` | number | 定金比例（0–1，默认 0.1） |
| `balanceWindowDays` | number | 尾款窗口天数（默认 7） |
| `minDepositAmount` / `maxDepositAmount` | number | 定金上下限（元） |
| `depositNonRefundableOnExpire` | boolean | 逾期是否不退定金 |

### deposit_intents

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 买家 |
| `productId` / `productTitle` / `productPrice` | — | 目标商品 |
| `depositAmount` / `balanceAmount` | number | 定金与尾款（分） |
| `status` | string | `intent` \| `pending_pay` \| `deposit_paid` \| `awaiting_balance` \| `settled` \| `forfeited_open` \| `cancelled` |
| `balanceDueAt` | number | 尾款截止时间戳 |
| `forfeitedAt` | number | 逾期开放（没收定金）时间 |
