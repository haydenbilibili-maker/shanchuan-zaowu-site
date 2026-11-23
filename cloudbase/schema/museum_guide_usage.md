# museum_guide_usage · 博物君每日提问计数

> 2026-11-23 新增（博物君 · AI 馆员，蓝图 `miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md`）。
> 只记「谁哪天问了几次」，用于每日额度；**不存问题与回答内容**。含 openid，登记在 `cloudbase/sensitive-collections.json` 的 `serverOnly`。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ 仅 `askMuseumGuide` 读写 |

规则文件：`cloudbase/rules/museum_guide_usage.json` = `{ "read": false, "write": false }`

## 字段

- `_id` `openid_YYYYMMDD`（北京时间切日）
- `openid` 提问者 openid（不用 `_openid`）
- `day` `YYYYMMDD`
- `count` 当日已计次数（调用模型前 +1；模型失败退回 −1）
- `updatedAt` 服务端时间

## 写入方

- `askMuseumGuide`：每次提问前读 `count` 判额度（默认 30，环境变量 `MUSEUM_GUIDE_DAILY_LIMIT` 可改）；读失败按 0 处理，不挡提问。

## 清理

无业务价值的历史计数可按 `day` 定期删除（暂未接定时任务）。
