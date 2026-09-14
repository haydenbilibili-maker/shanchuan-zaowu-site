# workspace_acl · 超管白名单

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

存放可配置的**超管 openid 白名单**。`staffGuard.js` 解析角色时按此顺序判定：
硬编码超管 openid ∪ 本集合 `super_admins.openids` → `staff_members` → `users.isAdmin` → 环境变量
`MESSAGE_ADMIN_OPENIDS`。ERP「员工与权限」页经云函数 `manageStaff`
（`getWorkspaceAcl` / `saveWorkspaceAcl`）读写，**客户端不得直连**。

## 控制台步骤

1. 新建集合 `workspace_acl`（若尚未创建）
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/workspace_acl.json`](../rules/workspace_acl.json)
   （`read/write` 均为 `false`）
3. 新建文档 `_id = super_admins`，字段 `openids: []`

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 固定为 `super_admins` |
| `openids` | string[] | 超管 openid 列表；硬编码白名单不可通过本集合删除 |

## 关联

- 规则：[`../rules/workspace_acl.json`](../rules/workspace_acl.json)
- 员工与角色：`staff_members`（见 [`staff_members.md`](./staff_members.md)）
