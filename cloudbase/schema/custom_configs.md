# custom_configs · 标本定制选项（框型 / 包装）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序 C 端定制页：`getCustomConfig` 云函数读取 `type=frame|packaging` 且 `status=active`
- 店长后台 Tab10：CRUD（`miniprogram/subpackages/business/manager/index.js`）
- Admin ERP「标本定制工坊 → 定制选项」Tab 同步维护

## 控制台步骤

1. 数据库 → 新建集合 → `custom_configs`
2. 权限 → 自定义安全规则 → 粘贴 [`../rules/custom_configs.json`](../rules/custom_configs.json)

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `configId` | string | 业务 id，如 `frame_wood_classic` |
| `type` | string | `frame` \| `packaging` |
| `name` | string | 展示名 |
| `desc` | string? | 描述 |
| `priceDelta` | number | 加价（元） |
| `theme` | string? | 主题标签（如 `birthday`） |
| `image` | string? | 云存储 fileID |
| `sort` | number | 排序（升序） |
| `status` | string | `active` \| `inactive` |

## 推荐索引

| 字段 | 说明 |
|------|------|
| `type` + `sort` | 定制页加载 |
| `status` + `type` | 过滤启用项 |
