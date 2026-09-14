# daily_revenues

> 最小结构说明 stub（审计 P2 / 2026-09-14）。字段以小程序与云函数代码实证为准，可后续加厚。

## 用途

日营收兼容表（与 store_ledger 对齐）

## 权限

见小程序仓 `database-rules/daily_revenues.json` 与 Admin `cloudbase/rules/daily_revenues.json`（若已同步）。写操作优先经云函数 + staffGuard。

## 字段（待补全）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 文档 ID |
| `_openid` | string | 创建者 openid（若适用） |
| `updatedAt` / `_updateTime` | number/date | 更新时间（各集合命名可能不同） |

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ 相关云函数注释。
