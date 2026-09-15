# analytics_daily · C 端行为日汇总

环境：`cloud1-8gnkty5bfff9f0bf`

## 用途

`trackUserBehavior` 增量 rollup；`getAnalyticsDashboard` 读 DAU / 事件计数。
ERP 内容工厂摘要请走 `getAnalyticsDashboard.behaviorSnippet`，勿再 CDN 直读敏感 uv 列表。

规则：登录可读、**禁止客户端写**（`write: false`）。写入仅云函数。

## 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `dateKey` | string | `YYYY-MM-DD` |
| `action` | string | 事件名 |
| `count` | number | 次数 |
| `uv` | string[] | 去重 openid（敏感，勿对 C 端暴露） |

## 关联

- 规则：[`../rules/analytics_daily.json`](../rules/analytics_daily.json)
