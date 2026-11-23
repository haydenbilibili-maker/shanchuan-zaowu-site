# museum_guide_logs · 博物君运营日志

> 2026-11-23 新增（超管工作台「博物君」监测，蓝图 `miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md` §6）。
> 每次提问一条，**不记问题与回答原文**；含 openid，登记在 `cloudbase/sensitive-collections.json` 的 `serverOnly`。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ `askMuseumGuide` 写；`museumGuideMonitor` 仅超管只读（聚合） |

规则文件：`cloudbase/rules/museum_guide_logs.json` = `{ "read": false, "write": false }`

## 字段（字段白名单在 `askMuseumGuide/index.js` 的 `buildLog`）

- `openid` 提问者（只用于去重计人数与「单人当天最多几问」，报表不出身份）
- `day` 北京时间 `YYYY-MM-DD`；`created_at` 毫秒时间戳
- `status` `ok` 已回答 / `answer_risky` 回答被内容安全换成固定回复 / `risky` 问题未过内容安全 / `ai_service` 模型或密钥问题 / `quota` 当日额度已满 / `off` 闭馆中 / `invalid` 入参不合法
- `model` 实际回答的模型；`duration_ms` 函数内耗时
- `species` 命中的图鉴物种 `[{ no, zh }]`（≤3）；`actions` 回答推荐的馆内去处 key（≤2）
- `q_len` / `a_len` / `history_len` 问题字数 / 回答字数 / 带的历史条数
- `vote` / `voted_at` 提问的人对这次回答的反馈 `up` 有帮助 / `down` 没帮助（2026-11-23；只认本人、只记一次，经 `askMuseumGuide` 的 `feedback` 动作写入）
- `entry` 入口：`user` 我的 / `atlas` 图鉴页 / `identify` AI 鉴定结果 / `share` 分享 / `direct`

## 写入方

- `askMuseumGuide`：返回前写一条，`Promise.race` 1.5 s 上限、吞错 —— 写不进去也不影响回答。`action: 'status'` 不写。

## 清理

暂未接定时清理；数据量大后可按 `created_at` 保留 180 天（同 `ai_identify_logs`）。
