# refunds · 退款审核单

Admin「退款审核」主数据源。也可由订单 `orders.status ∈ {refunding, refunded, …}` 回流展示。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `orderId` | string | 原订单 `_id` |
| `orderNo` | string | 订单号 |
| `amount` / `refundAmount` | number | 退款金额（元） |
| `reason` | string | 退款原因 |
| `description` | string | 补充说明 |
| `userName` | string | 申请人 |
| `contactPhone` | string | 联系电话 |
| `_openid` | string | 用户 openid |
| `status` | string | `pending` / `approved` / `rejected` / `refunded` |
| `refundNo` | string | 微信退款单号（可选） |
| `refundMock` | boolean | 是否开发态模拟退款 |
| `createTime` | number / Date | 申请时间 |
| `approvedTime` / `rejectTime` / `refundedTime` | number | 节点时间 |
| `source` | string | `refundOrder` / `order_backfill` / `cancelBooking` 等 |

## 写入入口

- 云函数 `refundOrder`：退款成功后 upsert
- Admin 审核操作：批准/拒绝/执行时写入或更新
- `cancelBooking`：预约取消退款（`status=pending`）

## 权限

见 `cloudbase/rules/refunds.json`（匿名可读，便于 Admin Web；写需登录）。
