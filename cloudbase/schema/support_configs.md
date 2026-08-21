# support_configs · 客服入口配置

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序：`pages/user/support`，云函数 `getSupportConfig`（取 `status=active` 且 `priority` 最高的一条，`config` 覆盖默认值）
- Admin ERP：「小程序配置 → 客服入口配置」（`SupportConfigs.vue`，菜单 `56`）

## 控制台步骤

1. 数据库 → 新建集合 → `support_configs`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/support_configs.json`](../rules/support_configs.json)
3. 或：`cd admin && npm run provision:miniapp-ops`

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 配置名称 |
| `priority` | number | 越大越优先 |
| `status` | string | `active` \| `inactive` |
| `config` | object | 覆盖云函数默认 |
| `config.phone` | string | 专线电话 |
| `config.hours` | string | 营业时间文案 |
| `config.responseHint` | string | 响应提示 |
| `config.address` | string | 到店地址 |
| `config.latitude` / `longitude` | number | 地图坐标 |
| `config.communityQr` | string | 社群二维码 URL |
| `config.topics` | array | `{ id, label, desc, icon }` |
| `config.faqs` | array | `{ q, a }` |

## 推荐索引

| 字段 | 说明 |
|------|------|
| `status` + `priority` | C 端取生效配置 |
