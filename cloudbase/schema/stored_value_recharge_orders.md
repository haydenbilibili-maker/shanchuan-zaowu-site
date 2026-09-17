# stored_value_recharge_orders · 储值充值订单

> **2026-09-17 全面审计补齐**：本集合此前**没有规则文件、没有 schema、也不在 `COLLECTIONS`** ——
> 属「三处同步」盲区。原因是**只有云函数以常量名引用它**（如 `db.collection(BINDS)`），
> 而此前的字面量扫描（`db.collection('字面量')`）扫不到常量，于是它一直不在任何清单里。
> 全仓系统性重算后共发现 9 个这样的集合，本文件是其中之一。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写（全仓 0 处客户端引用） |
| 云函数（服务端 SDK） | ✅ 读写（服务端 SDK 绕过安全规则） |

规则文件：`cloudbase/rules/stored_value_recharge_orders.json` = `{ "read": false, "write": false }`

## 写入方（云函数）

- `manageStoredValue`
- `payCallback`

## 幂等 / 防重

以支付单号为准（回调幂等）

## 字段

> 以下字段由**代码写入点**推断；新增字段请同时更新本文件。

- `_openid`
- `_id` 充值单 id（ERP 对账时粘贴）
- `amount`
- `status`
- `outTradeNo` / `transactionId`
- `createTime` / `paidAt`
