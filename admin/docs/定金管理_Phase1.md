# 定金管理（ERP · Phase 1）

**目标**：ERP 补齐小程序「售罄孤品定金」的后台能力，与超管台同源同规则。

## 数据源（小程序侧 SSOT）

| 集合 | 说明 |
|------|------|
| `deposit_rules` | 规则单例（doc `key=default`）：`enabled` / `depositRatio` / `balanceWindowDays` / `minDepositAmount` / `maxDepositAmount` / `depositNonRefundableOnExpire` |
| `deposit_intents` | 意向单：`productId` / `productTitle` / `productPrice` / `depositAmount` / `balanceAmount` / `status` / `balanceDueAt` / `forfeitedAt` |

意向状态机：`intent → pending_pay → deposit_paid → awaiting_balance → settled`；异常分支 `forfeited_open`（逾期开放、定金不退）与 `cancelled`。

## 云函数（`manageDeposit`，ERP 经 /api/cloud-fn 代理）

| action | 权限 | 用途 |
|--------|------|------|
| `getRules` | manager | 读规则 |
| `saveRules` | 超管 | 写规则 |
| `listIntents` | manager | 意向列表（`status` 过滤 + `limit`） |
| `openExpired` / `forfeitIntent` | 超管 | 逾期开放、没收定金 |
| `sweepBalanceDue` | 超管 | 清扫已过尾款窗口的意向 |

## ERP 模块

- 菜单：业务运营 → 交易履约 → **定金管理**（`App.vue` id `72`）
- 组件：`admin/src/components/DepositOps.vue`
- 能力：规则编辑（比例/窗口/上下限/逾期不退）＋ 意向列表（状态筛选、逾期高亮）＋ 逾期开放 ＋ 清扫逾期。

## 验收

1. 规则保存后，小程序超管台刷新可见同一份规则。
2. 意向列表状态与小程序一致；逾期项（`awaiting_balance` 且过 `balanceDueAt`）标红。
3. 「逾期开放」后商品恢复可购、意向状态变 `forfeited_open`。
