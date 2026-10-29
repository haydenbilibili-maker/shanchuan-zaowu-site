# user_coupons

> 最小结构说明 stub（审计 P2 / 2026-09-14）。字段以小程序与云函数代码实证为准，可后续加厚。

## 用途

用户券实例

## 权限

见小程序仓 `database-rules/user_coupons.json` 与 Admin `cloudbase/rules/user_coupons.json`（若已同步）。写操作优先经云函数 + staffGuard。

## 字段（待补全）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 文档 ID |
| `_openid` | string | 创建者 openid（若适用） |
| `updatedAt` / `_updateTime` | number/date | 更新时间（各集合命名可能不同） |

## 由券模板（`coupons` 集合）派生的字段

`coupons` 暂无独立 schema 文档，模板字段在此一并记录（写入方：ERP 营销中心 → `secureDataWrite`；读方：`receiveCoupon` / `getProductCoupons`）。

| 模板字段 | 类型 | 说明 |
|------|------|------|
| `name` / `type` / `value` / `minSpend` / `condition` | string / `cash`\|`discount` / number / number / string | 折扣券 `value` 按 ERP 写法 8 = 八折（`couponDiscountMultiplier`），不得低于 7.5 折 |
| `limitPerUser` | number | 每人限领；`unused` / `available` / `locked` / `used` 都算已领（2026-10-29 起含 `locked`） |
| `channel` | `online`\|`store`\|`all` | 缺省 `all` |
| `active` | boolean | 关掉即不在可领列表、也领不到 |
| `totalStock` / `receivedCount` | number | 设了才限量 |
| `expireDays` | number | 领取后 N 天到期；`0` / 缺省 = 不按天数 |
| `expireTime` | Date | **旧字段**：没有 `expireDays` 时用户券到期取它（行为不变） |
| `startTime` / `endTime` | Date（2026-10-29 新增到 ERP 表单） | 领取时间窗；未设 = 不限。存绝对时刻，ERP 以北京时间墙钟换算 |
| `fixedExpireTime` | Date（2026-10-29 新增） | 固定到期日：领到的券统一在此刻失效；与 `expireDays` 并存取较早者；过了此刻拒领 |
| `campaignKey` | string（可选） | 活动标识，脚本建模板时防重复写入（如 `double11_2026`） |

用户券（本集合）对应写入：`expireTime`（按上表算出）、`type` / `value` / `minSpend` / `channel` / `stackable`（模板热读）。
带 `fixedExpireTime` 且 `limitPerUser = 1` 的模板，用户券 `_id` 为 `cw_<couponId>_<openid>`（并发双击只落一条）。

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ 相关云函数注释。
