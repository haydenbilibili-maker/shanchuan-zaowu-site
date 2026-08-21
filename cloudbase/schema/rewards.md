# rewards · 积分兑换品

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序积分中心：`subpackages/business/points`，兑换云函数 `redeemReward`
- 店长后台：奖品 CRUD
- Admin：「权益与营销 → 积分兑换」

## 控制台步骤

1. 新建集合 `rewards`
2. 权限 → [`../rules/rewards.json`](../rules/rewards.json)

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 名称 |
| `cost` | number | 所需积分 |
| `stock` | number | 库存 |
| `type` | string | `coupon` \| `goods` \| `virtual` |
| `description` | string? | 说明 |
| `image` | string? | 图片 |
| `value` / `minSpend` | number? | 券面值 / 门槛（type=coupon） |
| `isOffShelf` | boolean | 是否下架 |
