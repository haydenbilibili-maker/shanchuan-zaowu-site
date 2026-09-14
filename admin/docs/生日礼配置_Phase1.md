# 生日礼配置（ERP · Phase 1）

**目标**：ERP 提供生日礼包的后台配置入口，与小程序超管台「生日礼包」共用一份配置。

## 数据源（小程序侧 SSOT）

| 集合 | 说明 |
|------|------|
| `member_birthday_gift` | 配置单例：`enabled` / `name` / `title` / `messageTitle` / `pointsEnabled` / `points` / `pointsTitle` / `excludeGrowth` / `couponsEnabled` / `expireMode(days\|end_of_month)` / `expireDays` / `stackable` / `coupons[{id,enabled,title,value,minSpend,expireDays,count}]` |

领取链路（C 端）：会员生日当天在小程序领取 → `claimBirthdayGift.process` 发积分与礼券 → 防重 `point_records.dedupeKey = birthday_gift:{openid}:{year}` + `users.birthdayGiftYear`。

## 云函数（`manageBirthdayGift`）

| action | 权限 | 用途 |
|--------|------|------|
| `get` | 超管 | 读配置（缺省返回代码默认 + `fromDefault`） |
| `save` | 超管 | 写配置（礼券档位校验：折扣纪律） |
| `resetDefaults` | 超管 | 载入代码默认值 |

## ERP 模块

- 菜单：客户经营 → 会员洞察 → **生日礼配置**（`App.vue` id `75`）
- 组件：`admin/src/components/BirthdayGiftConfig.vue`
- 能力：启停、文案（礼包名/标题/站内信标题）、积分（数量、不计成长值）、礼券（档位表：面额/门槛/有效天数/张数）、有效期模式、是否可叠加；保存 / 恢复默认。

## 验收

1. ERP 保存后，小程序「生日礼包」页刷新可见相同配置。
2. 开启礼券时必须至少一个档位，否则保存前拦截并提示。
3. 关闭整个礼包后，C 端领取入口提示未开启。
