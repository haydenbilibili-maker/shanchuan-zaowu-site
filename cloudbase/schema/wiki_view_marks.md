# wiki_view_marks · 专题阅读防刷标记

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- 云函数 `wikiViewStats.view` 的防刷标记：同一用户对同一专题 **30 分钟内**重复打开只计一次（滑动窗口，从上次计数时刻起算）。
- 判定方式（单文档原子，不依赖先读后写）：
  1. `where({ _id, lastAt < now − 30min }).update({ lastAt: now })` 命中 → 计数；
  2. 未命中再 `add({ _id })`：首次打开成功 → 计数；文档已存在（窗口内）主键冲突 → 不计。

## 权限：仅云函数可读写

```json
{ "read": false, "write": false }
```

按用户 × 专题记录打开时间，属于用户行为数据，不对客户端开放。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | `<openid>_<wikiId>`（主键冲突即「窗口内已计」） |
| `_openid` | string | 打开者 openid（只取 `getWXContext().OPENID`） |
| `wikiId` | string | 专题 id |
| `lastAt` | number | 最近一次**计数**的毫秒时间戳（窗口内的重复打开不推进） |

## 控制台 / 部署

1. 新建集合 `wiki_view_marks`，权限 → [`../rules/wiki_view_marks.json`](../rules/wiki_view_marks.json)。
2. 只按 `_id` 查，无需额外索引。体量上限 ≈ 用户数 × 专题数（当前 13 个专题），不做清理。

## 维护

窗口长度改动须同步本文件与 `wikiViewStats/viewStatsCore.js` 的 `WINDOW_MS`。
