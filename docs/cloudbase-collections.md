# CloudBase 集合初始化清单与权限规则

> 环境：`cloud1-8gnkty5bfff9f0bf`（上海 `ap-shanghai`）  
> 控制台：[腾讯云云开发](https://console.cloud.tencent.com/tcb)  
> 相关文档：[admin-a1-cloudbase.md](./admin-a1-cloudbase.md)（财务同步专项）

---

## 一、上线前必做（全局）

| 步骤 | 路径 | 说明 |
|------|------|------|
| 1 | 设置 → 安全配置 → **Web 安全域名** | 添加 `localhost:5173`、`localhost:5178`、`localhost:4321`、`shanhaizaowu.com`、`www.shanhaizaowu.com` |
| 2 | 设置 → 登录授权 → **匿名登录** | 开启（Web ERP 使用 `signInAnonymously`） |
| 3 | 设置 → 登录授权 → **微信小程序** | 保持与小程序 AppID 绑定 |
| 4 | 数据库 → 新建集合 | 见下方清单 |
| 5 | 各集合 → 权限设置 | 粘贴 `cloudbase/rules/` 中对应 JSON |
| 6 | 验证 | 打开 `/admin/cloud-check.html` 或 ERP 小程序配置页点「刷新」 |

**常见报错对照**

| 控制台/页面提示 | 原因 | 处理 |
|----------------|------|------|
| `collection not found` / `-502005` | 集合未创建 | 新建集合 |
| `permission` / `-502004` | 权限过严或未登录 | 开启匿名登录 + 放宽规则 |
| `domain` / `-502003` | Web 域名未白名单 | 加安全域名 |
| ERP「加载 xxx 失败」 | 上述任一 + 集合为空 | 建集合后，在 ERP 页保存一次以写入默认数据 |

---

## 二、集合清单（按优先级）

### P0 · ERP 小程序配置（近期报错相关）

> 在控制台 **数据库 → 新建集合**，名称必须完全一致（小写 + 下划线）。

| 集合名 | 用途 | ERP 模块 | 小程序侧 | 初始数据 |
|--------|------|----------|----------|----------|
| `home_configs` | 首页模块编排 | 小程序配置 → 首页配置 | `getHomeConfig` 云函数 | ERP 新建一条配置即可 |
| `member_levels` | 会员等级 | 会员等级体系 | 会员中心 | 无数据时 ERP 显示默认 5 级，保存后入库 |
| `configs` | 通用 KV 配置 | 会员成长值规则 | — | 文档 ID：`member_growth_rules` · `feishu_bitable` · `b2b_catalog` |
| `points_rules` | 积分规则 | 积分规则配置 | `earnPoints` 等 | ERP 保存一次 |
| `booking_rules` | 预约规则 | 预约规则配置 | 预约流程 | ERP 保存一次 |
| `marketing_rules_config` | 营销全局规则 | 活动营销规则 | 秒杀/拼团/券 | 文档 ID：`seckill` / `group_buy` / `coupon` |
| `notification_templates` | 消息模板 | 通知消息配置 | `dispatchMessage` | ERP 首次打开可自动初始化默认模板 |
| `notification_logs` | 发送日志 | 通知消息配置 → 日志 | 云函数写入 | 可为空 |
| `admin_roles` | 管理员角色 | 权限管理 | — | 可为空 |
| `admin_users` | 管理员账号 | 权限管理 | — | 可为空 |
| `admin_operation_logs` | 操作审计 | 权限管理 → 操作日志 | — | 可为空 |
| `admin_login_logs` | 登录审计 | 权限管理 → 登录日志 | — | 可为空 |

**`configs` 集合说明**：会员成长值存在固定文档 `member_growth_rules`；飞书表映射为 `feishu_bitable`；B2B 供货价目为 `b2b_catalog`（Admin「报价单配置」发布或订货履约「同步价目」写入，店长端 `listCatalog` 优先读取）。

**`marketing_rules_config` 文档 ID**（可选预置，或在 ERP 各 Tab 点保存）：

| `_id` | 含义 |
|-------|------|
| `seckill` | 秒杀规则 |
| `group_buy` | 拼团规则 |
| `coupon` | 优惠券规则 |

---

### P1 · ERP 小程序配置（扩展）

| 集合名 | 用途 | ERP 模块 |
|--------|------|----------|
| `achievement_configs` | 成就定义 | 成就系统配置 |
| `user_behavior_config` | 埋点类型/全局开关 | 用户行为追踪配置 |
| `recommend_algorithm_config` | 推荐算法 | 推荐算法配置（文档 ID：`default`） |
| `search_hot_keywords` | 热搜词 | 搜索关键词管理 |
| `search_blacklist` | 搜索黑名单 | 搜索关键词管理 |
| `report_templates` | 自定义报表 | 报表构建器 |
| `store_design_versions` | 门店设计版本 | 门店设计中心 |
| `store_design_materials` | 标准物料库 | 门店设计中心（可选） |

---

### P2 · 财务与店长（见 admin-a1-cloudbase.md）

| 集合名 | 用途 |
|--------|------|
| `finance_records` | Web 财务日账本 |
| `finance_settings` | 财务全局设置 |
| `store_ledger` | 店长小程序账本 |

规则文件已存在：`cloudbase/rules/finance_records.json` 等。

---

### P3 · 核心业务（内容 / 交易 / 用户）

| 集合名 | 用途 |
|--------|------|
| `products` | 商品/藏品 |
| `categories` | 分类树 |
| `cms_wikis` | 百科/专题 |
| `articles` | 社区文章 |
| `curated_collections` | 专题展览 |
| `framers` | 名师手作 |
| `banners` | 轮播图 |
| `activities` | 活动 |
| `orders` | 订单 |
| `users` | 用户 |
| `bookings` | 预约 |
| `coupons` | 优惠券模板 |
| `user_coupons` | 用户持有的券 |
| `collections` | 购物车/收藏 |
| `collection_folders` | 收藏夹分组 |
| `user_collection` | 用户馆藏（部分页面） |
| `comments` | 评论 |
| `refunds` | 退款单 |
| `rewards` | 积分兑换奖品 |
| `point_records` | 积分流水 |

---

### P4 · 运营 / 客服 / 定制

| 集合名 | 用途 |
|--------|------|
| `support_tickets` | 客服工单 |
| `support_configs` | 客服入口配置（`getSupportConfig`；Admin「客服入口配置」`56`）；CLI：`npm run provision:miniapp-ops` |
| `content_display_flags` | 内容展示开关（`getContentDisplayFlags`；Admin「内容展示开关」`62`；默认关闭标本档案/山海社区）；CLI：`npm run provision:miniapp-ops` |
| `shipping_rules` | 商城运费/包邮规则（`getShippingRules` / `makeOrder`；Admin「运费与包邮规则」`61`） |
| `custom_inquiries` | 定制咨询 |
| `purchase_intents` | 官网报价单采购意向（`/price-list` 提交；ERP「采购意向」）；规则见 `cloudbase/rules/purchase_intents.json`，字段见 `cloudbase/schema/purchase_intents.md`；CLI：`cd admin && node scripts/provision-purchase-intents.mjs` |
| `price_list_items` | 官网线下供货报价条目（`/price-list` 运行时读；Admin「报价单配置」`57`）；规则见 `cloudbase/rules/price_list_items.json`，字段见 `cloudbase/schema/price_list_items.md`；CLI：`cd admin && npm run provision:price-list` |
| `custom_drafts` | 定制草稿 |
| `pet_memorial_orders` | 伴宠记忆订单 |
| `pet_craft_configs` | 伴宠工艺配置（`getPetMemorialConfig`；Admin 伴宠 → 工艺配置） |
| `care_guides` | 养护指南（`getCareGuides`；Admin「养护指南」）；CLI：`npm run provision:miniapp-ops` |
| `stores` | C 端门店主数据（`getStoreConfig`；Admin「C端门店展区」；≠ ERP 店铺合规档案） |
| `store_zones` | C 端展区动线 |
| `rewards` | 积分兑换品（`redeemReward`；Admin 权益与营销 → 积分兑换） |
| `user_behaviors` | 用户行为埋点 |
| `analytics_daily` | 日聚合统计 |
| `user_messages` | 站内消息 |
| `message_templates` | 云函数消息模板（与 ERP `notification_templates` 可并存） |
| `waitlist` | 预约候补（Admin「预约与核销 → 候补队列」） |
| `booking_reminders` | 预约提醒记录 |
| `store_visits` | 到店签到 |
| `user_addresses` | 收货地址 |
| `identification_records` | 鉴定记录 |
| `user_audiences` | 用户分群 |
| `audience_campaigns` | 分群营销 |
| `property_proposals` | 资产提案 |
| `strategy_research` | 战略调研 |
| `benchmark_research_docs` | 对标研究文档库（PDF/MD 全文检索；Admin 战略调研看板） |

---

### P5 · 订货履约与成品库存（P0 进行中）

> 蓝图：[`admin/docs/订货履约与成品库存_Phase1_技术蓝图.md`](../admin/docs/订货履约与成品库存_Phase1_技术蓝图.md) · [`admin/docs/飞书多维表对接_技术蓝图.md`](../admin/docs/飞书多维表对接_技术蓝图.md)  
> 边界：飞书管原材料采购/库存；Admin 管总部成品仓 + 门店/渠道订货出货。两边通过映射同步，禁止无映射双写。

| 集合名 | 用途 | 状态 | 主写入口 |
|--------|------|------|----------|
| `purchase_orders` | 正式订货单（自营店 / 渠道履约） | **P0 已建**；CLI：`cd admin && node scripts/provision-purchase-orders.mjs` | 店长直连集合 / Admin 订货履约 |
| `fulfillment_shipments` | 总部→门店/渠道出货单 | **P1 已建**；CLI：`cd admin && node scripts/provision-fulfillment-p1.mjs` | Admin 出货 / 云函数 `ship`；可回写飞书出货表 |
| `stock_movements` | 总部成品库存流水（`warehouseId=hq`） | **P1 已建**（同上 CLI） | 出货扣库自动写入；飞书「应用库存」记 `feishu_pull` |
| `feishu_purchases` | 飞书采购镜像（只读） | **对接已建**；CLI：`cd admin && node scripts/provision-feishu-bridge.mjs` | 云函数 `syncFeishuBitable` pull |
| `feishu_inventory` | 飞书库存镜像（只读） | 同上 | 同上；人工确认后可应用到 `products.stock` |
| `feishu_sync_logs` | 飞书同步审计 | 同上 | Admin `/api/feishu-sync` 代理每次动作追加 |
| `custom_configs` | 标本定制选项（框型/包装） | 待建；规则 [`custom_configs.json`](../cloudbase/rules/custom_configs.json) | Admin 定制工坊 / 店长后台 / `getCustomConfig` |

与现有关系：`purchase_intents` 可一键转为 `purchase_orders`；仓存数量仍落在 `products.stock`，流水表追加追溯。B2B 供货价目可写入 `configs/b2b_catalog`（Admin「同步价目」）。飞书 Base：`WCs2bnIHsaty7vsjcnaczu0Wnod`。

---

## 三、权限规则模板

规则 JSON 放在 [`cloudbase/rules/`](../cloudbase/rules/)，在控制台 **数据库 → 集合 → 权限设置 → 自定义安全规则** 中粘贴。

### 模板 A · 匿名可读写（A1 快速上线，与财务集合一致）

**适用**：ERP 后台配置类集合、财务集合、当前阶段全部管理端写入场景。

```json
{
  "read": "auth != null",
  "write": "auth != null"
}
```

> Web ERP：匿名登录后 `auth != null`。  
> 小程序：微信登录后同样满足。  
> **安全说明**：A1 依赖 ERP 前端口令，云库侧不做角色隔离；上线后应迁移到模板 B/C。

**已提供文件**（直接复制到控制台）：

| 文件 | 集合 |
|------|------|
| `_template_anonymous_rw.json` | 通用模板（参考用） |
| `home_configs.json` | `home_configs` |
| `member_levels.json` | `member_levels` |
| `configs.json` | `configs` |
| `points_rules.json` | `points_rules` |
| `booking_rules.json` | `booking_rules` |
| `marketing_rules_config.json` | `marketing_rules_config` |
| `notification_templates.json` | `notification_templates` |
| `notification_logs.json` | `notification_logs` |
| `admin_roles.json` | `admin_roles` |
| `admin_users.json` | `admin_users` |
| `admin_operation_logs.json` | `admin_operation_logs` |
| `admin_login_logs.json` | `admin_login_logs` |
| `achievement_configs.json` | `achievement_configs` |
| `user_behavior_config.json` | `user_behavior_config` |
| `recommend_algorithm_config.json` | `recommend_algorithm_config` |
| `search_hot_keywords.json` | `search_hot_keywords` |
| `search_blacklist.json` | `search_blacklist` |
| `finance_records.json` | `finance_records` |
| `finance_settings.json` | `finance_settings` |
| `store_ledger.json` | `store_ledger` |
| `care_guides.json` | `care_guides` |
| `stores.json` | `stores` |
| `store_zones.json` | `store_zones` |
| `pet_craft_configs.json` | `pet_craft_configs` |
| `rewards.json` | `rewards` |
| `waitlist.json` | `waitlist` |
| `support_configs.json` | `support_configs` |
| `content_display_flags.json` | `content_display_flags` |
| `price_list_items.json` | `price_list_items` |

---

### 模板 B · 配置只读公开 + 管理端可写（A2 可选）

小程序未登录也需要读首页/等级等配置时使用：

```json
{
  "read": true,
  "write": "auth != null"
}
```

**注意**：`write: auth != null` 在 A1 下仍允许任意匿名用户写入，需配合 **自定义登录 + 管理员 UID 白名单** 才有意义。

---

### 模板 C · 用户数据按 openid 隔离（A2+ 推荐）

**适用**：`orders`、`users`、`collections`、`user_coupons`、`user_addresses` 等。

```json
{
  "read": "auth != null && (doc._openid == auth.openid || doc._openid == auth.uid)",
  "write": "auth != null && (doc._openid == auth.openid || doc._openid == auth.uid)"
}
```

> 小程序 openid 字段名可能是 `_openid`；Web 匿名用户无 openid，管理端改写应走 **云函数** 或 **管理员自定义登录**，不要对业务集合使用纯匿名直写。

---

### 模板 D · 仅云函数读写（高敏感）

**适用**：支付回调写入、消息派发等仅云函数访问的集合。

控制台选 **「仅管理端/云函数可读写」**，或：

```json
{
  "read": false,
  "write": false
}
```

客户端通过 `wx.cloud.callFunction` 访问。若 ERP 也要读，改为模板 A 或单独建 `*_admin` 镜像集合。

---

## 四、推荐索引（数据量增大后添加）

| 集合 | 索引字段 | 排序 | 说明 |
|------|----------|------|------|
| `finance_records` | `date` | 降序 | 财务按日查询 |
| `home_configs` | `priority`, `_updateTime` | 降序, 降序 | ERP 列表排序 |
| `notification_logs` | `sentAt` | 降序 | 日志分页 |
| `notification_templates` | `category`, `code` | 升序, 升序 | 可选（ERP 已客户端排序） |
| `admin_operation_logs` | `timestamp` | 降序 | 操作日志 |
| `admin_login_logs` | `timestamp` | 降序 | 登录日志 |
| `user_behaviors` | `timestamp` 或 `createTime` | 降序 | 行为分析 |
| `orders` | `createTime` | 降序 | 订单列表 |
| `orders` | `status`, `createTime` | — | 待发货筛选 |
| `bookings` | `createTime` | 降序 | 预约列表 |
| `point_records` | `createTime` | 降序 | 积分流水 |

索引路径：**数据库 → 集合 → 索引管理 → 添加**。未建索引时，复杂 `orderBy` + `where` 可能报错；当前 ERP 财务/通知模块已在代码侧做了降级处理。

---

## 五、P0 集合快速验收清单

按顺序在 ERP 中验证（需先 `cd admin && npm run build` 并刷新页面）：

- [ ] **首页配置**：能加载列表；新建/保存一条 `home_configs`
- [ ] **会员等级**：能加载；保存等级 + 成长值规则（写入 `member_levels` + `configs/member_growth_rules`）
- [ ] **积分规则**：加载 + 保存（`points_rules`）
- [ ] **预约规则**：加载 + 保存（`booking_rules`）
- [ ] **活动营销规则**：三个 Tab 均可保存（`marketing_rules_config`）
- [ ] **通知消息配置**：模板列表加载；日志 Tab 选日期范围后查询（`notification_templates` + `notification_logs`）
- [ ] **权限管理**：角色/用户列表加载（`admin_roles` + `admin_users`）

全部通过即 P0 配置链路就绪。

---

## 六、批量创建集合（脚本优先）

环境：`cloud1-8gnkty5bfff9f0bf`。在 `admin/.env` 配置腾讯云 API 密钥（`TCB_SECRET_ID` / `TCB_SECRET_KEY`，见 `admin/.env.example`，**勿提交**）。

```bash
# 一条命令：幂等建齐仓库已登记的业务集合 + 部署 cloudbase/rules
cd admin && npm run provision:all

# 仅小程序运营对齐（care_guides / stores / store_zones / pet_craft_configs / rewards / waitlist / support_configs）
cd admin && npm run provision:miniapp-ops

# 不写库，只列出任务
cd admin && npm run provision:all:dry
```

| npm script | 脚本 | 说明 |
|------------|------|------|
| `provision:all` | `scripts/provision-all.mjs` | 统一入口（内容工厂、订货、飞书、小程序运营等） |
| `provision:miniapp-ops` | `scripts/provision-miniapp-ops.mjs` | 本轮 6 集合 |
| `provision:content` 等 | 各 `provision-*.mjs` | 分域脚本（仍可单独跑） |

共用逻辑：`admin/scripts/lib/cloudbaseProvision.mjs`（`createCollectionIfNotExists` + `modifyResourcePermission`）。

**无密钥时**：打开控制台 → **数据库 → 新建集合** → 各集合 **权限设置** 粘贴 `cloudbase/rules/*.json`。

若某集合已存在，脚本会跳过创建并重新部署规则。

---

## 七、与源码的对应关系

| 源码位置 | 内容 |
|----------|------|
| `admin/src/cloud.js` → `COLLECTIONS` | ERP 集合名常量 |
| `admin/src/utils/modulesRegistry.js` | ERP Tab 与组件映射 |
| `admin/scripts/provision-*.mjs` | 远程建集合 + 规则 |
| `miniprogram/cloudfunctions/getHomeConfig` | 小程序读 `home_configs` |
| `cloudbase/rules/` | 权限 JSON 模板 |
| `cloudbase/schema/` | 部分集合字段说明 |

---

## 八、后续升级路线（A2+）

1. 匿名登录 → **自定义登录**（邮箱/手机号）或 **CloudBase 管理员**
2. 配置类集合：模板 B（公开读）+ 管理员 UID 白名单写
3. 用户/订单类：模板 C + 云函数代理 ERP 写操作
4. 敏感日志：`admin_*` 仅云函数可写，ERP 通过云函数查询
