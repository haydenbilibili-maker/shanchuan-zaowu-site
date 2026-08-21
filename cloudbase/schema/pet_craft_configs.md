# pet_craft_configs · 伴宠工艺配置

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序：`getPetMemorialConfig`（无数据时回退内置默认三项）
- Admin：「伴宠记忆订单 → 工艺配置」Tab

## 控制台步骤

1. 新建集合 `pet_craft_configs`
2. 权限 → [`../rules/pet_craft_configs.json`](../rules/pet_craft_configs.json)

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `craftId` | string | 如 `fluid` / `taxidermy` / `skeletal` |
| `name` | string | 展示名 |
| `desc` | string | 说明 |
| `estimatedWeeks` | string | 周期文案 |
| `sort` | number | 排序 |
| `status` | string | `active` \| `inactive` |
