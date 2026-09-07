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

## 读端约定

仅当字段 **严格等于** `true` 时展示；缺省 / `false` / 未部署均按关闭处理。
