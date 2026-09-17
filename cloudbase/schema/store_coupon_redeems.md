# store_coupon_redeems · 门店券核销流水

> **2026-09-17 全面审计补齐**：本集合此前**没有规则文件、没有 schema、也不在 `COLLECTIONS`** ——
> 属「三处同步」盲区。原因是**只有云函数以常量名引用它**（如 `db.collection(BINDS)`），
> 而此前的字面量扫描（`db.collection('字面量')`）扫不到常量，于是它一直不在任何清单里。
> 全仓系统性重算后共发现 9 个这样的集合，本文件是其中之一。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写（全仓 0 处客户端引用） |
| 云函数（服务端 SDK） | ✅ 读写（服务端 SDK 绕过安全规则） |

规则文件：`cloudbase/rules/store_coupon_redeems.json` = `{ "read": false, "write": false }`

## 写入方（云函数）

- `verifyStoreCoupon`

## 幂等 / 防重

`dedupeKey = store_coupon:${openid}:${clientRequestId}`（客户端带请求号防重复核销）

## 字段

> 以下字段由**代码写入点**推断；新增字段请同时更新本文件。

- `_openid` 核销用户
- `dedupeKey` 幂等键（唯一索引）
- `clientRequestId` 客户端请求号
- `tokenId` / `couponId` 券标识
- `storeId` 门店
- `createTime`
