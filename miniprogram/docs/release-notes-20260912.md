# 山海造物 · 版本封板说明（2026-09-12）

> **业务版本号（提审 / 体验版填写）**：**1.1.0**  
> 上一正式说明：`docs/v1.0.3功能迭代说明.md`  
> 仓库备注：`project.config.json` 的 `libVersion` 为基础库，勿与业务版本混淆；物流查询插件声明在 `app.json` → `subpackages.business.plugins.logisticsPlugin`（勿根级重复声明）。

## 本版摘要

礼赠闭环、代金券渠道与 7.5 折地板、库存下单预占、工作台拆权（礼赠履约 / 核销）、购买与逆向链路加固，以及财务对账口径补齐。

### 主要能力

- **礼赠**：先付后填址、履约看板（店长 + Admin）、填址超时退款、场景货架、订阅与运维文档（`docs/gift-ops.md`）
- **购买**：履约幂等、SKU/无 SKU 原子扣减、下单库存预占、超时清扫 `sweepExpiredOrders`（Timer 每 5 分钟）
- **券**：渠道 `online|store|all`；展示/核价对齐实付 ≥75% 地板；门店核销独立云函数
- **工作台**：`giftOps` / `manageGift` 入口拆分；发票角标；权限与 Admin 细粒度对齐
- **财务**：`syncFinanceData` 线上 GMV 含 `paid_awaiting_address`、`expired_refunding`

### 本封板已部署云函数（环境 `cloud1-8gnkty5bfff9f0bf`）

至少包括：`sweepExpiredOrders`、`getProductCoupons`、`makeOrder`、`cancelOrder`、`confirmPayment`、`payCallback`、`refundOrder`、`syncFinanceData`、`managerShipOrder`、`manageWelcomeGift`（另有本迭代周期已上线的 `manageGift`、`verifyStoreCoupon`、`upsertUserProfile` 等）。

**运维注意**：云开发控制台确认 `sweepExpiredOrders` 的 Timer 触发器 `sweepExpiredPendingOrders` 已启用。

### 已知风险（不自动改账本）

1. **微信已退、钱包入账待核对**  
   - 订单字段：`walletRefundPendingReconcile=true`  
   - 店长「售后」Tab 会附带展示，文案「已退·钱包待核对」  
   - 处理：核对 `manageStoredValue` 入账流水后手工补账或清标记；**勿重复发起微信退款**
2. **超时清扫与支付竞态**（极低概率）：sweep 释放预占后订单又支付成功时会打 error 日志，履约走 legacy 扣减；需关注库存告警
3. **欢迎礼「已打标券未齐」**：用户下次 `upsertUserProfile` 自动补齐；运营可调 `manageWelcomeGift` action `listIncomplete` 查看名单

### 建议真机抽检（短）

1. 下单 → 待支付超时 / 取消：库存回、券解锁、钱包 held 回账  
2. 详情页券「可省」不超过约 25% 目录价  
3. 礼赠：下单 → 待填址 → 履约看板可见；店长仅 `giftOps` 看不到运营配置  
4. 退款成功后若钱包失败：售后 Tab 出现「钱包待核对」  
5. 超管账本月份有数；Admin 权益与营销 → 礼赠履约 / 礼赠运营 Tab 可开

---

*封板日：2026-09-12 · Nature's Creations*
