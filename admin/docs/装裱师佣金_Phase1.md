# 装裱师佣金（ERP · Phase 1）

**目标**：把小程序按单提成（含冲销）的完整台账搬到 ERP，供总部对账与抽查。

## 数据源（小程序侧 SSOT）

| 集合 | 说明 |
|------|------|
| `artisan_commission_config` | 规则：`enabled` / `name` / `rate`(0–1) / `craftTypes[]` / `categoryIds[]` / `productIds[]` / `basisNote` |
| `artisan_commission_ledger` | 台账：`type(earn\|reverse)` / `status` / `reversed` / `orderId` / `orderNo` / `productTitle` / `artisanId` / `artisanName` / `salesAmount` / `rate` / `amount` / `dedupeKey` |

## 云函数（`manageArtisanCommission`）

| action | 权限 | 用途 |
|--------|------|------|
| `getRule` / `saveRule` / `resetDefaults` | 超管 | 规则读写 |
| `getSummary` | 超管 / 本人 | 佣金汇总 |
| `listLedger` | 超管 / 本人 | 台账分页（`type` / `from` / `to`） |
| `postForOrder` / `reverseForOrder` | 内部 | 支付入账 / 退款冲销（履约链路自动调用） |

## ERP 模块

- 菜单：组织治理 → 人才组织 → **装裱师佣金**（`App.vue` id `74`）
- 组件：`admin/src/components/ArtisanCommission.vue`
- 能力：规则编辑（比例、适用工艺、计费说明）＋ 汇总 KPI（累计/已入账/已冲销/条数）＋ 台账明细分页与类型筛选。

## 口径说明

- `amount` 由 `salesAmount × rate` 得出，保留两位（`round2`），单位与订单销售额一致（元）。
- 同一订单行有 `dedupeKey` 防重复入账；退款按 `reversed=true` 冲销而非删除，便于审计。
