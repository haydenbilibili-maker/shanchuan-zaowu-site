# 山海造物 · 数智化中台（shanhai-admin）平台能力说明

> **文档用途**：供 Claude、GPT 等模型与协作者快速理解本仓库「是什么、能做什么、数据从哪来、边界在哪」，避免将演示实现误认为生产级 IAM/ERP 全链路。

---

## 1. 产品定位

| 维度 | 说明 |
|------|------|
| **名称** | 山海造物 · 数智化中台（Web Admin） |
| **形态** | 单页应用（SPA），侧栏菜单切换业务模块，无独立路由文件 |
| **用户** | 馆内运营 / 管理端（与微信小程序同一云开发环境，数据互通） |
| **核心价值** | 藏品与订单、会员与营销、内容与活动、财务与配置、经营可视化与 AI 辅助决策 |

---

## 2. 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Vue 3（`<script setup>`） |
| 构建 | Vite（当前使用 `rolldown-vite`） |
| UI | Element Plus + `@element-plus/icons-vue` |
| 图表 | Chart.js（`chart.js` + `chartjs-adapter-date-fns`） |
| 表格/数据 | `xlsx` 等 |
| 后端/数据 | **腾讯云开发** `@cloudbase/js-sdk`（与小程序共享环境） |
| Markdown 渲染 | `marked` |
| 样式 | 全局设计令牌 `src/styles/design-tokens.css`（山海造物 VI）、若干业务样式层 |

---

## 3. 系统架构（逻辑分层）

```
浏览器 (Vue SPA)
    ├── 前端口令门禁（localStorage 会话，非企业 SSO）
    ├── 业务组件（订单/藏品/财务/配置/大屏等）
    ├── AI 调用层（src/utils/aiHelper.js：多模型、多 Key、故障转移）
    └── 云开发（src/cloud.js）
            ├── 匿名登录 + 数据库读写
            ├── 集合：商品/订单/用户/配置/财务记录等
            └── 云存储临时链接（getTempFileURL）
```

**与小程序关系**：同一 `envId` / 区域，共享集合与业务数据；Admin 侧重运营配置与批量管理。

---

## 4. 认证与安全边界（重要）

- **管理端登录**：在 `App.vue` 内实现为**单一口令 + localStorage 标记**的前端门禁，用于演示与内部使用，**不是** OAuth/SAML/多因素等企业身份体系。
- **云开发访问**：Web 端依赖**匿名登录** + 控制台配置的**安全域名** + 集合权限；详见 `docs/DATABASE_CONNECTION.md`。
- **AI 密钥**：`aiHelper.js` 等文件中可能包含第三方 API Key 占位或历史配置；**生产环境应使用环境变量注入**，且勿将密钥提交到公开仓库。本文档不罗列任何密钥。

---

## 5. 菜单与模块映射（`currentTab` → 组件）

侧栏 `el-menu` 的 `index` 与主内容区组件对应关系如下（与 `App.vue` 保持一致）：

| index | 模块名称 | 组件 / 说明 |
|-------|----------|-------------|
| `0` | 经营驾驶舱 | `Dashboard.vue` |
| `1` | 藏品档案库 | 内联于 `App.vue`（商品 CRUD、批量调价/库存、AI 商品助手弹窗等） |
| `2` | 财务核算系统 | `Finance.vue` |
| `3` | 全渠道订单 | `Orders.vue` |
| `4` | 会员 CRM | `CRM.vue` |
| `5` | 活动与排期 | `Activities.vue` |
| `6` | 权益与营销 | `Marketing.vue` |
| `7` | 标本师管理 | `Team.vue`（档案、照片上传、个性化字段；同步小程序名师/定制选师） |
| `8` | 首页轮播 | `BannerManager.vue` |
| `9` | 内容管理 | `ContentManager.vue` |
| `10` | 战略调研看板 | `StrategyResearch.vue`（含大量行业/趋势可视化与调研内容） |
| `58` | 爆品概念生成器 | `ProductConceptGenerator.vue`（7 类定位 + 筛选项；灵感骰子/批量变体；历史/导出/看板桥接） |
| `12` | AI 智能中心 | `AICenter.vue`（多场景 AI 子模块，见下文） |
| `13` | 首页配置 | `HomeConfigManager.vue` |
| `14` | 会员等级体系 | `MemberLevelConfig.vue` |
| `15` | 积分规则配置 | `PointsRulesConfig.vue` |
| `16` | 预约规则配置 | `BookingRulesConfig.vue` |
| `17` | 权限管理系统 | `PermissionManager.vue` |
| `18` | 搜索关键词管理 | `SearchKeywordsManager.vue` |
| `19` | 推荐算法配置 | `RecommendAlgorithmConfig.vue` |
| `20` | 活动营销规则 | `MarketingRulesConfig.vue` |
| `21` | 数据报表增强 | `CustomReportBuilder.vue` |
| `22` | 成就系统配置 | `AchievementConfig.vue` |
| `23` | 用户行为追踪 | `UserBehaviorConfig.vue` |
| `24` | 通知消息配置 | `NotificationConfig.vue` |
| `25` | 运营决策中心 | `ai/OperationsDecisionCenter.vue`（接收 `products` 等 props） |
| `26` | 实时监控大屏 | `RealtimeMonitor.vue` |

**全局浮层**：`CompanionRobot.vue`（经营助理「马上有」）在登录后挂载，跨模块可用。

**仓库内其他 Vue 文件**：如 `ExhibitionManager.vue`、`AIStrategicBrain.vue` 等可能为预留或子入口，**是否挂入主菜单以 `App.vue` 实际 `import` 与模板为准**。

---

## 6. AI 智能中心子能力（`src/components/ai/`）

`AICenter.vue` 通过 `defineAsyncComponent` 懒加载下列场景模块（名称即文件，便于检索）：

- 门店经营：`StoreAI`、`InventoryAI`、`PricingAI`、`SalesAI`
- 营销与内容：`MarketingAI`、`ContentAI`
- 客户与客服：`CustomerAI`、`CustomerServiceAI`
- 供应链与计划：`SupplyChainAI`、`BusinessPlanAI`
- 人力与排班：`StaffOptimizeAI`
- 财务与数据：`FinanceAI`、`DataReportAI`
- 竞争与战略：`CompetitorAnalysisAI`、`StrategyResearchAI`
- 法务：`ContractReviewAI`
- 协作：`VirtualBoard.vue`（虚拟董事会等）

**嵌入其他页面的 AI 组件**（非仅 `AICenter` 懒加载）：

- `ProductAI.vue`：`App.vue` 藏品档案库弹窗
- `InventoryAI.vue`：`App.vue` 库存相关弹窗
- `OrderAI.vue`：`Orders.vue` 内嵌（订单列表上下文）
- `ContentCreationAI.vue`：`ContentManager.vue` 内嵌（内容创作辅助）

**统一调用**：`src/utils/aiHelper.js` 提供统一对话/补全类接口，支持多提供商 Key 轮询、失败计数与恢复策略；可选 **本地 Ollama** 作为兜底（`LOCAL_MODEL_CONFIG`）。

**相关说明文档**：`docs/AI_SYSTEM_ARCHITECTURE.md`、`docs/AI功能升级说明.md`、`docs/TTS优化说明.md`。

---

## 7. 数据层：云数据库集合（`COLLECTIONS`）

定义位置：`src/cloud.js` 中的 `COLLECTIONS`。以下为能力地图级列表（具体字段以各组件读写为准）：

| 集合常量 | 集合名 | 典型用途 |
|----------|--------|----------|
| `PRODUCTS` | `products` | 商品/藏品档案 |
| `CATEGORIES` | `categories` | 分类 |
| `CMS_WIKIS` / `ARTICLES` | `cms_wikis` / `articles` | 百科、文章 |
| `CURATED_COLLECTIONS` | `curated_collections` | 专题展览 |
| `FRAMERS` | `framers` | 名师手作 |
| `BANNERS` | `banners` | 首页轮播 |
| `ACTIVITIES` | `activities` | 活动 |
| `ORDERS` | `orders` | 订单 |
| `USERS` | `users` | 用户/会员 |
| `BOOKINGS` | `bookings` | 预约 |
| `COUPONS` | `coupons` | 优惠券 |
| `STRATEGY_RESEARCH` | `strategy_research` | 战略调研结论持久化 |
| `FINANCE_RECORDS` / `FINANCE_SETTINGS` | `finance_records` / `finance_settings` | 财务账本与设置（多端同步，见 `docs/财务数据多端同步说明.md`） |
| `MEMBER_LEVELS` | `member_levels` | 会员等级 |
| `POINTS_RULES` | `points_rules` | 积分规则 |
| `BOOKING_RULES` | `booking_rules` | 预约规则 |
| `ADMIN_*` | `admin_roles` / `admin_users` / `admin_operation_logs` / `admin_login_logs` | 权限与审计（若模块启用） |
| 搜索与推荐 | `search_hot_keywords` / `search_blacklist` / `recommend_algorithm_config` | 搜索运营与推荐配置 |
| `MARKETING_RULES_CONFIG` | `marketing_rules_config` | 营销规则 |
| `REPORT_TEMPLATES` | `report_templates` | 报表模板 |
| `ACHIEVEMENT_CONFIGS` | `achievement_configs` | 成就系统 |
| `USER_BEHAVIOR_CONFIG` / `USER_BEHAVIORS` | 配置与行为数据 | 行为追踪 |
| `NOTIFICATION_TEMPLATES` | `notification_templates` | 通知模板 |

**连接 API**：`loginToCloud()`、`safeDbOperation()`、`getTempFileUrl` / `getTempFileUrls` 等。

---

## 8. 设计与多端体验

- **VI**：品牌绿、博物金、大地色与浅色工作台语义色定义于 `design-tokens.css`；经营类大屏/AI 等模块有统一壳层 `vi-enterprise-modules.css`。
- **移动端**：`App.vue` 内响应式侧栏 + 多套 `mobile-*.css` 优化手机访问；详见各 `docs/移动端*.md`。

---

## 9. 能力边界（模型回答问题时建议遵守）

1. **数据真实性**：业务数字可能来自 Mock、本地生成或云库；回答「默认营收」类问题需说明数据来源组件/集合。
2. **权限**：Admin 口令不等于数据库行级权限；真实权限以云开发安全规则为准。
3. **AI 输出**：助手生成内容为辅助，不构成财务或法律意见；合同/战略类模块需人工复核。
4. **版本**：界面文案可能出现 `v12.6.0 Enterprise Build` 等展示用版本号，**以 `package.json` 与 git 为准**。
5. **库存与采购**：当前生产可用的是 C 端 `orders` + `products.stock`，以及官网 `purchase_intents` 线索跟进。**完整门店/渠道订货履约与成品库存流水**以 [`订货履约与成品库存_Phase1_技术蓝图.md`](./订货履约与成品库存_Phase1_技术蓝图.md) 为准。飞书「标本工作室采购库存管理系统」继续管原材料采购/库存，与 Admin 的打通见 [`飞书多维表对接_技术蓝图.md`](./飞书多维表对接_技术蓝图.md)（映射同步，禁止无映射双写）。勿将 InventoryAI /「采购管理」演示当成已上线 WMS。

---

## 10. 相关文档索引

| 文档 | 内容 |
|------|------|
| `docs/DATABASE_CONNECTION.md` | 云环境、集合、域名与匿名登录配置 |
| `docs/AI_SYSTEM_ARCHITECTURE.md` | AI 模块分工与整合思路 |
| `docs/财务数据多端同步说明.md` | 财务数据同步策略 |
| `docs/系统优化与配置能力分析.md` | 系统与配置项梳理 |
| `docs/PRD-三期规划.md` | 产品规划参考 |
| `docs/订货履约与成品库存_Phase1_技术蓝图.md` | 订货单 / 出货 / 总部成品库存（进行中） |
| `docs/飞书多维表对接_技术蓝图.md` | 飞书多维表 ↔ Admin 分域同步 |

---

## 11. 维护建议

- 新增菜单项：同步修改 `App.vue` 侧栏 `el-menu-item` 与主区域 `v-else-if` / `component :is`。
- 新增云集合：在 `cloud.js` 的 `COLLECTIONS` 中增加常量并在控制台创建集合与权限。
- 供模型阅读的「唯一入口」：优先保持本文档与 `docs/README.md` 索引更新。

*最后更新：与仓库 `App.vue`、`cloud.js` 结构对齐；若代码变更，请同步修订本节。*
