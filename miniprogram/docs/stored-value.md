# 我的钱包（原「会员储值卡」）

面向产品 / 运营 / 开发：山海造物微信小程序「我的钱包」能力的产品规则、数据模型、折扣优先级、Admin 配置与部署说明。

> **本轮状态（v2.1）**：流水账单可读；**退款回钱包**（`refundOrder` 按渠道拆分）；取消/超时 **held 释放**；钱包页空态/安全提示/充值成功回顶刷新；自定义金额充值；确认订单钱包支付；无独立钱包折扣。  
> **开关**：仍用 `showStoredValue`。  
> **仍禁止**：关闸时充值；客户端直写余额；诱导性「赠送」与独立「钱包 X 折」文案。

环境：`cloud1-8gnkty5bfff9f0bf`  
开关同源：`content_display_flags` ← `getContentDisplayFlags`

---

## 0. 架构总览

```
超管「内容展示开关」showStoredValue
        │
        ▼
content_display_flags
        │
        ├─ false → C 端隐藏「我的钱包」；manageStoredValue 返回 STORED_VALUE_DISABLED
        └─ true  → 钱包页：余额 / 档位 / 权益说明 / 流水 / 充值

Admin「我的钱包」配置页
        │
        ▼
manageStoredValue getConfig / saveConfig
        │
        ▼
stored_value_config（充值档位 + 说明文案；不再配置独立折扣率）

makeOrder（useWalletPay）
        └─ pricing：会员折扣（含预升级）→ 优惠券 → 运费 → 钱包余额抵扣（支付手段）
payOrder
        └─ 若 useWalletPay：先 debitForOrder，剩余走微信；全额钱包 → confirmPayment
cancelOrder / releaseHeldWalletDebits
        └─ pending_pay 取消或超时：refundWalletForOrder 释放 held
refundOrder.execute
        └─ 按渠道拆分：微信退 wxpayFen 比例 + creditRefundForOrder 退钱包
```

---

## 1. 产品规则

### 1.1 命名

| 场景 | 文案 |
|------|------|
| C 端入口 / 页标题 | **我的钱包** |
| 充值 CTA | **充值** |
| 避免 | 「储值卡」「赠金」「充多少送多少」「返利」「理财」「钱包 9.5 折」 |

### 1.2 使用范围

- 余额**仅限山海造物小程序内支付**（确认订单等线上结算），**不适用于线下门店**消费或核销。  
- 不可提现、不可转赠；支付扣款与退款回账以钱包流水为准。  
- C 端固定文案见 `subpackages/feature/user/stored-value/walletCopy.js`（铜牌脚注、充值说明、安全提示、充值确认弹窗）；Admin「C 端说明文案」仅描述**支付权益**（会员等级折扣），勿写「门店消费」类范围说明（云侧 `normalizeBenefit` 会过滤误配）。

### 1.3 充值

- **充值金额 = 本金入账**；新充值 `bonusFen` 固定为 `0`。  
- 库内旧账户若仍有 `bonusFen`：**兼容展示与扣款**（扣款优先本金，再扣历史赠金），但新充值不再发放。  
- **默认档位 = 会员等级成长值门槛**：500 / 3000 / 10000 / 30000 / 50000（对应 Lv2–Lv6；Admin 可改）。旧默认 100/300/500/1000 在读取时自动迁移。  
- **自定义金额**：默认开启；`allowCustom` / `minCustomFen`(默认 100=¥1) / `maxCustomFen`(默认 5000000=¥50000) / `customStepFen`(默认 100=¥1)。C 端传 `mode:'custom'` + `customPayFen`（或 `customAmountYuan`）走同一 `SV*` 支付入账链路。  
- **积分与成长值**：支付成功入账后，按实付每满 ¥1 → **1 积分 + 1 成长值**（写入 `users.bonusPoints` + `users.storeGrowthValue`；`point_records.dedupeKey = wallet_recharge:{outTradeNo}` 幂等）。与门店消费口径一致。

### 1.4 实际权益 = 会员等级支付折扣（不是独立钱包折、不是赠金）

**废止**：独立钱包折扣率、`better_of` / 与会员折二选一、Admin「钱包 9.5 折」配置。

**现行规则**：

- 用钱包支付时，折扣来源 = **会员等级折扣**（与现网一致，含本单金额预估可达等级 / 高价值购预升级）。  
- 钱包本身只是**余额支付手段**，不额外打折。  
- 运费**不参与**会员折扣（保持现网）。  
- C 端说明文案示例：「用钱包支付时，按本单可达的会员等级享受专属支付折扣。充值金额将全额计入可用余额。」

### 1.5 计价优先级

```
目录价
  → ① 会员等级折扣（含本单预估定级）
  → ② 优惠券
  → ③ 运费 / 定制加价（运费不参与会员折）
  = 应付 totalPrice
  → ④ 钱包余额抵扣（支付手段，非再打折）
  → 剩余走微信支付
```

与优惠券：**可叠加**（先折后券）。  
与积分：充值成功按实付 **¥1 = 1 积分**（另计同等成长值）；与门店规则同源。

### 1.6 余额支付

- 下单传 `useWalletPay: true` → 订单写入 `useWalletPay`、`paymentBreakdown`。  
- `payOrder`：先 `debitForOrder`，再对 `wxpayFen` 拉起微信；`wxpayFen=0` 时全额钱包，客户端再调 `confirmPayment`。  
- 退款回账、门店核销实扣：仍见「已知缺口」。

---

## 2. 数据模型

### 2.1 `stored_value_config`

| 字段 | 说明 |
|------|------|
| `docKey` | `wallet_v1` |
| `status` | `active` |
| `packages[]` | `{ id, name, payFen, principalFen, bonusFen:0, sort, enabled }` |
| `recharge` | `{ allowCustom, minCustomFen, maxCustomFen, customStepFen }` 自定义充值上下限 |
| `benefit.description` | C 端权益说明（不驱动计价） |
| `benefit.*` 旧折扣字段 | **废弃**，读写时强制关闭 / 忽略 |
| `updateTime` / `updatedBy` | |

### 2.2 既有集合（不变）

- `stored_value_accounts`：`principalFen` / `bonusFen`（兼容）/ `availableFen`  
- `stored_value_ledgers`：流水；新充值 type=`recharge`  
- `stored_value_recharge_orders`：新单 `bonusFen=0`

### 2.3 订单字段（新增）

| 字段 | 说明 |
|------|------|
| `useWalletPay` | 是否选用钱包支付 |
| `memberDiscountRate` | 会员档乘数快照 |
| `discountRate` | 本单实际结算乘数（已含钱包解析） |
| `walletBenefitSnapshot` | 权益与 resolve 快照 |
| `paymentBreakdown` | `{ totalFen, walletPayFen, wxpayFen }` |
| `walletPaidFen` / `walletLedgerId` | 实扣后写入 |
| `wxPayMode: 'wallet'` | 全额钱包时 |

---

## 3. 云函数 action

| action | 谁 | 说明 |
|--------|-----|------|
| `getAccount` | 用户 | 余额 + 档位 + recharge 选项 + benefitText |
| `listPackages` | 用户 | 档位 + recharge |
| `getConfig` / `saveConfig` | 店长/超管 / Admin ops key | 读写 `stored_value_config`（含 recharge） |
| `listLedgers` | 用户 | 流水（含 subtitle / tone / 订单号） |
| `createRecharge` | 用户 | **仅本金**；支持 `packageId` 或自定义金额 |
| `confirmRecharge` | 用户 | 入账确认 |
| `debitForOrder` | 用户 / payOrder 嵌套 | 订单扣款幂等 → held |
| `refundWalletForOrder` | 用户 / payOrder·cancelOrder | 待支付或 void 孤儿 held 回账 |
| `creditRefundForOrder` | refundOrder / 店员 | 已成交退款退回钱包 |
| `releaseHeldWalletDebits` | 用户（本人） | 批量清理超时/取消 held |
| `ensureCollections` | 店长+ | 含 `stored_value_config` |
| `staffDebit` | 店员 | 仍为骨架 `NOT_IMPLEMENTED` |
| `ping` | — | 探测 |

关闸文案：`我的钱包暂未开放`（code 仍为 `STORED_VALUE_DISABLED`，兼容旧客户端）。

---

## 4. Admin 配置与验证

1. Admin → **小程序配置 → 我的钱包**：改充值档位、自定义金额上下限与说明文案 → 保存（**勿再配独立折扣率**）。  
2. 折扣请到 **会员等级体系** 配置。  
3. 打开 `showStoredValue`。  
4. 钱包页：铜牌余额卡 + 档位网格 + 自定义金额；「支付权益」写会员等级折扣。  
5. 选档或输入自定义金额完成微信支付，余额到账。  
6. 确认订单开钱包：折扣金额与会员/预升级一致。

---

## 5. 部署

```bash
./scripts/tcb-fn-deploy.exp manageStoredValue cloud1-8gnkty5bfff9f0bf
./scripts/tcb-fn-deploy.exp makeOrder cloud1-8gnkty5bfff9f0bf
./scripts/tcb-fn-deploy.exp payOrder cloud1-8gnkty5bfff9f0bf
./scripts/tcb-fn-deploy.exp confirmPayment cloud1-8gnkty5bfff9f0bf
./scripts/tcb-fn-deploy.exp payCallback cloud1-8gnkty5bfff9f0bf
```

建议环境变量（与支付一致）：

| 变量 | 作用 |
|------|------|
| `WX_PAY_SUB_MCH_ID` | 充值/订单微信支付 |
| `STORED_VALUE_CALLBACK_KEY` | 云函数间 `debitForOrder` / 补单保护（payOrder 嵌套调用需要） |
| `ALLOW_MOCK_PAY` | 生产勿开 |

超管可执行：

```js
wx.cloud.callFunction({ name: 'manageStoredValue', data: { action: 'ensureCollections' } })
```

---

## 6. 已知缺口与下轮建议

1. ~~**退款回钱包**~~：**本轮已接通** `refundOrder` → `creditRefundForOrder`（按钱包/微信渠道比例拆分；全额钱包可直接退回）。  
2. ~~**订单超时 held**~~：**本轮已接通** `cancelOrder` 先回账再 void；钱包页 `onShow` 调 `releaseHeldWalletDebits`；void 孤儿单可补救。  
3. **门店核销**：`staffDebit` 仍为骨架。  
4. **对账日报**：充值实收 vs 本金入账；退款渠道核对报表。  
5. **定时任务**：服务端 cron 扫描全库超时 held（当前依赖取消链路 + 用户打开钱包页自愈）。  
6. 结算页依赖 `showStoredValue`；关开关后不展示钱包区，走纯微信。

---

### 结算页交互

1. 打开 `showStoredValue` 且有钱包账户时，确认订单页展示余额与权益说明。  
2. 打开「使用钱包支付」→ 重新 `makeOrder` 预览 → 应付/折扣/钱包抵扣/微信尾款与云端一致。  
3. 提交后：`useWalletPay` 写入订单 → `payOrder` 扣款 → 全额则 `confirmPayment`；有尾款则微信；取消或拉起失败自动 `refundWalletForOrder`。

---

### 本轮摘要（v2.1 · 流水 / 退款 / held）

| 项 | 说明 |
|----|------|
| 流水体验 | 类型文案、副标题（订单号/说明）、余额余额、加载更多、空态 |
| 退款回钱包 | `refundOrder` 按比例拆微信+钱包；流水 `refund_credit` |
| held 清理 | `cancelOrder` 取消前回账；`releaseHeldWalletDebits`；void 孤儿可补 |
| 钱包页打磨 | 充值成功闪条+回顶刷新；安全提示；档位空态 |

---

## 7. 改动文件清单（累计）

| 路径 | 变更 |
|------|------|
| `cloudfunctions/manageStoredValue/*` | 配置、充值、debit、creditRefund、releaseHeld、流水序列化 |
| `cloudfunctions/refundOrder/index.js` | 渠道拆分退款 + 钱包退回 |
| `cloudfunctions/cancelOrder/index.js` | 取消前释放 held |
| `cloudfunctions/makeOrder/*` / `payOrder` / `confirmPayment` | 钱包支付闭环 |
| `subpackages/feature/user/stored-value/*` | 「我的钱包」UI / 流水 / 自定义充值 |
| `admin/.../WalletConfig.vue` | 档位 + 自定义金额上下限 |
| `docs/stored-value.md` | 本文档 |

---

*山海造物 Nature's Creations — 把山海带回家*  
*Wallet Plan v2.1 | 2026.09*
