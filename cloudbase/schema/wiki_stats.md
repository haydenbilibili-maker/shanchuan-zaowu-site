# wiki_stats · 专题档案阅读计数

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 专题档案页（`miniprogram/subpackages/content/collection-detail`）的「N 阅读」真实计数。
- 唯一读写方：云函数 `wikiViewStats`（`view` 记一次阅读并回计数 / `get` 只读计数）。
- 2026-10-01 A 流第 5 轮新增旁路：此前 `getWikiData.get_detail` 的 `stats` 写死 0，页面只能隐藏；
  现有埋点 `user_behaviors.page_view` 只有页面路径、没有专题 id，无法复用（实测 21 条专题页 page_view 全部无 id）。
  `getWikiData` 契约不变，计数单独走本集合。

## 权限：仅云函数可读写

```json
{ "read": false, "write": false }
```

客户端零直读直写；计数只经 `wikiViewStats` 回传，防止客户端直写刷数。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | = 专题 id（`cms_wikis._id`，降级路径为 `curated_collections._id`） |
| `views` | number | 阅读数（同一用户 30 分钟内重复打开只计一次，见 `wiki_view_marks`） |
| `likes` | number | 收藏数。**暂无写入方**（专题页没有收藏入口，现有 `collections` / `likes` 集合里也没有指向专题的记录），恒 0，页面按 0 隐藏 |
| `createTime` | Date | 首次计数时间（serverDate） |
| `updateTime` | Date | 最近一次计数时间（serverDate） |

## 控制台 / 部署

1. 新建集合 `wiki_stats`，权限 → [`../rules/wiki_stats.json`](../rules/wiki_stats.json)（`cd admin && node scripts/apply-database-rules.mjs --only wiki_stats`）。
2. 只按 `_id` 读写，无需额外索引。
3. 部署云函数：`bash miniprogram/scripts/deploy-drifted.sh wikiViewStats`。

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ `wikiViewStats/viewStatsCore.js` 头注。
