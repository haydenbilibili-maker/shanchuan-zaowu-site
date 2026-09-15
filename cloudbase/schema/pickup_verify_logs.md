# pickup_verify_logs

> 门店自取核销流水（2026-09-15 随「门店自取核销」链路新增）。
> 仅云函数写入（`managerShipOrder.verifyPickup`）；客户端不可写，登录后可读（用于门店工作台对账）。

## 用途

记录每一次「门店自取」核销动作，便于对账、报表与后续冲正；不依赖订单文档历史。

## 写入方

| 场景 | 云函数 | action |
|------|--------|--------|
| 店员 / 店长扫码或手输自取码核销 | `managerShipOrder` | `verifyPickup` |

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `orderId` | string | 订单 `_id` |
| `orderNo` | string | 订单号（展示用） |
| `storeId` | string | 自取门店 id |
| `code` | string | 归一化后的自取码（大写） |
| `staffOpenid` | string | 核销操作人 openid |
| `channel` | string | `scan`（扫码）/ `manual`（手输或重试） |
| `result` | string | `ok`（当前仅记录成功核销） |
| `createTime` | date | 核销时间 |

## 权限

- 客户端：`read: auth != null`、`write: false`（见 `database-rules/pickup_verify_logs.json` 与 `cloudbase/rules/pickup_verify_logs.json`）
- 写入：仅云函数（服务端 SDK 不受安全规则限制）

## 相关

- 规划文档：`docs/门店自取核销规划.md`（小程序仓）
- 订单字段：`orders.pickupCode / pickupStatus / pickupClaimedAt / pickupClaimedByStaff / pickupClaimedChannel`
