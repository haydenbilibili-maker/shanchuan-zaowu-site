# Admin 近阶段体验与安全加固（摘要）

承接 2026-08 多轮自主优化，便于运营验收与后续协作者对齐。

## 已落地能力

| 能力 | 入口 / 说明 |
|------|-------------|
| 客服主题图标选择器 | 客服入口配置 → 主题行下拉预设 + 自定义路径 |
| 秒杀 KPI 进行中/已过期 | 驾驶舱待办；藏品库营销筛选 + 过期角标 |
| 秒杀安全批量 | 批量关秒杀/拼团、批量延长 +3 天、一键清理过期 |
| 行为看板埋点说明 | C 端行为看板 →「埋点说明」抽屉；见 [C端行为埋点说明.md](./C端行为埋点说明.md) |
| 新模块 loadError | 养护 / 门店展区 / 客服 / 报价单 / 预约候补：失败红条，不伪装空态 |
| 看板 loadError | RealtimeMonitor / UserInsights / CustomReport（生成与模板） |
| bundle `db` 禁用导出 | `cloud.js` 导出 Proxy；业务须用 CDN `getCdnDatabase` / `fetchCollection*` |
| 报价单官网联动 | 上架统计、订货价目最近发布、预览 `/price-list` |
| 驾驶舱 | 近 7 日空账本提示；今日已入账时跳过 orders 全量兜底拉取 |
| 首次加载 | CareGuides / SupportConfigs / StoreFront / PriceList：`el-skeleton` |

## 明确未做（需产品）

- 菜单 26/49 合并
- ERP 店铺档案 ↔ 云库 `stores` 双向同步
- PropertyEval 业务模型大改
- 无模板的「批量开秒杀」（避免默认价风险）

## 相关

- [小程序能力对齐补齐_MVP.md](./小程序能力对齐补齐_MVP.md)
- [官网报价单配置.md](./官网报价单配置.md)
- [PLATFORM_CAPABILITIES.md](./PLATFORM_CAPABILITIES.md)
