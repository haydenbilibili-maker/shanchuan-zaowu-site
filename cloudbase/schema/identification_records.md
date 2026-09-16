# identification_records

> 最小结构说明 stub（审计 P2 / 2026-09-14）。字段以小程序与云函数代码实证为准，可后续加厚。

## 用途

AI 鉴定记录

## 权限

见小程序仓 `database-rules/identification_records.json` 与 Admin `cloudbase/rules/identification_records.json`（若已同步）。写操作优先经云函数 + staffGuard。

## 字段（待补全）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 文档 ID |
| `_openid` | string | 创建者 openid（若适用） |
| `updatedAt` / `_updateTime` | number/date | 更新时间（各集合命名可能不同） |
| `species_info` | object | 识别出的物种信息（`species_name_zh/latin/en`、`taxonomy`、`confidence`、`alternatives` 等） |
| `ai_content` | object | 模型整理内容（习性 / 分布 / 养护等） |
| `species_profile` | object | 百科档案区块 v2（见 `identifySpecimen/speciesProfile.js`） |
| `confidence_level` | string | `high` / `medium` / `low` |
| `is_bookmarked` | boolean | 是否已收进图鉴 |
| `is_shared` | boolean | 是否已公开分享 |
| `secCheck` | object | 内容安全留痕（`{ imageChecked }`） |

### 去重相关（需求 1，2026-09-16 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| `content_hash` | string | 原图字节 sha256，与 `identification_cache.content_hash` 同源。**作为缓存写入失败时的兜底索引** —— 此前只写 `identification_cache`，而那次写入失败是被吞掉的，会导致去重静默失效 |
| `reuse_count` | number | 该记录被「同图复用」的次数（`_.inc`）。同一图多次识别不再新建记录，只累加此值 |
| `last_reused_at` | number | 最近一次复用时间（同图或同物种） |
| `species_dedup_key` | string | **同物种去重键**（需求 1 业务决策 2026-09-16：按同物种去重）。取 `species_name_latin` 学名优先、中文名兜底，归一化小写去多余空白；`is_specimen === false` 或占位名（「未知物种」等）为空串 = 不参与去重 |

**去重语义（2026-09-16 已按业务决策定稿）**：两级去重，命中即**复用既有记录**，
返回的 `record_id` 与首条相同（客户端带 `from_cache=1` 提示「已跳过重复识别」）：

1. **同图**：同一 `_openid` + 同一 `content_hash` → 复用首条
   （`identification_cache` 作为按图指纹直查的快速通道；缓存写入失败时回查记录的 `content_hash` 兜底）
2. **同物种**（决策：同物种去重）：同一 `_openid` + 同一 `species_dedup_key` → 复用该物种首条记录
   - 覆盖「换角度重拍同一件标本」（指纹不同但物种相同）
   - 也覆盖「同物种的另一件」—— 这是该决策的直接后果，**符合业务确认口径**
   - 复用来源在返回体里用 `reuse_reason` 区分（`same_species`；同图路径不带此字段）

## 维护

新增字段时同步：规则文件 ↔ 本 schema ↔ 相关云函数注释。
