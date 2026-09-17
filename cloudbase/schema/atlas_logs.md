# atlas_logs · 山海图鉴行为日志

> **2026-09-17 全面审计补齐**：本集合此前**没有规则文件、没有 schema、也不在 `COLLECTIONS`** ——
> 属「三处同步」盲区。原因是**只有云函数以常量名引用它**（如 `db.collection(BINDS)`），
> 而此前的字面量扫描（`db.collection('字面量')`）扫不到常量，于是它一直不在任何清单里。
> 全仓系统性重算后共发现 9 个这样的集合，本文件是其中之一。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写（全仓 0 处客户端引用） |
| 云函数（服务端 SDK） | ✅ 读写（服务端 SDK 绕过安全规则） |

规则文件：`cloudbase/rules/atlas_logs.json` = `{ "read": false, "write": false }`

## 写入方（云函数）

- `manageAtlas`

## 幂等 / 防重

无（追加型日志）

## 字段

> 以下字段由**代码写入点**推断；新增字段请同时更新本文件。

- `_openid`
- `action` 行为
- `specimenId` / `targetId`
- `createTime`
