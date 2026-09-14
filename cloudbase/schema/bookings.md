# bookings · 门店预约

> 加厚于审计跟进 2026-09-14。写：客户端禁写（规则收紧后），经 `createBooking` / `verifyBooking` / `cancelBooking` / `updateBooking`。

## 用途

到店参观、活动预约与核销。

## 权限

见 `database-rules/bookings.json`。

## 核心字段（代码实证）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 预约 ID |
| `_openid` | string | 预约人 |
| `type` | string | 如 `museum_visit` |
| `status` | string | `confirmed` / `used` / `cancelled` / … |
| `date` / `slot` | string | 预约日与时段 |
| `storeId` | string | 门店 |
| `visitorName` / `phone` | string | 联系人 |
| `verifyCode` | string | 核销码 |
| `createTime` | date | 创建时间 |
| `usedAt` | date | 核销时间 |

## 维护

店员核销走 `verifyBooking` + staffGuard，勿客户端改 `status`。
