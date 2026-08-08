# 这有店 PRD（三期 · 共创稿）

> **文档状态**：v1.0 共创稿（基于二期实现 gap 分析 · 待产品确认后排期）  
> **模块代号**：Store Atelier / 这有店  
> **品牌**：山海造物 Nature's Creations · Museum Mode  
> **撰写日期**：2026-05-23  
> **共创说明**：文中 **【待确认】** 须产品 / 运营 / 门店 / 技术共同拍板后方可进入研发排期。

---

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 产品模块 | 这有店 Tab — 双店 O2O 前台（展陈、预约、签到、发现、转化） |
| C 端入口 | 底部 Tab「这有店」`pages/store/index`；探索页「走进这有店」卡片；商详 / 定制 / 伴宠 / AI 鉴定次级入口 |
| 关联页面 | 展陈详情 `subpackages/business/store-zone/*`、预约 `subpackages/business/booking/*`、我的预约 `subpackages/business/my-bookings/*` |
| 关联云函数 | `getStoreConfig`、`manageStoreConfig`、`getBookingAvailability`、`createBooking`、`storeCheckIn`、`sendBookingReminder`；待扩展 `dispatchMessage` / `sendInAppMessage` |
| 关联集合 | `stores`、`store_zones`、`store_booking_rules`、`store_visits`、`bookings`、`activities`、`products`；新建 `store_exhibitions` **【P2】** |
| 前置文档 | [PRD_门店模块](./PRD_门店模块.md)（M1/M2 基线）、[PRD_这有店二期优化](./PRD_这有店二期优化.md)（E1–E7）、[PRD_山海有信](./PRD_山海有信.md)、[PRD_AI标本鉴定](./PRD_AI标本鉴定.md) |
| 评审方式 | 本文档共创确认议题 → 交互线框 / 关键页面视觉稿 → 分期开发（建议 3.1–3.3 三迭代） |

### 1.1 与二期 PRD 的关系

| 文档 | 关系 |
|---|---|
| **PRD_门店模块** | M1/M2 已交付；M3 能力（签到、临展、本店有货）并入本文三期规划 |
| **PRD_这有店二期优化** | E1–E4 **大部分已在代码落地**；E5–E7 及二期验收未勾项 **纳入三期 backlog** |
| **PRD_AI标本鉴定** | 三期新增 **门店 O2O 联动**（到店确样、展陈扫码鉴定） |
| **PRD_山海有信** | 三期补齐 **门店维度公告 / 到访感谢 / 闭店通知** |

---

## 2. 背景与问题陈述

### 2.1 业务诉求

这有店模块已完成「从预约 Tab 到线下前台」的信息架构升级，并在二期研发中补齐了云配置、分店主预约、展陈深化、探索发现与轻量签到等底座。三期目标是：

1. **运营可自助** — 店长无需开发介入即可维护展陈、闭店、预约规则与门店公告。
2. **线上带动到店** — 商详、AI 鉴定、探索页与门店 Tab 形成闭环，而非孤立页面。
3. **到店可度量** — 签到、预约来源、展陈转化可进看板，支撑这有山商场联营汇报。
4. **一体两店认知** — 强化主店（山海造物）与工坊（星宸）动线，定制 / 伴宠规则产品化。

### 2.2 现状诊断（基于代码 · 2026-05-23）

#### 二期已实现 ✅

| 能力 | 实现路径 | 说明 |
|---|---|---|
| 双店切换 + 云配置 | `pages/store/index`、`getStoreConfig` | 种子降级 + 云库 merge |
| 门店基础编辑 | `manageStoreConfig` + 店长 Tab 12 | 名称、电话、intro、营业时间等 |
| 展陈详情云读 | `store-zone/index.js` | longDesc、featuredSpecies、关联商品 / 百科 |
| 分店主预约名额 | `getBookingAvailability`、`createBooking` | 读 `store_booking_rules`；满员拦截 |
| 预约切店 + 工坊锁定 | `booking/index` | `from=pet` / `from=custom` 锁定星宸 |
| 活动按店查询 | `pages/store/index.js` | DB `where({ storeId })` + fallback |
| 探索页门店卡片 | `pages/index/index.*` | LBS 距离、营业状态、「走进这有店」 |
| LBS 切店建议 | `pages/store/index.js` | Tab onShow，< 1km Sheet 提示 |
| 到店签到 FAB | `storeCheckIn` → `store_visits` | 手动签到，日限一次 |
| 展陈埋点 | `trackBehavior` | `store_zone_view`、`store_zone_to_product` 等 |
| 签到统计 | 店长 Tab 12 | 今日各店签到人次 |

#### 关键缺口 ❌

| 维度 | 现状 | 问题 |
|---|---|---|
| **后台展陈 CRUD** | API 有 `listZones` / `updateZone`，**无 UI** | 换分区封面、长文、关联 ID 仍要改库或发版 |
| **预约规则后台** | `store_booking_rules` 仅代码默认 | **闭店日历（T3）** 未落地；运营无法自助维护 |
| **闭店 C 端态** | 规则可读，门店页 **未统一置灰 CTA** | 用户可能进入预约后才失败，体验断裂 |
| **商详 O2O** | `experienceStores` **未实现** | 线上购买决策缺少「可到店鉴赏」信号 |
| **门店页转化区** | 无「店内可体验」横滑 | 展陈 → 商品链路在 Tab 内不完整 |
| **双店动线** | 无步行指引模块 | 用户不知主店与工坊如何串联 |
| **山海有信** | 预约成功有模板；**门店公告 / 到访感谢 / 闭店推送** 未做 | 二期 E6 验收未过 |
| **个人到访记录** | 签到仅落库 + 店长看 | 用户「我的」**不可见**最近到访，复访弱 |
| **扫码签到** | 二期 T2 约定三期做 | 仍仅 FAB 按钮，无法防作弊与线下物料联动 |
| **临展 / 本店有货** | 仅 PRD 预留 | 商场节点营销与现货转化未启动 |
| **AI 鉴定 O2O** | AI PRD 规划门店确样 | **未与签到 / 展陈 / 专员咨询** 打通深链 |
| **探索卡片配置** | 硬编码展示逻辑 | T4「home_configs 可配置位置」未实现 |
| **内容供给** | 种子有 longDesc | 云库 **relatedProductIds** 运营绑定不足，关联区常 fallback 模糊匹配 |

**结论**：二期完成了 **「能看、能约、能签到的 MVP+」**；三期聚焦 **「能运营、能转化、能联动、能度量」** 四段式升级。

---

## 3. 产品定位

### 3.1 一句话定位

> **这有店 = 山海造物在这有山的数字门厅 —— 先线上逛柜区，再预约到店；从 AI 鉴定到实物确样，从主店展陈到星宸工坊，一条动线把「好奇」带进店里。**

### 3.2 与相邻模块分工（三期）

| 模块 | 关系 |
|---|---|
| **探索** | 可配置门店卡片；活动 / Banner 可 deep link 至指定 `storeId` + `zoneId` |
| **馆藏 / 商详** | `experienceStores` 标注可体验门店；跳转这有店 Tab 或预约 |
| **AI 标本鉴定** | 低置信 → 预约到店确样（带 `storeId`）；到店签到后推送「现场鉴定指引」 |
| **标本定制 / 伴宠** | 预约锁定星宸；门店页工坊区块强化服务说明 |
| **山海有信** | 预约提醒、闭店公告、临展通知、到访感谢；按 `storeId` 筛选受众 |
| **店长后台** | 门店 / 展陈 / 预约规则 / 公告 / 临展（P2）一体化运营 |

### 3.3 北极星指标（建议）

| 指标 | 定义 | M1 目标 **【待确认】** |
|---|---|---|
| **门店 Tab 有效访问率** | 进入 Tab 且（切换店 / 导航 / 拨号 / 进展陈 / 发起预约）UV / 小程序 DAU | ≥ 5% |
| **探索 → 门店转化率** | 点击探索卡片 UV / 卡片曝光 UV | ≥ 15% |
| **展陈 → 商详 CTR** | `store_zone_to_product` / 展陈详情 UV | ≥ 10% |
| **预约门店来源占比** | 从门店 Tab / 展陈 CTA 创建预约 / 总预约 | ≥ 40% |
| **签到 → 7 日复访率** | 签到用户 7 日内再次打开小程序 / 签到 UV | ≥ 25% |
| **商详体验标点击率** | 点击「到店鉴赏」UV / 带标商详 UV | ≥ 8% |

---

## 4. 目标用户与核心场景

| 用户 | 场景 | 期望路径 |
|---|---|---|
| **商场导流客** | 这有山逛街，搜小程序 | 探索卡片 → 门店 Tab → 看展陈 → 导航到店 |
| **种草买家** | 在馆藏看到标品，想先看实物 | 商详「主店可体验」→ 预约 / 导航 |
| **AI 鉴定用户** | 线上识别不确定 | 结果页「预约标本师确样」→ 星宸预约 → 签到 |
| **定制 / 伴宠客户** | 需到工坊交接 | 订单页 → 预约（锁定星宸）→ 行前提醒含地址 |
| **运营** | 十一闭店、矿物临展 | 后台设闭店日 + 推送公告 → C 端 Hero 店休态 |
| **店长** | 看今日到店与预约 | 后台看板：签到、预约来源、展陈点击 |

---

## 5. 功能范围与优先级

### 5.1 总览

| 代号 | 名称 | 优先级 | 建议迭代 |
|---|---|---|---|
| **F1** | 运营后台闭环（展陈 + 预约规则 + 闭店） | **P0** | 3.1 |
| **F2** | 闭店 / 可约态 C 端一致体验 | **P0** | 3.1 |
| **F3** | 商业转化（商详体验标 + 门店体验区） | **P0** | 3.2 |
| **F4** | 山海有信门店触达 | **P1** | 3.2 |
| **F5** | 扫码签到 + 个人到访记录 | **P1** | 3.2 |
| **F6** | 双店动线 + 探索卡片可配置 | **P1** | 3.2 |
| **F7** | AI 鉴定 × 门店 O2O 联动 | **P1** | 3.3 |
| **F8** | 店长看板与埋点验收 | **P1** | 3.3 |
| **F9** | 临展 · 本店有货 · AR | **P2** | 3.4（按需） |

**本次共创建议研发范围**：**P0 + P1**（F1–F8）；F9 仅完成数据模型与 UI 预留，不对接 ERP **【待确认】**。

---

### 5.2 F1 · 运营后台闭环（P0 · 3.1）

#### 5.2.1 展陈分区管理 UI

**入口**：店长后台 Tab「门店管理」→ 选中门店 →「管理展陈分区」

| 功能 | 说明 |
|---|---|
| 分区列表 | 按 `sort` 展示；状态 active / hidden |
| 分区编辑 | title、overline、desc、longDesc、coverImage、images[]、categoryTag、relatedProductIds、relatedWikiIds、featuredSpecies |
| 图片上传 | 走现有云存储上传组件；封面必填 |
| 预览 | 保存后提示「C 端下拉刷新可见」 |

**云函数**：沿用 `manageStoreConfig` — `listZones` / `updateZone`；可选新增 `createZone` / `hideZone` **【待确认：是否允许新增自定义 zoneId】**。

#### 5.2.2 预约规则与闭店日历

**入口**：店长后台 → 门店管理 →「预约规则」

| 功能 | 说明 |
|---|---|
| 时段模板 | 编辑 `visitSlots[]`（start、end、capacity） |
| 闭店日历 | 多选日期写入 `closedDates[]`；支持「复制到另一店」 |
| 提前预约 | `advanceDays`、`minAdvanceHours` |
| 法定假模板 | 一键导入国庆 / 春节等 **【待确认：是否做法定假预设库】** |

**云函数**：扩展 `manageStoreConfig` 或新增 `manageBookingRules` — `getRules` / `updateRules`。

#### 5.2.3 门店封面与坐标

| 字段 | 说明 |
|---|---|
| coverImage | 探索卡片、门店 Hero 共用 |
| latitude / longitude | LBS 与导航；后台可编辑 **【待确认：是否仅允许地图选点】** |

**验收**：

- [ ] 运营可在后台修改至少 1 个分区 longDesc + 3 个 relatedProductIds，C 端展陈详情可见
- [ ] 运营设置明日闭店，门店页与预约页当日不可约且文案一致
- [ ] 修改主店 coverImage 后，探索卡片 5 分钟内更新（含缓存策略）

---

### 5.3 F2 · 闭店 / 可约态 C 端体验（P0 · 3.1）

| 页面 | 行为 |
|---|---|
| `pages/store/index` | 闭店日 Hero 显示「今日店休」；预约 CTA 置灰 + 说明；拨号 / 导航仍可用 |
| `booking/index` | 日期选择器禁选闭店日；时段列表为空时友好提示 |
| `my-bookings` | 卡片展示 storeName + 地址摘要（若二期未全量补齐则本期必做） |

**逻辑复用**：`getBookingAvailability` 返回 `isClosedToday`、`closedReason`（可选，来自运营备注）。

**验收**：

- [ ] 闭店日无法提交预约（前后端双重校验）
- [ ] 非闭店日满员时段不可选，与 createBooking 错误码一致

---

### 5.4 F3 · 商业转化（P0 · 3.2）

#### 5.4.1 商详 · 本店可体验

| 项 | 说明 |
|---|---|
| 字段 | `products.experienceStores: ['store_shanhaizaowu' \| 'store_xingchen']` |
| 展示 | 商详信息区铜牌小条：「山海造物 · 山腰 可现场鉴赏」/ 「星宸标本工作室 可现场鉴赏」 |
| 交互 | 点击 → `switchTab` store 并切换对应店，或跳转预约 `storeId=` |
| ERP | 字段由商品运营在店长后台或 ERP 维护 **【待确认维护入口】** |

#### 5.4.2 门店 Tab · 店内可体验

| 项 | 说明 |
|---|---|
| 位置 | 展陈网格下方 |
| 数据 | 当前 `storeId` 下 `experienceStores` 包含该店的商品，最多 6 件 |
| 样式 | 横向滚动 Museum 卡片，非货架促销风 |

#### 5.4.3 展陈详情 CTA 补全

| CTA | 跳转 |
|---|---|
| 「预约参观此区域」 | `booking/index?storeId=&zoneId=`（统计预约来源） |
| 「用 AI 识别此柜物种」 | `pages/identify/index?from=store&zoneId=` **【P1，与 F7 联动】** |

**验收**：

- [ ] 至少 10 个 SKU 配置 experienceStores，商详可见体验标
- [ ] 门店页「店内可体验」与商详跳转闭环可追踪埋点

---

### 5.5 F4 · 山海有信门店触达（P1 · 3.2）

| 事件 | 触发 | 模板 / 类型 | 变量 |
|---|---|---|---|
| 到访感谢 | `storeCheckIn` 成功 | `store_visit_thanks` **【新建】** | storeName、visitTips 摘要 |
| 闭店公告 | 运营推送 | `store_announcement` **【新建】** | title、content、storeId、actionUrl |
| 预约成功 | 已有 | `booking_success` | 补齐 storeName、地址、导航 scheme **【若未全量则本期验收】** |
| 行前提醒 | `sendBookingReminder` | `booking_reminder` | 按 booking.storeId 取店信息 |
| 临展上线 | F9 发布 | `store_exhibition_live` | exhibitionTitle、storeName **【P2】** |

**受众规则**：

| 公告类型 | 受众 **【待确认】** |
|---|---|
| 闭店通知 | 该店未来 7 日有预约用户 + 30 日内签到用户 |
| 临展 | 同上 + 全量订阅活动类用户 **【P2】** |

**验收**：

- [ ] 签到成功后 30 秒内收到感谢信（可配置开关）
- [ ] 闭店公告推送后，目标用户站内信可见且跳转门店页带 `storeId`

---

### 5.6 F5 · 扫码签到 + 个人到访（P1 · 3.2）

#### 5.6.1 店码扫码签到（二期 T2 三期交付）

| 项 | 说明 |
|---|---|
| 物料 | 每店独立小程序码，scene = `storeId` **【待确认：是否分 zone 细码】** |
| 入口 | 微信扫一扫 → 小程序 `pages/store/index?from=scan&storeId=` 自动触发签到 |
| 逻辑 | `storeCheckIn` 增加 `source: 'scan'`；校验 scene 与当前店一致 |
| 与 FAB 关系 | 扫码成功则 FAB 显示「今日已签到」；FAB 仍保留 manual 入口 |

#### 5.6.2 我的 · 最近到访

| 项 | 说明 |
|---|---|
| 入口 | 「我的」资产区或门店相关菜单「到访记录」 |
| 数据 | 最近 10 条 `store_visits` + storeName |
| 联动 | 可「再次预约」「查看该店展陈」 |

**验收**：

- [ ] 扫主店店码完成签到，店长看板 +1，与 FAB 互斥日限一次
- [ ] 用户可在「我的」看到最近到访门店列表

---

### 5.7 F6 · 双店动线 + 探索可配置（P1 · 3.2）

#### 5.7.1 一体两店步行指引

| 项 | 说明 |
|---|---|
| 位置 | 门店 Tab 底部或双店切换 Sheet 内链接 |
| 内容 | 1 屏图文：主店 → 工坊步行约 X 分钟、楼层对照、适合办什么事在哪店 |
| 数据 | `stores[].walkingGuide` 富文本或结构化 steps **【待确认内容谁维护】** |

#### 5.7.2 探索页门店卡片可配置

| 项 | 说明 |
|---|---|
| 配置 | `home_configs.modules.exploreStore`：enabled、position（`top` \| `middle` \| `bottom`）、defaultStoreId |
| 默认 | enabled=true，position=middle（对齐二期 T4 结论） |

**验收**：

- [ ] 后台关闭 exploreStore 模块后，探索页不展示卡片
- [ ] 步行指引可从主店页一键打开且含工坊地址

---

### 5.8 F7 · AI 鉴定 × 门店 O2O（P1 · 3.3）

| 场景 | 路径 |
|---|---|
| 低置信确样 | 鉴定结果页 CTA「预约到店确样」→ `booking?from=identify&storeId=store_xingchen` |
| 展陈好奇 | 展陈详情「AI 识别此柜」→ 鉴定页带 `zoneId` 品类 hint |
| 到店后 | 签到成功可选推送：「欢迎用 AI 鉴定记录你的探馆物种」→ identify |
| 专员咨询 | `getSupportConfig?storeId=` 展示当前店 FAQ **【扩展】** |

**埋点**：`identify_to_booking`、`store_zone_to_identify`、`store_checkin_to_identify`。

**验收**：

- [ ] 从鉴定结果跳转预约，来源参数可被 createBooking 记录
- [ ] 展陈进入鉴定时品类 hint 与 zone.categoryTag 一致

---

### 5.9 F8 · 店长看板与埋点验收（P1 · 3.3）

#### 5.9.1 看板指标（Tab 12 扩展或独立「门店数据」）

| 指标 | 周期 |
|---|---|
| 门店 Tab PV / UV | 7 天 |
| 探索卡片点击 | 7 天 |
| 导航 / 电话点击 | 7 天，分 storeId |
| 预约创建来源 | store_tab / explore / product / identify / custom / pet |
| 展陈详情 UV | 分 zoneId |
| 签到人数 | 日 / 周，分 storeId |

#### 5.9.2 埋点清单（二期 E6 补验收）

| 事件 | 状态 |
|---|---|
| `store_zone_view` | 已有，验收上报 |
| `store_zone_to_product` / `_wiki` | 已有，验收 |
| `store_checkin` | 已有，验收 |
| `store_lbs_suggest_accept` | 已有，验收 |
| `explore_store_card_click` | 已有，验收 |
| `product_experience_store_click` | **新增** |
| `store_walking_guide_view` | **新增** |

**验收**：

- [ ] 看板数值与 `user_behaviors`（或现有埋点表）T+1 一致，误差 **【待确认阈值】** < 5%

---

### 5.10 F9 · 临展 · 本店有货 · AR（P2 · 3.4 按需）

> 与二期 E7 一致；**不对接 ERP 前仅做只读 Mock 或手工维护库存字段**。

| 功能 | 说明 |
|---|---|
| `store_exhibitions` | 时间范围、封面、关联 zone、单店展示；Hero 临展条 + 分区角标「临展中」 |
| 本店有货 | `products.storeStock.{storeId}` 或 ERP 同步 **【待确认数据源】** |
| AR 导览 | 扫描柜区 marker，复用 AR 分包 **【P3，不在三期必交付】** |

---

## 6. 信息架构（三期增量）

```
这有店 Tab
├── 门店切换器
├── Hero（营业 / 店休 / 临展条【P2】）
├── 快捷服务（预约 / 导航 / 电话 / 联系专员）
├── 展陈网格 → store-zone 详情
│   ├── 长文 + 铜牌物种
│   ├── 关联藏品 / 百科
│   └── CTA：预约参观 · AI 识别【F7】
├── 店内可体验【F3 新增】
├── 门店活动（按 storeId）
├── 双店步行指引【F6】
└── 签到 FAB / 扫码自动签到【F5】

店长后台 · 门店管理【F1 扩展】
├── 门店编辑（含封面 / 坐标）
├── 展陈分区 CRUD
├── 预约规则 + 闭店日历
├── 门店公告推送【F4】
├── 临展管理【P2】
└── 门店数据看板【F8】

我的
└── 最近到访【F5】
```

---

## 7. 数据模型变更

| 集合 | 变更 |
|---|---|
| `stores` | + `walkingGuide`、`latitude`、`longitude`（若尚未入库） |
| `store_zones` | 运营 via 后台维护；字段同二期 |
| `store_booking_rules` | 后台可写；种子默认保留 |
| `store_visits` | + `source: 'scan'`、`scene`；索引 openid + storeId + 日 |
| `store_exhibitions` | **P2 新建** |
| `products` | + `experienceStores[]`；可选 + `storeStock` **【P2】** |
| `bookings` | + `source`（store_tab / explore / identify / zone 等） **【待确认字段名】** |
| `home_configs` | + `exploreStore` 模块配置 |
| `message_templates` | + `store_visit_thanks`、`store_announcement` |

---

## 8. 非功能需求

| 类型 | 要求 |
|---|---|
| 性能 | 门店 Tab 首屏 < 2s；`getStoreConfig` 本地缓存 1h，下拉强制刷新 |
| 权限 | 后台写操作校验 admin；店码 scene 防伪造 **【待确认：是否加签】** |
| 降级 | 云函数失败 → 种子数据；规则缺失 → 默认 slots + 无闭店 |
| 体验 | 全流程 Museum Mode；闭店 / 店休不用促销 Banner |
| 兼容 | 微信基础库 ≥ 2.19；iOS / Android 双端验收 |

---

## 9. 里程碑与排期建议

| 阶段 | 周期 | 交付 | 依赖 |
|---|---|---|---|
| **3.1** | 2 周 | F1 后台闭环 + F2 闭店 C 端态 | 运营提供闭店规则、分区商品 ID |
| **3.2** | 2–3 周 | F3 商业转化 + F4 消息 + F5 扫码签到 + F6 动线 / 探索配置 | 山海有信模板审核、店码物料 |
| **3.3** | 2 周 | F7 AI O2O + F8 看板验收 + 文档 / SOP | AI 鉴定已上线、埋点表稳定 |
| **3.4** | 按需 | F9 临展 / 本店有货 | ERP 接口 **【待确认】** |

### 9.1 阶段 3.1 开发任务清单（可拆 Issue）

| # | 任务 | 路径 / 说明 |
|---|---|---|
| 1 | 展陈分区管理 UI | `subpackages/business/manager` |
| 2 | 预约规则 + 闭店日历 UI | manager + `manageBookingRules` 或扩展 `manageStoreConfig` |
| 3 | 门店页 / 预约页闭店态 | `pages/store/*`、`booking/*` |
| 4 | my-bookings 门店信息 | `my-bookings/*` |
| 5 | 门店 cover / 坐标编辑 | manager + `stores` 集合 |

---

## 10. 共创议题（待确认）

| # | 议题 | PRD 建议 | 状态 |
|---|---|---|---|
| **S1** | 三期研发范围 | P0+P1（F1–F8）；F9 仅预留 | **【待确认】** |
| **S2** | 店码粒度 | 每店 1 码 vs 每 zone 1 码 | 建议 **每店 1 码**（3.2）；zone 码放 P2 |
| **S3** | scene 安全 | 纯 storeId vs 带签名防伪造 | 建议 **一期纯 storeId**，刷单靠日限 |
| **S4** | experienceStores 维护入口 | ERP vs 店长后台商品编辑 | 建议 **店长后台 Tab 商品快捷勾选** |
| **S5** | 闭店公告受众 | 仅预约用户 vs 含签到用户 | 建议 **预约 + 30 日签到** |
| **S6** | 到访感谢信 | 默认开启 vs 运营可关 | 建议 **默认开启，后台可关** |
| **S7** | 确样默认门店 | AI 低置信跳转哪家 | 建议 **星宸工坊**（标本师驻场） |
| **S8** | 探索卡片 defaultStoreId | 固定主店 vs LBS 最近 | 建议 **主店默认，有 LBS 时展示最近** |
| **S9** | 本店有货数据源 | 手工字段 vs ERP | **三期不对接**，F9 再议 |
| **S10** | 看板误差阈值 | T+1 对齐埋点 | 建议 **±5%** |

---

## 11. 验收标准（三期总览）

### 11.1 功能

- [ ] 运营可在后台维护展陈、闭店、预约规则，C 端 5 分钟内生效
- [ ] 闭店日门店页与预约链路一致不可约
- [ ] 商详体验标 + 门店「店内可体验」可闭环跳转
- [ ] 签到（FAB + 扫码）产生 visit，用户「我的」可见记录
- [ ] 门店公告 / 到访感谢站内信可达且 deep link 正确
- [ ] AI 鉴定 → 预约确样来源可统计
- [ ] 店长看板核心指标准确 **【S10】**

### 11.2 体验

- [ ] Museum Mode 一致；无店休促销风
- [ ] 导航 / 预约 / 展陈 / 商详路径 ≤ 3 次点击
- [ ] 弱网下降级不白屏

### 11.3 文档

- [ ] 更新 [PRD_门店模块](./PRD_门店模块.md) M3 状态
- [ ] 更新 [产品使用手册](./产品使用手册.md) 这有店 / 店长门店管理章节
- [ ] 店码物料说明 + 闭店 SOP

---

## 12. 风险与依赖

| 风险 | 缓解 |
|---|---|
| 展陈关联商品 ID 供给不足 | 3.1 前运营完成至少 4 区 × 3 SKU 绑定清单 |
| 店码张贴滞后 | 3.2 可先上 FAB，扫码与物料并行 |
| 消息模板审核周期 | 3.2 启动前提交 `store_visit_thanks` / `store_announcement` |
| manager 分包体积 | 展陈 / 规则 UI 可考虑独立子页，避免单文件膨胀 |
| ERP 未就绪 | F9 不阻塞三期；本店有货用运营手工字段 Mock |

**外部依赖**：这有山商场导视名称核对；星宸 / 主店步行指引文案；山海有信模板微信审核。

---

## 13. 附录

### 13.1 代码映射（三期 touch）

| 能力 | 现有路径 | 三期改动 |
|---|---|---|
| 门店 Tab | `pages/store/index.*` | 店休态、体验区、步行指引、临展条【P2】 |
| 展陈详情 | `subpackages/business/store-zone/*` | AI 入口、预约 CTA 带来源 |
| 预约 | `subpackages/business/booking/*` | 闭店禁选、source 字段 |
| 商详 | 商品详情页 **【待统一路径】** | experienceStores 展示 |
| 探索 | `pages/index/index.*` | home_configs 驱动卡片 |
| 鉴定 | `pages/identify/*` | 确样 CTA、zone hint |
| 店长后台 | `subpackages/business/manager/*` | 展陈 / 规则 / 公告 / 看板 |
| 消息 | `dispatchMessage`、`sendInAppMessage` | 门店模板 |
| 签到 | `cloudfunctions/storeCheckIn` | scan 来源 |

### 13.2 二期 → 三期 gap 速查

| 二期项 | 二期状态 | 三期归属 |
|---|---|---|
| E1 运营可配置 | 门店编辑有，展陈 UI 无 | F1 |
| E2 预约分店主 | 云函数有，闭店 UI / C 端态不全 | F1 + F2 |
| E3 展陈深化 | 代码有，内容 / CTA 不全 | F1 + F3 + F7 |
| E4 探索 / LBS / 签到 | 基本完成 | F5 扫码 + F6 配置 |
| E5 商业联动 | 未做 | F3 |
| E6 消息看板 | 未做 | F4 + F8 |
| E7 临展 / 有货 | 未做 | F9 |

### 13.3 相关文档

- [PRD_这有店二期优化](./PRD_这有店二期优化.md)  
- [PRD_门店模块](./PRD_门店模块.md)  
- [PRD_山海有信](./PRD_山海有信.md)  
- [PRD_AI标本鉴定](./PRD_AI标本鉴定.md)  
- Design System — `.cursorrules`  

---

*山海造物 Nature's Creations — 把山海带回家*  
*PRD v1.0 · 这有店三期 · 2026-05-23（共创稿）*
