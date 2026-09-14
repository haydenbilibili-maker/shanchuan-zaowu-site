# staff_members · 工作台员工与角色

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

小程序侧 `staffGuard.js` 的角色来源（单一事实来源）。ERP 的「员工与权限」页经云函数
`manageStaff` 读写（`action: upsert | remove | list`），**客户端不得直连**。

## 控制台步骤

1. 新建集合 `staff_members`（若尚未创建）
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/staff_members.json`](../rules/staff_members.json)
   （`read/write` 均为 `false`：只有云函数能访问，因为云函数以管理员身份运行、不受安全规则限制）

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `openid` | string | 员工微信 openid（唯一身份键） |
| `name` / `staffNo` | string | 姓名 / 工号 |
| `role` | string | 最高权限角色（兼容旧读法）：`super_admin` \| `manager` \| `staff` \| `specimen_artisan` \| `live_host` \| `investor` |
| `roles` | string[] | 多角色（canonical），与 `role` 合并解析 |
| `permissions` | string[] | 权限点集合；`permissionsExplicit` 为 true 时以本字段为准 |
| `permissionsExplicit` | boolean | 是否显式指定权限（否则按角色默认集 + 桥接补齐） |
| `storeIds` | string[] | 可操作门店范围；超管为空数组=全部门店 |
| `dailyGrantCap` | number | 单日赠分上限（0 表示用默认） |
| `status` | string | `active` \| 其它（停用）；`staffGuard` 只认 `active` |

## 关联

- 规则：[`../rules/staff_members.json`](../rules/staff_members.json)
- 超管白名单：`workspace_acl`（见 [`workspace_acl.md`](./workspace_acl.md)）
- 实现：`miniprogram/cloudfunctions/manageStaff/`（含 `staffGuard.js`）
