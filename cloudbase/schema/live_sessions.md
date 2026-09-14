# live_sessions / live_messages / live_reminders · 馆内直播

环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）

## 用途

- `live_sessions`：直播场次（一名主播同时只允许一场 live）。
- `live_messages`：直播间互动消息。
- `live_reminders`：开播提醒订阅。

读写全部经云函数 `manageLiveSession`（`create` / `start` / `end` / `forceEnd` / `getSession` / `listRecent` /
`getDashboard` / `updateShelf` / `updateNotice` / `setSpotlight` / `postMessage` 等）；
ERP 端模块见 `admin/docs/直播管理_Phase1.md`（仅监控与强制结束）。

## 控制台步骤

1. 新建三个集合
2. 权限 → 自定义安全规则 → 粘贴对应 `../rules/live_*.json`（均 `false/false`，仅云函数可访问）

## 字段

### live_sessions

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 场次标题 |
| `status` | string | `idle` \| `live` \| `ended` |
| `hostOpenid` / `hostName` | string | 主播 |
| `streamName` / `pullUrl` / `pullUrlRtmp` | string | 推拉流信息（`stripPush` 后对 C 端只暴露拉流） |
| `scheduledAt` | number | 排期时间戳 |
| `startTime` / `endTime` | number | 实际开播/结束 |
| `shelfProductIds` | string[] | 挂车商品 |
| `presence` / `likeCount` | — | 在线与点赞统计 |
| `notice` / `noticeUpdatedAt` | string/number | 直播间公告 |
| `configured` | boolean | 推流配置是否就绪 |

### live_messages

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | 场次 |
| `_openid` / `nickName` | string | 发言用户 |
| `type` | string | `chat` \| `like` \| `system` |
| `text` | string | 内容（服务端截断） |
| `createTime` | number | 时间 |

### live_reminders

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | 场次 |
| `_openid` | string | 订阅用户 |
| `status` | string | `pending` \| `sent` \| `cancelled` |
