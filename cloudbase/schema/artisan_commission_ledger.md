# artisan_commission_config / artisan_commission_ledger · 装裱师佣金

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- `artisan_commission_config`：提成规则（默认蝶翅画 `wing_art` 10%）。
- `artisan_commission_ledger`：按单佣金台账（入账 + 冲销），订单支付时由 `postForOrder` 写入、退款时由 `reverseForOrder` 冲销。

读写经云函数 `manageArtisanCommission`（`getRule` / `saveRule` / `resetDefaults` / `listLedger` / `getSummary` /
`listArtisans` / `searchProducts`）；ERP 端模块见 `admin/docs/装裱师佣金_Phase1.md`。

## 控制台步骤

1. 新建两个集合
2. 权限 → 自定义安全规则 → 粘贴 `../rules/artisan_commission_config.json`、
   `../rules/artisan_commission_ledger.json`（均 `false/false`）

## 字段

### artisan_commission_config

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `name` | string | 规则名 |
| `rate` | number | 提成比例（0–1） |
| `craftTypes` | string[] | 适用工艺（空=不限） |
| `categoryIds` / `categoryTypes` / `productIds` | string[] | 适用范围 |
| `basisNote` | string | 计费说明（展示用） |

### artisan_commission_ledger

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | `earn` \| `reverse` |
| `status` / `reversed` | string/boolean | 已入账 / 已冲销 |
| `orderId` / `orderNo` / `lineIndex` | — | 来源订单与行 |
| `productId` / `productTitle` / `craftType` | — | 商品 |
| `artisanId` / `artisanName` / `artisanOpenid` | — | 装裱师 |
| `salesAmount` / `rate` / `amount` | number | 销售额 / 比例 / 佣金 |
| `dedupeKey` | string | 防重复入账键 |
| `paidAt` / `createTime` | number | 支付与入账时间 |
| `source` | string | `fulfill` \| 其它内部来源 |
