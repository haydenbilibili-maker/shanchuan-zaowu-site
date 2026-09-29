# ai_identify_logs · AI 鉴定调用日志

> 2026-09-29 新增（超管「AI 鉴定监测」，蓝图 `miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md`）。
> 每次 AI 鉴定调用一条（含失败与复用），**含用户照片 fileID = 敏感**，登记在 `cloudbase/sensitive-collections.json` 的 `serverOnly`。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ `identifySpecimen` 旁路写入；`aiIdentifyMonitor` 仅超管只读（查看先写 `admin_operation_logs`） |

规则文件：`cloudbase/rules/ai_identify_logs.json` = `{ "read": false, "write": false }`

## 写入方

- `identifySpecimen`（`identifyLog.js`）：鉴定调用返回前写入；写失败 / 超 1.5 s 不影响鉴定出参
- `miniprogram/scripts/backfill-ai-identify-logs.mjs`：一次性把 `identification_records` 历史写入（`_id = hist_<record_id>`，`source:'history'`，可重复执行）

## 字段

- `openid` 调用者 openid（不用 `_openid`）
- `image_file_id` 本次照片云存储 fileID（`identify/` 前缀；复用命中时也是本次这张）
- `status` `success` 新识别 / `reused` 同图或同物种复用 / `failed`
- `success` 与鉴定出参 `success` 同值
- `error_msg` 失败原因（≤300 字）
- `record_id` 对应 `identification_records._id`（失败为空）
- `reuse_reason` `same_image` / `same_species` / `''`
- `species_name_zh` / `species_name_latin` / `confidence`（0–1，无则 null）/ `confidence_level` / `is_specimen`
- `species_info` / `ai_content` 识别结果全文（失败为 null）
- `related_products` 匹配商品 `[{ _id, title, price, cover }]`（≤6）
- `model` / `text_model` 视觉 / 文本模型（`qwen-vl-plus` / `qwen-turbo`；mock 为 `mock`；历史为 `''`）
- `duration_ms` 函数内耗时（历史为 null）
- `entry_source` 入口来源；`category_hint` 用户所选类别
- `created_at` 毫秒时间戳；`day` 北京时间 `YYYY-MM-DD`
- `source` `live` / `history`

## 索引建议

`created_at` 降序；`openid + created_at`；`success + created_at`。

## 保留

建议 180 天（待产品负责人拍板，见蓝图 §4 / §6 N2）；当前无自动清理。
