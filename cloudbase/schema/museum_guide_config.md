# museum_guide_config · 博物君开关与每日额度

> 2026-11-23 新增（超管工作台「博物君」，蓝图 `miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md` §6）。只有一份文档 `_id = main`。

## 权限

| 通道 | 权限 |
|---|---|
| 客户端（Web / 小程序） | ❌ 不可读、不可写 |
| 云函数（服务端 SDK） | ✅ `museumGuideMonitor` 仅超管写（先写 `admin_operation_logs` 审计，审计失败即拒绝）；`askMuseumGuide`、`getContentDisplayFlags` 只读 |

规则文件：`cloudbase/rules/museum_guide_config.json` = `{ "read": false, "write": false }`

## 字段

- `enabled` 是否开馆（缺省 / 读不到 = 开启；只有显式 `false` 闭馆）
- `dailyLimit` 每人每日提问数（5–200；缺省 = 云函数环境变量 `MUSEUM_GUIDE_DAILY_LIMIT`，再缺省 30）
- `updatedAt` / `updatedBy` / `updatedByName` 最近一次修改

## 读取方

- `askMuseumGuide`：闭馆时提问返回 `error_type: 'off'`；`action: 'status'` 给页面开没开与今日剩余。
- `getContentDisplayFlags`：只读带出 `museumGuideOpen`（「我的」宫格入口显隐）；**它的 save 不写这个开关**，ERP / 店长端保存内容开关不会把博物君改回开启。
