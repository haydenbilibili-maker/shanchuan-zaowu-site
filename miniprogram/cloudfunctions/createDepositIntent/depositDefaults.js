/**
 * 售罄孤品定金规则默认值
 * 集合：deposit_rules（doc key=default）
 */
const COLLECTION = 'deposit_rules'
const RULE_KEY = 'default'

const DEFAULT_RULES = {
  key: RULE_KEY,
  depositRatio: 0.1,
  balanceWindowDays: 7,
  minDepositAmount: 50,
  maxDepositAmount: 500,
  depositNonRefundableOnExpire: true,
  enabled: true
}

/**
 * 意向状态机
 * intent          仅候补登记（未付 / 兼容旧数据）
 * pending_pay     定金待支付（已建订单）
 * deposit_paid    已付定金，等待上架
 * awaiting_balance 上架后待尾款
 * settled         尾款已付清
 * forfeited_open  逾期开放，定金不退
 * cancelled       已取消
 */
const STATUS = {
  INTENT: 'intent',
  PENDING_PAY: 'pending_pay',
  DEPOSIT_PAID: 'deposit_paid',
  AWAITING_BALANCE: 'awaiting_balance',
  SETTLED: 'settled',
  FORFEITED_OPEN: 'forfeited_open',
  CANCELLED: 'cancelled'
}

const STATUS_LABELS = {
  intent: '意向中（未付）',
  pending_pay: '待付定金',
  deposit_paid: '已付定金',
  awaiting_balance: '待尾款',
  settled: '已付清',
  forfeited_open: '已逾期开放',
  cancelled: '已取消'
}

/** 用户侧仍视为「有定金关系」的状态 */
const ACTIVE_USER_STATUSES = [
  STATUS.INTENT,
  STATUS.PENDING_PAY,
  STATUS.DEPOSIT_PAID,
  STATUS.AWAITING_BALANCE,
  STATUS.SETTLED
]

function clampNumber(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

function normalizeRules(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const ratio = clampNumber(src.depositRatio, 0.01, 0.9, DEFAULT_RULES.depositRatio)
  return {
    key: RULE_KEY,
    enabled: src.enabled !== false,
    depositRatio: ratio,
    balanceWindowDays: Math.round(clampNumber(src.balanceWindowDays, 1, 60, DEFAULT_RULES.balanceWindowDays)),
    minDepositAmount: Math.round(clampNumber(src.minDepositAmount, 1, 5000, DEFAULT_RULES.minDepositAmount)),
    maxDepositAmount: Math.round(clampNumber(src.maxDepositAmount, 1, 20000, DEFAULT_RULES.maxDepositAmount)),
    depositNonRefundableOnExpire: src.depositNonRefundableOnExpire !== false
  }
}

function describeRules(rules) {
  const r = normalizeRules(rules)
  const pct = Math.round(r.depositRatio * 100)
  return `定金 ${pct}%（¥${r.minDepositAmount}–${r.maxDepositAmount}）· 上架后 ${r.balanceWindowDays} 天内付尾款 · 逾期开放且定金不退`
}

function calcDepositAmount(price, rules) {
  const r = normalizeRules(rules)
  const p = Math.max(0, Number(price) || 0)
  const raw = Math.round(p * r.depositRatio)
  return Math.max(r.minDepositAmount, Math.min(r.maxDepositAmount, raw || r.minDepositAmount))
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '未知'
}

function isDepositOrder(order) {
  if (!order) return false
  return order.orderType === 'deposit' || order.source === 'deposit'
}

function isDepositBalanceOrder(order) {
  if (!order) return false
  return order.orderType === 'deposit_balance' || order.source === 'deposit_balance'
}

module.exports = {
  COLLECTION,
  RULE_KEY,
  DEFAULT_RULES,
  STATUS,
  STATUS_LABELS,
  ACTIVE_USER_STATUSES,
  normalizeRules,
  describeRules,
  calcDepositAmount,
  statusLabel,
  isDepositOrder,
  isDepositBalanceOrder
}
