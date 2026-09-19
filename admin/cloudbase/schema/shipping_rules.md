# shipping_rules · 商城运费与包邮规则

## 用途

C 端商城运费 / 包邮门槛 / 限时免邮活动的线上 SSOT。  
`makeOrder`、`getShippingRules`、`getBestCoupon`、`getProductCoupons` 优先读本集合；失败回退代码 defaults。

⚠️ **这是线上的真源**：只改代码默认值而不同步本集合，代码改动**一点都不会生效**
（云端文档覆盖代码默认值）。一致性由 `npm run check:shipping-rules-sync` 守卫。

## 口径（v2，2026-09-19，蓝图 §19 裁决 40/41/41b/41c）

- **只按商品的「装裱方式」`craftType` 区分** —— 不看标题、不看类别、不做文本猜测。
- **收费类** = `chargedCraftTypes`（默认 `frame` 相框 / `cloche` 方形玻璃罩 /
  `cloche_round` 圆形玻璃罩 / `cloche_cylinder` 圆柱形玻璃罩）：
  订单**全场**满 `freeShippingThreshold`（默认 299）免邮，未满收 `flatFee`（默认 18）**每单一次**。
- **其余一律免邮**：`diorama` / `accessory` / `wing_art` / `magnet` / `other` /
  **以及 `craftType` 为空（未标注）**（裁决 41b：未标注不倒扣，不要求补标）。
- ⚠️「玻璃罩」是**三个不同的 key**（方形 / 圆形 / 圆柱形），只勾一个会漏收运费。

## Admin 入口

- 菜单：**业务运营 → 交易履约 / 货 · 资产 → 运费与包邮规则**（tab `61`）
- 组件：`admin/src/components/ShippingRulesConfig.vue`
- 小程序超管工作台：`curTab 15`（`managerPageConfig.js` / `workspace/_subviews.wxml`）

## 字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `ruleId` | string | `shipping_default_v2` | 规则标识 |
| `name` | string | 商城运费规则 | 展示名 |
| `status` | string | `active` | `active` / `inactive` |
| `priority` | number | 100 | 多条时取 priority 最高 |
| `defaultCarrier` | string | 顺丰速运 | 默认承运商 |
| `flatFee` | number | 18 | 未达门槛运费（元/单，不是每件） |
| `freeShippingThreshold` | number | 299 | **全场**包邮门槛（元）；仅当订单含收费类时有意义 |
| `chargedCraftTypes` | string[] | `['frame','cloche','cloche_round','cloche_cylinder']` | 收费类装裱方式 key 清单；**不允许为空**（空 = 整店免邮，保存侧直接拒绝） |
| `freeShippingCampaign` | object | `{ enabled:false, label:'当前全场免邮' }` | 全场免邮开关与文案；可选 `startAt` / `endAt` |

兼容旧字段（读取时兼容、写入时按新字段落库，并同步为镜像值）：
`shippingFee`→`flatFee`，`carrier`→`defaultCarrier`，`thresholds.accessory/specimen`，
`specimenFreeThreshold`→`freeShippingThreshold`（`accessoryFreeThreshold` 恒写入 0）。
`mixCartStrategy` 是**旧模型遗留**，v2 判定逻辑不再读取它。

## 小程序

- 云函数：`getShippingRules`（get 公开；save 需店长 / `ADMIN_OPS_KEY`）
- 下单：`makeOrder/shipping.js` → `loadFromDb`
- C 端文案：`utils/shippingRulesSync.js` → `config/shipping.js.applyRemoteConfig`

## 索引建议

- `status` + `priority`（desc）
