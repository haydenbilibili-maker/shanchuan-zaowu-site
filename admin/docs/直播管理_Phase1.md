# 直播管理（ERP · Phase 1）

**目标**：ERP 提供总部视角的直播监控与兜底；开播与挂车仍由小程序主播工作台负责（不重复实现）。

## 数据源（小程序侧 SSOT）

| 集合 | 说明 |
|------|------|
| `live_sessions` | 场次：`title` / `status(idle\|live\|ended)` / `hostName` / `hostOpenid` / `startTime` / `endTime` / `scheduledAt` / `shelfProductIds` / `likeCount` / `presence` |
| `live_messages` | 直播间互动消息 |
| `live_reminders` | 开播提醒订阅 |

## 云函数（`manageLiveSession`）

| action | 用途 |
|--------|------|
| `listRecent` | 最近 20 场（本页列表） |
| `getSession` | 单场详情（本页抽屉） |
| `forceEnd` | 强制结束（异常兜底） |

## ERP 模块

- 菜单：业务运营 → 体验营销 → **直播管理**（`App.vue` id `73`）
- 组件：`admin/src/components/LiveSessions.vue`
- 能力：场次列表（状态、主播、挂车数、在线/点赞）＋ 详情抽屉（公告、流名、拉流地址）＋ **强制结束**。

## 边界

- ERP 不做开播/挂车/发消息（避免与主播端双入口写同一场次）。
- 强制结束仅对 `status=live` 的场次开放；结束后状态落 `ended`，观众端立即收到结束态。
- 完成度升级见 [`主播工作台_Phase2_完成度升级_2026-09-24.md`](./主播工作台_Phase2_完成度升级_2026-09-24.md)（小程序 Hub UI；本页仍仅监控）。
