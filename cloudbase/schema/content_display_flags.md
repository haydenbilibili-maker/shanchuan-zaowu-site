# content_display_flags · 内容展示开关

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序：云函数 `getContentDisplayFlags`（缺配置或异常时 **全部关闭**）
  - `pages/category`：馆藏「标本档案」区
  - `pages/user`：「山海社区」入口
- Admin ERP：「小程序配置 → 内容运营 → 内容展示开关」（`ContentDisplayFlags.vue`，菜单 `62`）

## 控制台步骤

1. 数据库 → 新建集合 → `content_display_flags`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/content_display_flags.json`](../rules/content_display_flags.json)
3. 或：`cd admin && npm run provision:miniapp-ops`

## 字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `name` | string | `内容展示开关` | 配置名称 |
| `status` | string | `active` | `active` \| `inactive` |
| `priority` | number | `10` | 越大越优先（通常仅一条） |
| `showSpecimenArchive` | boolean | `false` | 馆藏页「标本档案」 |
| `showUserCommunity` | boolean | `false` | 我的页「山海社区」 |
| `museumGuideOpen` | boolean | `true` | 博物君展示开关（2026-11-23 并入本页）：关闭后「我的 · 馆藏与内容」不展示入口、首页口播不出声。**与超管工作台「博物君」的开馆 / 闭馆取 AND**（任一关闭即不展示）；缺省 / 未配置按开启 |

## 读端约定

仅当字段 **严格等于** `true` 时展示；缺省 / `false` / 未部署均按关闭处理。

**例外**：`museumGuideOpen` 缺省按**开启**（与超管「开馆」一致）；`getContentDisplayFlags` 会把它与
`museum_guide_config/main.enabled` 取 AND 后再下发，因此超管闭馆时即使本字段为 `true`，C 端也按关闭处理。
