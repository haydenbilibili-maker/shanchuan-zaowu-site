# 内容工厂 · CloudBase 集合（蓝图 §4）

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 控制台建表步骤

1. [云开发控制台](https://console.cloud.tencent.com/tcb) → 数据库 → **新建集合**（名称须完全一致）
2. 各集合 → **权限设置** → 自定义 → 粘贴 `cloudbase/rules/content_<name>.json`
3. ERP 使用匿名登录（`signInAnonymously`），规则为 `auth != null` 即可读写

| 集合名 | 规则文件 | 用途 |
|--------|----------|------|
| `content_topics` | `content_topics.json` | 选题库 |
| `content_assets` | `content_assets.json` | 母素材库 |
| `content_pieces` | `content_pieces.json` | 成品工单 / 看板状态 |
| `content_reviews` | `content_reviews.json` | 人工终审审计 |
| `content_analytics` | `content_analytics.json` | 复盘飞轮 |

公共字段（写入时由 `contentDb.js` 自动补全）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 由 CloudBase 登录态自动写入（客户端勿手动 set） |
| `createdAt` | number | 创建时间戳 ms |
| `updatedAt` | number | 更新时间戳 ms |
| `_createTime` | number | 与 `createdAt` 对齐，兼容其它模块 |

---

## content_topics（选题库）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 选题标题 |
| `ip` | string | `GRAVITY` \| `LIGHTNESS` |
| `platform` | string | `xhs` \| `douyin` \| `shipinhao` \| `bilibili` |
| `category` | string | 标本 \| 首饰 \| 器物 \| 内容 \| 香气 \| 礼盒 |
| `angle` | string | 非主体叙事角度 |
| `hook` | string | 钩子一句话 |
| `rationale` | string | AI/数据依据 |
| `source` | string | `agent` \| `human` \| `flywheel` |
| `status` | string | `candidate` \| `picked` \| `archived` |
| `score` | number | 0–100 |

## content_assets（母素材库）

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | `video` \| `photo` |
| `title` | string | 标题 |
| `desc` | string | 客观描述（供改写 Agent） |
| `fileRefs` | array | 云存储路径或 CDN URL |
| `specimenRef` | string | 藏品档案 id（可空） |
| `shootDate` | string/number | 拍摄日期 |
| `ipTags` | array | 如 `["GRAVITY"]` |
| `reusableClips` | number | 可复用切片数 |

## content_pieces（成品工单）

| 字段 | 类型 | 说明 |
|------|------|------|
| `topicId` | string | ref content_topics |
| `assetId` | string | ref content_assets（可空） |
| `ip` | string | GRAVITY \| LIGHTNESS |
| `platform` | string | 平台 |
| `title` | string | 标题 |
| `body` | string | 正文/脚本 |
| `tags` | array | 话题标签 |
| `coverCopy` | string | 封面文案 |
| `clipSuggestions` | array | 切片建议 |
| `compliance` | object | `{ passed, violations[], checkedBy, checkedAt }` |
| `state` | string | topic→drafting→review→approved→scheduled→published→archived |
| `publishMeta` | object | `{ publishedAt, externalUrl }` |
| `metrics` | object | views、完播率、收藏等 |
| `agentMeta` | object | model、provider、tokens |
| `stateHistory` | array | 状态变更记录（可选） |

## content_reviews（终审日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| `pieceId` | string | ref content_pieces |
| `reviewer` | string | 审核人 openid |
| `decision` | string | `approve` \| `reject` \| `rewrite` |
| `constitutionCheck` | object | `{ passed, notes }` |
| `comment` | string | 备注 |
| `reviewedAt` | number | 审核时间戳 |

## content_analytics（复盘）

| 字段 | 类型 | 说明 |
|------|------|------|
| `period` | string | 如 `2026-W27` |
| `inputMetricsSummary` | object | 输入指标摘要 |
| `insights` | array | 洞察 |
| `nextTopics` | array | 回灌选题候选 |
| `stopList` | array | 停做清单 |
| `generatedBy` | string | 如 `复盘Agent` |
