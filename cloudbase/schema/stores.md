# stores · C 端门店主数据

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序「这有店」：云函数 `getStoreConfig` / `manageStoreConfig`
- Admin ERP：「C端门店展区」Tab（`StoreFrontConfig.vue`）
- 订货履约：`storeId` 外键（与 ERP 本地 `storeStorage` 合规档案分离）

## 控制台步骤

1. 新建集合 `stores`
2. 权限 → [`../rules/stores.json`](../rules/stores.json)

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `storeId` | string | 业务主键，如 `store_shanhaizaowu` |
| `name` / `nameEn` | string | 中英文名 |
| `role` / `roleLabel` | string? | 主店 / 工坊等 |
| `phone` / `address` / `floor` | string | 联系与区位 |
| `hours` | object | `{ open, close, note }` |
| `heroTagline` / `intro` | string | 文案 |
| `coverImage` | string | 封面 |
| `features` | string[] | 特色标签 |
| `sort` | number | 排序 |
| `status` | string | `active` \| `inactive` |
