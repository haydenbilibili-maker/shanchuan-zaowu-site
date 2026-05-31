# 山海有信 PRD（共创稿）

> **文档状态**：v1.0（M1 已开发）  
> **模块代号**：Shanhai Messages / 山海有信  
> **品牌**：山海造物 Nature's Creations · Museum Mode（C 端）/ 店长后台暗色 Studio  
> **撰写日期**：2026-05-23  
> **共创说明**：文中 **【待确认】** 须产品 / 运营 / 门店 / 技术共同拍板后方可开发。

---

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 产品模块 | 站内信「山海有信」—— 自动化触达 + 店长运营推送 |
| C 端入口 | 「我的」→ 馆藏服务 → **山海有信**（`pages/user/messages`） |
| B 端入口 | 店长后台新增 **「山海有信」** Tab（建议 `curTab: 11`） |
| 关联云函数 | `sendInAppMessage`、`getUserMessages`；新增 `pushMessage`（运营推送）、`messageTemplate`（模板配置） |
| 关联集合 | `user_messages`、`notification_logs`；新增 `message_templates`、`push_campaigns`、`user_push_prefs` |
| 前置文档 | [站内信功能说明](./站内信功能说明.md)、[联系专员功能说明](./联系专员功能说明.md)、[PRD_门店模块](./PRD_门店模块.md)、[PRD_标本定制](./PRD_标本定制.md)、[PRD_宠物标本定制](./PRD_宠物标本定制.md) |

---

## 2. 背景与问题陈述

### 2.1 业务诉求

山海有信 v1.1 已具备：**分类列表、深链跳转、统一发送云函数、订单/预约部分自动化**。但在实际运营中仍存在三类缺口：

| 缺口 | 现状 | 问题 |
|---|---|---|
| **交易链路触达不完整** | 仅覆盖下单待付、支付成功、取消、退款、部分预约/伴宠 | **发货、签收、定制进度、留言回复、鉴定结果** 等关键节点无站内信或文案硬编码分散 |
| **无统一 Push 策略** | 各云函数 / 店长页各自 `callFunction`，无模板、无开关、无去重 | 难以保证文案一致、无法按场景启停、重复发送风险 |
| **运营无法自主推送** | Web ERP 有「通知配置」规划，小程序店长后台无推送能力 | 活动预告、门店公告、上新提醒依赖开发改代码 |

### 2.2 现状诊断（基于代码）

#### 已实现的自动化触达

| 场景 | type | 触发点 | 状态 |
|---|---|---|---|
| 订单待支付 | `order_created` | `makeOrder` | ✅ |
| 支付成功 | `order_paid` | `payCallback` / `confirmPayment` | ✅ |
| 订单取消 | `order_cancelled` | `cancelOrder` | ✅ |
| 退款完成 | `order_refunded` | `refundOrder` | ✅ |
| 预约提醒 | `booking_reminder` | `sendBookingReminder` | ✅（+ 订阅消息双通道） |
| 伴宠交接预约 | `system_notice` | `createBooking`（pet_intake） | ✅ |
| 伴宠报价 | `system_notice` | 店长 `submitPetQuote` | ✅ |
| 定制意向 / 留言回执 | `system_notice` | `submitCustomInquiry` / `submitSupportTicket` | ✅ |

#### 已定义但未接入 / 缺失的触达

| 场景 | type（已预留） | 缺口 |
|---|---|---|
| 订单已发货 | `order_shipped` | `ACTION_URL_MAP` 有映射，**店长 `submitShip` 未调用** |
| 订单已签收 | `order_received` | 无触发点（确认收货逻辑待接） |
| 预约成功 / 改期 / 取消 | `booking_success` 等 | `createBooking` 成功路径**未统一发信** |
| 定制工单进度 | — | `advanceProduction` 装裱/包装/发出**无通知** |
| 伴宠全状态机 | — | 除报价、交接外，**需补充 / 已承接 / 制作中 / 完成** 等无通知 |
| 专员留言回复 | — | 店长回复工单**无用户侧回执** |
| 鉴定完成 | `identify_result` | 前端有 type，**云函数未接入** |
| 优惠券 / 会员 / 购物车 | — | 未规划 |

#### 架构问题

1. **双写逻辑重复**：`sendInAppMessage` 与 `payCallback/inAppMessage.js` 各维护一份 `ACTION_URL_MAP`。
2. **模板硬编码**：标题、正文写死在业务代码，运营无法改文案。
3. **无发送策略层**：缺少「是否发送 / 去重 / 静默时段 / 订阅消息互补」的统一决策。
4. **无运营推送**：无法指定用户、分群或全局广播。

**结论**：v2.0 目标 = **补全交易自动化触达矩阵** + **引入模板与策略引擎** + **店长后台可配置运营推送**。

---

## 3. 产品定位

### 3.1 一句话定位

> **山海有信 = 用户与山海造物之间的「铜牌回执」—— 每一笔订单、每一次预约、每一条专员回复，都有迹可循；运营亦可在此发布策展级公告。**

### 3.2 与相邻能力分工

| 能力 | 定位 | 与山海有信关系 |
|---|---|---|
| **微信订阅消息** | 站外触达，需用户授权，条数受限 | **互补**：交易关键节点尝试订阅消息；**站内信始终写入**（不依赖授权） |
| **联系专员** | 用户主动咨询（即时 + 留言） | 留言提交 → 山海有信回执；专员回复 → **v2 新增**回复通知 |
| **微信客服会话** | 实时对话 | 不替代站内信；可在消息 CTA 跳转「联系专员」 |
| **Web ERP 通知配置** | 总部级规则与模板 | **v2 先落地店长小程序后台**；ERP 只读同步或二期对齐 **【待确认】** |

### 3.3 北极星指标

| 指标 | 说明 |
|---|---|
| 交易消息覆盖率 | 应触达的交易节点中，实际写入 `user_messages` 的比例（目标 ≥ 95%） |
| 消息已读率 | 7 日内被打开的消息 / 发送量 |
| CTA 点击率 | 含 `actionUrl` 的消息 → 用户点击「查看订单/预约」比例 |
| 运营推送有效触达 | 全局/分群推送的送达用户数（去重） |
| 冗余发送率 | 同一 `relatedId + type` 24h 内重复发送占比（目标 < 1%） |

---

## 4. 设计原则

1. **Receipt First** — 站内信首先是「回执与进度」，不是营销短信；交易类消息优先级高于运营类。
2. **In-App Always** — 凡业务状态变更，**至少**写入山海有信；订阅消息为加分项。
3. **One Template, One Voice** — 同类消息共用模板，文案克制、具体，符合品牌 VI（无 emoji 图标、无直播话术）。
4. **Deep Link by Default** — 可跳转的消息必须带 `actionUrl`；CTA 文案与 `messageHelper` 分类一致。
5. **Operator Safe** — 运营推送需预览、人数估算、发送确认；全局推送需二次确认 **【待确认：是否需超管 PIN】**。
6. **Quiet Hours** — 非紧急运营推送默认避开 22:00–09:00 **【待确认时区：东八区】**。
7. **Idempotent** — 同一业务事件重复触发时，不重复骚扰用户（幂等键见 §8.3）。

---

## 5. 用户故事

### 5.1 C 端用户

| ID | 故事 | 验收 |
|---|---|---|
| U1 | 作为买家，发货后我希望收到物流信息，并能一键查看订单 | 店长确认发货 → 收到 `order_shipped`，含承运商与单号 |
| U2 | 作为预约用户，我希望预约成功即时收到票号与到店指引 | 创建预约成功 → `booking_success` |
| U3 | 作为定制客户，我希望看到装裱/包装/发出各阶段通知 | 店长更新生产状态 → 对应进度消息 |
| U4 | 作为伴宠家属，我希望每个工单状态变化都有温柔、具体的说明 | 状态机各节点 → 模板化通知 |
| U5 | 作为留言用户，我希望专员回复后能在山海有信看到 | 店长回复 `support_tickets` → 用户收到回复通知 |
| U6 | 作为会员，我希望收到门店活动/上新公告，但不要太频繁 | 运营推送可分类为「活动」；用户可标记已读/删除 |
| U7 | 作为用户，我希望在「我的」看到准确未读数，并按分类筛选 | 红点与列表分类一致（现有能力保持） |

### 5.2 店长 / 运营

| ID | 故事 | 验收 |
|---|---|---|
| O1 | 作为店长，我希望发货后系统自动通知用户，无需手动复制文案 | 发货提交即触发，模板可预览 |
| O2 | 作为运营，我希望编辑一条活动通知并推送给全部用户 | 全局推送 + 发送记录 |
| O3 | 作为运营，我希望只推送给「有未完成订单的用户」 | 分群推送（M2） |
| O4 | 作为店长，我希望查看最近发送了哪些通知、失败原因 | 发送记录 Tab，读 `notification_logs` / `push_campaigns` |
| O5 | 作为店长，我希望临时关闭某类自动通知（如活动类） | 模板开关 **【待确认范围】** |

---

## 6. 模块一：自动化 Push 策略（交易 & 业务事件）

### 6.1 通道策略

| 通道 | 适用 | 策略 |
|---|---|---|
| **站内信（必选）** | 全部事件 | 一律调用统一发送层 |
| **订阅消息（可选）** | 预约提醒、发货、支付成功 | 用户已授权则并行发送；失败不影响站内信 |shangyib
| **微信客服（不自动）** | 复杂售后 | 仅 CTA 引导，不自动发客服消息 |

### 6.2 事件矩阵（v2 目标态）

#### 6.2.1 订单（category: `order`）

| 事件 | type | 触发点 | 标题（模板默认） | 正文要点 | actionUrl |
|---|---|---|---|---|---|
| 创建待支付 | `order_created` | `makeOrder` | 订单待支付 | 商品摘要、金额、30 分钟支付时限 | 订单详情 |
| 支付成功 | `order_paid` | 支付回调 | 支付成功 | 订单号、实付、预计发货说明 | 订单详情 |
| 已发货 | `order_shipped` | 店长 `submitShip` / 云函数 `shipOrder` | 藏品已发出 | 承运商、运单号、发货时间 | 订单详情 |
| 已签收 | `order_received` | 用户确认收货 / 物流自动签收 **【待确认】** | 感谢您的收藏 | 邀请评价、售后入口 | 订单详情 / 评价页 |
| 已取消 | `order_cancelled` | `cancelOrder` / 超时关单 **【待确认】** | 订单已取消 | 原因、退款说明 | 订单详情 |
| 退款完成 | `order_refunded` | `refundOrder` | 退款已到账 | 金额、到账时效说明 | 订单详情 |
| 待支付提醒 | `order_pay_remind` | 定时任务：距关单 10 分钟 **【M2】** | 别忘了完成支付 | 剩余分钟数 | 订单详情 |

#### 6.2.2 预约（category: `booking`）

| 事件 | type | 触发点 | 标题 | 正文要点 |
|---|---|---|---|---|
| 预约成功 | `booking_success` | `createBooking` | 预约已确认 | 票号、日期时段、门店名、地址摘要 |
| 行前 1 天 | `booking_reminder` | `sendBookingReminder` | 明日到店提醒 | 已有，对齐模板 |
| 行前 2 小时 | `booking_reminder` | 同上 | 即将开始 | 已有 |
| 预约改期 | `booking_changed` | 改期云函数 **【待确认入口】** | 预约时间已变更 | 新时间、票号 |
| 预约取消 | `booking_cancelled` | 取消预约 | 预约已取消 | 退款/改约指引 |
| 核销完成 | `booking_checked_in` | 店长核销 | 欢迎到店 | 可选，轻量感谢 **【P2】** |

#### 6.2.3 标本定制（category: `custom`，**新增分类**）

| 事件 | type | 触发点 | 标题 |
|---|---|---|---|
| 意向已收到 | `custom_inquiry_received` | `submitCustomInquiry` | 定制意向已收到 |
| 专员已联系 | `custom_inquiry_contacted` | 店长标记已联系 | 专员将与您确认细节 |
| 开始装裱 | `custom_production_framing` | `advanceProduction` → framing | 您的藏品开始装裱 |
| 进入包装 | `custom_production_packing` | → packing | 装裱完成，正在包装 |
| 定制发出 | `custom_production_shipped` | → shipped | 定制藏品已发出 |

#### 6.2.4 伴宠记忆（category: `custom` 或 `system` **【待确认】**）

| 事件 | type | 触发点 |
|---|---|---|
| 工单已收到 | `pet_memorial_received` | `petMemorialOrder` 创建 |
| 需补充资料 | `pet_memorial_need_info` | 店长标记 need_info |
| 报价已出 | `pet_memorial_quoted` | 已有 |
| 用户确认报价 | `pet_memorial_quote_confirmed` | 用户 confirmQuote |
| 已承接 / 待交接 / 已交接 / 制作中 / 已完成 | `pet_memorial_*` | 店长状态更新 |
| 交接预约确认 | `pet_intake_booked` | 已有 |

#### 6.2.5 服务与内容（category: `system` / `activity`）

| 事件 | type | 触发点 |
|---|---|---|
| 留言已收到 | `support_ticket_received` | `submitSupportTicket` |
| 专员已回复 | `support_ticket_replied` | 店长回复留言 **【新增】** |
| 鉴定完成 | `identify_result` | 鉴定云函数完成 |
| 成就解锁 | `achievement_unlocked` | 成就系统 **【P2】** |
| 优惠券到账 | `coupon_received` | 发券逻辑 **【M2】** |
| 会员等级变更 | `vip_level_changed` | 会员体系 **【M2】** |

### 6.3 发送决策（策略引擎）

统一由 **`dispatchMessage(event)`**（新云函数或在 `sendInAppMessage` 内扩展）处理：

```
输入：{ eventType, openid, relatedId, payload, source }
  ↓
1. 查 message_templates：该 type 是否 enabled
2. 幂等检查：dedupeKey = `${type}:${relatedId}:${openid}` 24h 内是否已发
3. 渲染模板：{{orderNo}}、{{productName}}、{{trackingNo}} 等占位符
4. 写入 user_messages + notification_logs
5. 若 template.subscribeTemplateId 存在 → 尝试订阅消息（不阻塞）
输出：{ success, messageId, skippedReason? }
```

**优先级**：

| 级别 | 类型 | 静默时段是否发送 |
|---|---|---|
| P0 | 支付、退款、发货、预约提醒 | **是**（交易必须触达） |
| P1 | 定制进度、专员回复、鉴定 | 是 |
| P2 | 活动、营销、成就 | 否（顺延至 09:00） **【待确认】** |

### 6.4 与订阅消息对齐 **【待确认模板 ID】**

| 站内 type | 建议订阅模板场景 |
|---|---|
| `order_paid` | 支付成功通知 |
| `order_shipped` | 发货通知 |
| `booking_reminder` | 预约提醒（已有） |
| `order_pay_remind` | 待付款提醒 |

---

## 7. 模块二：定制化与运营 Push（店长后台）

### 7.1 功能范围

在 **店长后台**（`subpackages/business/manager`）新增 **「山海有信」** Tab，包含三个子模块：

| 子 Tab | 功能 | 优先级 |
|---|---|---|
| **发送通知** | 手动创建并推送消息 | **P0** |
| **发送记录** | 历史 campaigns + 自动触达日志 | **P0** |
| **模板管理** | 查看/编辑自动触达文案（只改文案，不改触发点） | **P1** |

> Web ERP 同步能力列为 **M2**，避免双后台配置冲突 **【待确认】**。

### 7.2 发送通知（手动推送）

#### 7.2.1 创建表单字段

| 字段 | 说明 | 校验 |
|---|---|---|
| 标题 | ≤ 30 字 | 必填 |
| 正文 | ≤ 200 字 | 必填 |
| 分类 | `activity` / `system` | 必填；**禁止选 order/booking**（防冒充交易消息） |
| 封面图标 | 可选，默认分类图标 | 可选 |
| 跳转链接 | 小程序 path 或留空 | 格式校验 |
| 推送范围 | 见 §7.2.2 | 必填 |
| 定时发送 | 立即 / 指定时间 | 定时 ≥ 当前 + 5 分钟 |
| 预览 | 模拟消息卡片 | — |

#### 7.2.2 推送范围 **【分阶段】**

| 范围 | 说明 | 阶段 |
|---|---|---|
| **指定用户** | 输入 openid 或从订单/预约/工单列表点选 | **M1** |
| **全局推送** | 全部有 `_openid` 的用户（分批写入） | **M1** |
| **标签分群** | 如「30 日内有订单」「VIP≥2」 | **M2** |
| **门店维度** | 某门店预约过/到过店的用户 | **M2**（依赖门店模块 storeId） |

#### 7.2.3 全局推送流程

```
运营填写 → 预览 → 显示预估人数「约 N 人」→ 二次确认弹窗
  → 创建 push_campaigns（status: pending）
  → 云函数 pushMessage 分批（每批 100 openid）
  → 更新 campaign：sent / failed / completedAt
  → 店长可在发送记录查看进度
```

**风控**：

- 同一店长 24h 内全局推送 ≤ 1 次 **【待确认】**
- 全局推送正文需含「活动/公告」语义，避免「您的订单…」类文案（前端 + 服务端校验）
- 单次全局推送上限 **【待确认：5000 人/次 vs 全量】**

#### 7.2.4 指定用户推送

- 从 **订单详情 / 预约列表 / 伴宠工单 / 留言工单** 增加「发山海有信」快捷入口，预填 openid 与 relatedId。
- 支持店长自定义标题正文（不走交易模板），分类固定 `system`。

### 7.3 模板管理（自动触达文案）

**只读 + 可编辑文案**，不可新增触发点（触发点变更仍走发版）。

| 字段 | 说明 |
|---|---|
| templateCode | 与 type 对齐，如 `order_shipped` |
| titleTemplate | 支持 `{{orderNo}}` |
| contentTemplate | 多行 |
| enabled | 开关 |
| category | 自动分类 |
| defaultActionUrl | path 模板 |
| priority | P0/P1/P2 |

**初始模板**：由开发导入 §6.2 矩阵默认值；运营可在后台微调措辞。

### 7.4 发送记录

| 列 | 来源 |
|---|---|
| 时间 | sentAt |
| 渠道 | `inapp` / `inapp_campaign` / `subscribe` |
| 类型 | 自动 type 或 campaign 名称 |
| 标题 | title |
| 对象 | 单人 openid 掩码 / 「全局 N 人」 |
| 状态 | success / partial / failed |
| 操作 | 查看详情、重试失败批次 **【M2】** |

---

## 8. 数据模型

### 8.1 `user_messages`（扩展，兼容现有）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 接收人 |
| `category` | string | booking / order / custom / activity / system |
| `type` | string | 事件类型 |
| `title` | string | |
| `content` | string | |
| `relatedId` | string | 订单/预约/工单 ID |
| `actionUrl` | string | |
| `icon` | string | 可选 |
| `read` | boolean | |
| `campaignId` | string | 运营推送时关联 **【新增】** |
| `dedupeKey` | string | 幂等键 **【新增】** |
| `createTime` | date | |

### 8.2 `message_templates`（新增）

```json
{
  "templateCode": "order_shipped",
  "category": "order",
  "titleTemplate": "藏品已发出",
  "contentTemplate": "订单 {{orderNo}} 已通过{{carrier}}发出\n运单号：{{trackingNo}}",
  "actionUrlTemplate": "subpackages/business/order-detail/index?id={{relatedId}}",
  "enabled": true,
  "priority": "P0",
  "subscribeTemplateId": "",
  "updatedAt": "serverDate",
  "updatedBy": "manager_openid"
}
```

### 8.3 `push_campaigns`（新增）

```json
{
  "title": "周末手作课开放预约",
  "content": "...",
  "category": "activity",
  "actionUrl": "pages/store/index",
  "scope": "all | single | segment",
  "targetOpenid": "",
  "segmentRule": {},
  "scheduledAt": null,
  "status": "draft | pending | sending | completed | failed",
  "stats": { "target": 1200, "sent": 1180, "failed": 20 },
  "createdBy": "manager_openid",
  "createTime": "serverDate"
}
```

**幂等键规则**：`dedupeKey = ${templateCode}:${relatedId}:${openid}`；运营 campaign 使用 `campaign:${campaignId}:${openid}`。

### 8.4 `user_push_prefs`（M2，可选）

| 字段 | 说明 |
|---|---|
| `_openid` | |
| `muteActivity` | 关闭活动类推送 |
| `muteMarketing` | 关闭营销类 |

**【待确认】** C 端是否提供「消息设置」入口，或仅依赖删除/已读。

---

## 9. 技术方案摘要

### 9.1 云函数

| 云函数 | 职责 | 阶段 |
|---|---|---|
| `sendInAppMessage` | 重构：支持 templateCode 渲染 + dedupe | M1 |
| `dispatchMessage` | 业务侧统一入口，传 eventType + payload | M1 |
| `pushMessage` | 运营 campaign 分批发送 | M1 |
| `manageMessageTemplates` | 店长 CRUD 模板 | M1 |
| `getPushCampaigns` | 发送记录列表 | M1 |
| `orderPayRemind` | 定时扫描待支付订单 | M2 |

### 9.2 业务改造点（M1 必改）

| 文件 | 改造 |
|---|---|
| `subpackages/business/manager/index.js` | `submitShip` → dispatch `order_shipped`；伴宠/定制状态变更 → dispatch；新增 Tab11 UI |
| `cloudfunctions/createBooking` | 成功 → `booking_success` |
| `payCallback/inAppMessage.js` | 合并至统一模块，删除重复 MAP |
| `utils/messageHelper.js` | 新增 `custom` 分类与 type 元数据 |
| `pages/user/messages` | 筛选 Tab 增加「定制」**【可选 M1】** |

### 9.3 权限

- 店长后台推送：校验店长 openid 白名单（与现有 manager 鉴权一致）
- 全局推送：仅 `role: admin` **【待确认】**

---

## 10. 交互与视觉

### 10.1 C 端（Museum Mode）

- 保持现有暗底 + 黄铜未读点；**不增加**红色营销横幅。
- 运营类消息在列表展示「活动」分类 pill；详情 CTA 用 `btn-secondary` 风格。
- 全局推送消息在首页 **不弹窗** **【待确认：是否要在首页一次弱提示】**。

### 10.2 店长后台

- 与现有 ADMIN DASHBOARD 暗色一致；发送按钮用 Brass 渐变。
- 全局推送二次确认使用品牌文案：「将向约 N 位藏家发送公告，确认发送？」

---

## 11. 分期交付

### M1（3–4 周）— 自动化补全 + 基础运营推送

| 项 | 内容 |
|---|---|
| 自动化 | `order_shipped`、`booking_success`、定制进度 3 节点、伴宠主要状态、专员回复 |
| 统一层 | `dispatchMessage` + 模板 seed + dedupe |
| 店长后台 | Tab「山海有信」：手动推送（单人/全局）、发送记录 |
| C 端 | `messageHelper` 扩展；可选「定制」筛选 |
| 部署 | 云函数 + 模板集合初始化脚本 |

### M2（2–3 周）— 策略增强

| 项 | 内容 |
|---|---|
| 待支付提醒、签收、优惠券/会员 |
| 分群推送、定时发送、失败重试 |
| 模板管理 UI、订阅消息对齐 |
| `user_push_prefs` + C 端消息设置 **【若确认】** |

### M3（可选）— ERP 与智能化

| 项 | 内容 |
|---|---|
| Web ERP 与店长模板只读同步 |
| 推送 A/B 文案、只读率看板 |
| 与推荐系统联动（上新 → 收藏该品类用户） |

---

## 12. 验收标准

### 12.1 自动化

- [ ] 店长发货后 30 秒内用户山海有信出现「已发货」，含正确运单号与跳转
- [ ] 新建预约成功后用户收到「预约已确认」，票号与门店信息正确
- [ ] 定制工单经装裱→包装→发出，用户收到 3 条进度消息且无重复
- [ ] 同一订单发货重复点击，仅 1 条 `order_shipped`（dedupe 生效）

### 12.2 运营推送

- [ ] 店长可向指定 openid 发送自定义消息，用户 1 分钟内可见
- [ ] 全局推送有二次确认、发送记录、成功/失败计数
- [ ] 运营类消息不能选择 `order`/`booking` 分类（前后端均拦截）

### 12.3 回归

- [ ] 现有订单支付/取消/退款/预约提醒消息不受影响
- [ ] 「我的」未读红点与列表一致
- [ ] `notification_logs` 可查询自动与手动发送

---

## 13. 待确认事项（已确认 2026-05-23）

| # | 决策 | 结论 |
|---|---|---|
| C1 | 全局推送频率上限 | **24h 1 次** |
| C2 | 全局推送权限 | **需 admin**（云函数环境变量 `MESSAGE_ADMIN_OPENIDS`） |
| C3 | C 端消息设置 | **M2 再做** |
| C4 | 确认收货触发 | **用户点击确认收货** → `order_received` |
| C5 | 伴宠消息分类 | **`custom`** |
| C6 | ERP vs 店长模板 | **店长先行，ERP 只读（M2 同步）** |
| C7 | 首页弱提示 | **否**，仅「我的」红点 |
| C8 | 订阅消息模板 | **运营 + 开发** 在微信后台申请（M2 对齐） |

---

## 14. 附录：与现有文档关系

- 本文档 ** supersede ** [站内信功能说明](./站内信功能说明.md) 中「待扩展」部分；v1.1 已实现能力仍以该文档为参考。
- 门店模块预约成功消息需带 `storeId` / 门店名，见 [PRD_门店模块](./PRD_门店模块.md) §6。
- 伴宠状态机完整定义见 [PRD_宠物标本定制](./PRD_宠物标本定制.md)。

---

**文档版本**：v1.0 · M1 已开发（2026-05-23）
