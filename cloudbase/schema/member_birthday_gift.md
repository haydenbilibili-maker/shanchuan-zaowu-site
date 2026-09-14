# member_birthday_gift · 生日礼配置

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

生日礼包的单例配置：会员生日当天在小程序自助领取，发放积分与礼券。
写入经云函数 `manageBirthdayGift`（`get` / `save` / `resetDefaults`），领取经 `claimBirthdayGift.process`；
ERP 端模块见 `admin/docs/生日礼配置_Phase1.md`。

**防重**：`point_records.dedupeKey = birthday_gift:{openid}:{year}` + `users.birthdayGiftYear`，一年一次。

## 控制台步骤

1. 新建集合 `member_birthday_gift`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/member_birthday_gift.json`](../rules/member_birthday_gift.json)（`false/false`）

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 礼包总开关 |
| `name` / `title` / `messageTitle` | string | 规则名 / 积分流水标题 / 站内信标题 |
| `pointsEnabled` / `points` / `pointsTitle` | — | 是否发积分、数量、流水标题 |
| `excludeGrowth` | boolean | 是否不计成长值（默认 true） |
| `couponsEnabled` | boolean | 是否发礼券 |
| `expireMode` | string | `days`（按天数）\| `end_of_month`（当月月底） |
| `expireDays` | number | `days` 模式下的默认有效天数 |
| `stackable` | boolean | 券是否允许叠加（下单仍只接单张） |
| `coupons` | array | 档位：`{ id, enabled, title, value, minSpend, expireDays, count }` |
| `updatedBy` / `updatedAt` | — | 最近保存人（openid 或 `admin`）与时间 |
