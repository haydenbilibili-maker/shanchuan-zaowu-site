# shipping_rules · 商城运费与包邮规则

## 用途

C 端商城运费 / 包邮门槛 / 限时免邮活动的线上 SSOT。  
`makeOrder`、`getShippingRules`、`getBestCoupon`、`getProductCoupons` 优先读本集合；失败回退代码 defaults。

## Admin 入口

- 菜单：**业务运营 → 交易履约 / 货 · 资产 → 运费与包邮规则**（tab `61`）
- 组件：`admin/src/components/ShippingRulesConfig.vue`

## 字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `ruleId` | string | `shipping_default_v1` | 规则标识 |
| `name` | string | 商城运费规则 | 展示名 |
| `status` | string | `active` | `active` / `inactive` |
| `priority` | number | 100 | 多条时取 priority 最高 |
| `defaultCarrier` | string | 顺丰速运 | 默认承运商 |
| `flatFee` | number | 18 | 未达门槛统一运费（元） |
| `accessoryFreeThreshold` | number | 200 | 饰品包邮门槛（元） |
| `specimenFreeThreshold` | number | 500 | 标本包邮门槛（元） |
| `mixCartStrategy` | string | `specimen_wins` | 混合车：含标本用标本门槛；亦可 `max_threshold` |
| `freeShippingCampaign` | object | `{ enabled:false, label:'限时免费邮寄' }` | 全场免邮开关与文案；可选 `startAt` / `endAt` |

兼容旧字段（写入时会 normalize）：`shippingFee`→`flatFee`，`carrier`→`defaultCarrier`，`thresholds.accessory/specimen`。

## 小程序

- 云函数：`getShippingRules`（get 公开；save 需店长 / `ADMIN_OPS_KEY`）
- 下单：`makeOrder/shipping.js` → `loadFromDb`
- C 端文案：`utils/shippingRulesSync.js` → `config/shipping.js.applyRemoteConfig`

## 索引建议

- `status` + `priority`（desc）
