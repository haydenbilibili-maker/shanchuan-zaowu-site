# 数据统计与分析框架 PRD

> **文档状态**：v1.0（框架 v1 已落地代码）  
> **模块代号**：Analytics / 山川数据  
> **撰写日期**：2026-05-23  
> **关联实现**：`utils/analytics/`、`cloudfunctions/trackUserBehavior`、`cloudfunctions/getAnalyticsDashboard`

---

## 1. 背景

小程序原有埋点分散：`trackUserBehavior` 云函数 + 各页面直调、字段不统一、无 session/page 上下文、无自动页面 PV、店长侧仅有 GMV 账本而无行为看板。

**目标**：建立 **「采 → 存 → 汇 → 看」** 四层数据框架，支撑产品迭代、门店 O2O 与 AI 鉴定等模块的度量。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  C 端 SDK（utils/analytics）                             │
│  pageHook · session · eventSchema · 批量队列 flush       │
└──────────────────────────┬──────────────────────────────┘
                           │ wx.cloud.callFunction
                           ▼
┌─────────────────────────────────────────────────────────┐
│  trackUserBehavior v2（云函数）                          │
│  单条/批量 · 标准化字段 · 写 user_behaviors              │
│  增量 rollup → analytics_daily                           │
└──────────────────────────┬──────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
   user_behaviors（明细）          analytics_daily（日汇总）
           │                               │
           └───────────────┬───────────────┘
                           ▼
              getAnalyticsDashboard（店长看板 API）
                           │
                           ▼
              店长后台 Tab「数据看板」
```

---

## 3. 客户端 SDK

### 3.1 目录

| 文件 | 职责 |
|---|---|
| `utils/analytics/index.js` | `track()` / `trackPageView()` / `flush()` |
| `utils/analytics/eventSchema.js` | 事件注册表（单一事实来源） |
| `utils/analytics/constants.js` | 模块枚举与 action 前缀推断 |
| `utils/analytics/session.js` | 30 分钟 sessionId |
| `utils/analytics/pageHook.js` | 全局 Page 劫持：page_view / page_leave |
| `utils/trackBehavior.js` | 兼容旧 import 路径 |

### 3.2 标准事件字段

| 字段 | 说明 |
|---|---|
| `userId` | openid |
| `action` | 事件名，如 `identify_success` |
| `targetType` | 对象类型：product / store / page … |
| `targetId` | 对象 ID |
| `module` | 业务模块：identify / store / commerce … |
| `sessionId` | 会话 ID |
| `page` | 当前页面 route |
| `scene` | 小程序启动 scene |
| `referrerPage` | 会话内上一页 |
| `timestamp` | 毫秒时间戳 |
| `dateKey` | `YYYY-MM-DD`（服务端写入） |
| `properties` | 扩展属性对象 |

### 3.3 使用方式

```javascript
const { trackBehavior } = require('../../utils/trackBehavior');

// 业务事件
trackBehavior('identify_success', 'identification', recordId, {
  species: '闪蝶',
  confidence: 0.92
});

// 页面 PV 由 pageHook 自动上报，无需手动调用
```

### 3.4 批量与性能

- 本地队列最多 20 条或 8 秒自动 flush  
- `app.onHide` 强制 flush  
- 未登录时不写入（静默丢弃，不阻塞 UI）

---

## 4. 事件注册表（模块摘要）

完整列表见 `utils/analytics/eventSchema.js`。

| 模块 | 代表事件 |
|---|---|
| **system** | page_view, page_leave, tab_switch, app_launch |
| **explore** | explore_store_card_click |
| **encyclopedia** | encyclopedia_content_click, wiki_to_product |
| **commerce** | product_view, product_add_cart, cart_view, search, order_submit |
| **store** | store_tab_enter, store_checkin, store_zone_to_product … |
| **booking** | booking_page_enter, booking_submit, booking_store_switch |
| **identify** | identify_start/success/result_view/save_atlas … |
| **custom** | custom_enter, pet_memorial_submit … |
| **message** | message_read, message_action … |
| **support** | support_ticket_submit … |

**规范**：新增埋点必须先在 `eventSchema.js` 登记，再调用 `trackBehavior`。

---

## 5. 云函数与数据集合

### 5.1 trackUserBehavior v2

- 入参：`{ events: [...] }` 或单条 legacy 格式  
- 写入 `user_behaviors`  
- 异步更新 `analytics_daily`（按 dateKey + action 计数，uv 去重数组）

### 5.2 getAnalyticsDashboard

- 权限：`MESSAGE_ADMIN_OPENIDS`（空则开发环境放行）  
- 入参：`{ action: 'overview', days: 7 }`  
- 出参：summary（PV/UV/模块/Top 事件）、漏斗（identify/store/commerce）、dailyTrend

### 5.3 需创建的集合

| 集合 | 说明 |
|---|---|
| `user_behaviors` | 已有，字段扩展 |
| `analytics_daily` | **新建**，日汇总 |

**索引建议**：

- `user_behaviors`：`timestamp` 降序、`action`、`module`、`dateKey`  
- `analytics_daily`：`dateKey` + `action` 联合查询

---

## 6. 店长看板（C 端 B 端）

**入口**：店长后台 → **数据** Tab（curTab=13）

| 区块 | 内容 |
|---|---|
| 周期切换 | 今日 / 7 日 / 30 日 |
| 核心指标 | 总事件、PV、UV（采样） |
| AI 鉴定漏斗 | 入口 → 开始 → 成功 → 保存图鉴 |
| 门店漏斗 | Tab 进入 → 展陈 → 预约 → 签到 |
| 模块分布 | 按 module 计数 |
| Top 事件 | 按 action 计数 Top 20 |

> 数据量 > 2000 条时采用最近 2000 条采样，看板展示提示文案。

---

## 7. 与现有系统关系

| 系统 | 关系 |
|---|---|
| `getUserStatistics` | 仍读 legacy action（view/collect/share/search）；后续可叠加 page_view |
| `getRecommendations` | 继续读 user_behaviors |
| `getHotSearchKeywords` | 继续读 action=search |
| `errorMonitor` | 独立错误队列，未来可汇入 analytics |

---

## 8. 部署清单

1. 上传云函数：`trackUserBehavior`（覆盖）、`getAnalyticsDashboard`（新建）  
2. 云开发控制台创建集合 `analytics_daily`  
3. 为 `user_behaviors` 补充索引（见 §5.3）  
4. 配置环境变量 `MESSAGE_ADMIN_OPENIDS`（店长 openid 列表）

---

## 9. 后续迭代 **【待排期】**

| 优先级 | 项 |
|---|---|
| P1 | 定时云函数 T+1 全量 rollup（突破 2000 采样限制） |
| P1 | ERP Web 看板复用 getAnalyticsDashboard API |
| P1 | 社区 / 文章 / 视频页补全埋点 |
| P2 | 与微信官方 `wx.reportAnalytics` 双写 **【待确认】** |
| P2 | 漏斗可视化折线图、导出 CSV |
| P2 | 用户级路径分析（session 序列） |

---

## 10. 验收标准

- [ ] 任意 Tab 切换产生 `tab_switch` 事件  
- [ ] 任意页面进入产生 `page_view`，离开产生 `page_leave`（含 durationMs）  
- [ ] 批量上报：连续操作后 `user_behaviors` 单次云函数写入多条  
- [ ] `analytics_daily` 随事件增量更新  
- [ ] 店长数据看板 7 日漏斗与明细大致一致（采样范围内）  
- [ ] 旧页面 `trackBehavior` 调用无需改动即可走新链路

---

*山海造物 Nature's Creations · Analytics Framework v1 · 2026-05-23*
