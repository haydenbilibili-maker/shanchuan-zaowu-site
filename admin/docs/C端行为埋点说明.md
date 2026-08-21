# C 端行为埋点说明

Admin「C 端行为看板」读取云集合 `user_behaviors` / `analytics_daily`，与小程序 `utils/analytics/eventSchema.js`、Admin `admin/src/utils/analyticsSchema.js` 同构。

## 上报入口

小程序统一走 `trackBehavior`（或等价封装）。事件至少包含：

| 字段 | 说明 |
|------|------|
| `action` | 事件名，与 schema 中 ACTION 对齐 |
| `module` | 业务模块（identify / store / custom / …） |
| `openid` | 用户标识（UV） |
| `sessionId` | 可选；有则看板可算真实会话数 |
| `page` | 可选；有则 Top 页面表有数据 |
| `createTime` | 毫秒时间戳 |

## 看板空态含义

| 文案 | 含义 |
|------|------|
| 所选时间段暂无埋点数据 | 期内 `user_behaviors` / 日聚合无记录 |
| 暂无页面级埋点（请确认事件含 page 字段） | 有事件但缺 `page` |
| 待埋点 · 无 sessionId | 有事件但缺会话字段，会话 KPI 显示「—」 |

无数据时**不展示假曲线**；加载失败显示错误 Alert。

## 联调建议

1. 微信开发者工具触发首页 / 鉴定 / 预约等路径，确认云库写入。
2. Admin → 数据洞察 → C 端行为看板，选「今日 / 近 7 天」刷新。
3. 新事件先改 `eventSchema.js`，再同步 Admin `analyticsSchema.js` 与漏斗配置。

## 相关文件

- `miniprogram/utils/analytics/eventSchema.js`
- `admin/src/utils/analyticsSchema.js`
- `admin/src/components/BehaviorAnalytics.vue`
- `admin/docs/PLATFORM_CAPABILITIES.md`（能力边界：勿把演示当生产）
