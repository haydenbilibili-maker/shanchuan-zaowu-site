# store_zones · C 端展区 / 动线

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 小程序门店分区展示：`getStoreConfig` / `manageStoreConfig`
- Admin：「C端门店展区 → 展区/动线」

## 控制台步骤

1. 新建集合 `store_zones`
2. 权限 → [`../rules/store_zones.json`](../rules/store_zones.json)

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `zoneId` | string | 业务 id，如 `zone_insect` |
| `storeId` | string | 所属门店 |
| `title` / `overline` | string | 标题 |
| `desc` / `longDesc` | string | 描述 |
| `categoryTag` | string | 品类标签 |
| `coverImage` / `images` | string / string[] | 图片 |
| `relatedProductIds` / `relatedWikiIds` | string[]? | 关联 |
| `sort` | number | 排序 |
| `status` | string | `active` \| `inactive` |
