# store_ledger_deletions · 店长账本删除审计

> **2026-09-17 全面审计补齐**：本集合此前**没有规则文件、没有 schema、也不在 `COLLECTIONS`** ——
> 属「三处同步」盲区。原因是**只有云函数以常量名引用它**（如 `db.collection(BINDS)`），
> 而此前的字面量扫描（`db.collection('字面量')`）扫不到常量，于是它一直不在任何清单里。
> 全仓系统性重算后共发现 9 个这样的集合，本文件是其中之一。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写（全仓 0 处客户端引用） |
| 云函数（服务端 SDK） | ✅ 读写（服务端 SDK 绕过安全规则） |

规则文件：`cloudbase/rules/store_ledger_deletions.json` = `{ "read": false, "write": false }`

## 写入方（云函数）

- `syncFinanceData`

## 幂等 / 防重

按 `key`（`<归属后 storeId>|<date>`）一条：同店同日再删一次只更新 `deletedAt` / `deletedBy`。

## 语义（2026-09-29 修正）

`syncFinanceData.buildMergedLedgerList` 合并三源时，**只挡 `_updateTime < deletedAt` 的行**（旧缓存回推、其它集合残留）；
删除后重新录入的同日账照常显示。修正前是「有标记即整日隐藏」，删过一次的日期永远录不回来 ——
只因生产环境一直没建本集合（读写报「集合不存在」被吞掉）才没暴露；2026-09-29 建集合前先修正。

## 字段

> 以下字段按 `syncFinanceData.upsertLedgerDeletion` 写入点核对（2026-09-29）；新增字段请同时更新本文件。

- `key` 去重键 `<storeId>|<date>`
- `storeId` 归属后门店（别名已归主店）
- `date` 账本日期 `YYYY-MM-DD`
- `deletedAt` 删除时间（ms）
- `deletedBy` 操作人 openid
- `_createTime` 首次写入时间（ms）
