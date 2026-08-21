# care_guides · 标本养护指南

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序 C 端：`pages/care/*`，云函数 `getCareGuides`
- 店长后台：养护内容 Tab（`manager/index.js`）
- Admin ERP：「小程序配置 → 养护指南」（`CareGuides.vue`）

## 控制台步骤

1. 数据库 → 新建集合 → `care_guides`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/care_guides.json`](../rules/care_guides.json)

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `guideId` | string | 业务 id，如 `care_insecta_v1` |
| `category` | string | `GENERAL` / `INSECTA` / `PLANTAE` / `MARINE` / `MINERALS` / `FRAMING` |
| `title` | string | 标题 |
| `overline` | string | 副标题 |
| `summary` | string | 摘要 |
| `disclaimer` | string? | 免责声明 |
| `sections` | array | `{ key, title, body, tips[] }` |
| `framingAddons` | array? | 装裱附加说明 |
| `status` | string | `active` \| `inactive` |
| `version` | number | 版本号 |

## 推荐索引

| 字段 | 说明 |
|------|------|
| `category` + `status` | C 端按品类加载 |
| `guideId` | 精确查询 |
