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
| `title` / `time` / `people` / `price` | string/number | 预约标题、时间、人数、价格（活动报名时由 `createBooking` 按活动文档回填） |
| `activityId` | string | **可选（2026-09-28 起）**：活动/课程报名关联的 `activities._id`；历史预约没有此字段，统计时回退「`title` + `date`」匹配（读时兼容，不迁移） |
| `seatHeld` | number | **可选**：报名时从 `activities.remain` 原子扣减的名额数（不限名额的活动为 0） |
| `seatReleased` | boolean | **可选**：`cancelBooking` 已把 `seatHeld` 归还给活动（`confirmed → cancelled` 条件更新只生效一次，重复取消不重复归还） |

## 维护

店员核销走 `verifyBooking` + staffGuard，勿客户端改 `status`。
