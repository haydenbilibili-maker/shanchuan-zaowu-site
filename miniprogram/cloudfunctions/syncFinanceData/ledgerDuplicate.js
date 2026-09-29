/**
 * 日账重复录入判定（云函数 CJS 副本）。
 * 判据与 admin/src/utils/financeDuplicateCheck.js 的 compareLedgerEntries 同一份：
 * 同门店（调用方已按 ledgerKey 归属）同营业日，逐字段比对；订单数 / 在手现金只在双方都有值时参与比对。
 * `test:finance-duplicate` 用同一组用例同时跑两份，判据漂移即红。
 */
const round2 = (n) => Math.round(n * 100) / 100
const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? round2(x) : 0
}
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : round2(Number(v)))

const DUPLICATE_FIELDS = [
  { key: 'revenue', label: '营收' },
  { key: 'pos', label: 'POS' },
  { key: 'online', label: '线上' },
  { key: 'refund', label: '退款' },
  { key: 'cashIncome', label: '现金收入' },
  { key: 'orderCount', label: '订单数', optional: true },
  { key: 'cashBalance', label: '在手现金', optional: true },
]

function ledgerAmounts(record) {
  const r = record || {}
  const hasBalance = numOrNull(r.cashBalance) != null
  const cashIncome = hasBalance ? num(r.cashIncome) : num(r.cashIncome != null ? r.cashIncome : r.cash)
  const oc = Number(r.orderCount)
  const revenue = r.revenue != null ? r.revenue : r.netAmount != null ? r.netAmount : r.total
  return {
    revenue: num(revenue),
    pos: num(r.pos),
    online: num(r.online),
    refund: num(r.refundAmount != null ? r.refundAmount : r.refund),
    cashIncome,
    orderCount: Number.isFinite(oc) && oc > 0 ? oc : null,
    cashBalance: numOrNull(r.cashBalance),
  }
}

function compareLedgerEntries(existing, incoming) {
  const a = ledgerAmounts(existing)
  const b = ledgerAmounts(incoming)
  const diffs = []
  for (const f of DUPLICATE_FIELDS) {
    const x = a[f.key]
    const y = b[f.key]
    if (f.optional && (x == null || y == null)) continue
    if (x !== y) diffs.push({ key: f.key, label: f.label, existing: x, incoming: y })
  }
  return { identical: diffs.length === 0, diffs, existing: a, incoming: b }
}

/** 已有记录是否算「有效日账」：全空行（被清零的占位）不触发重复提示 */
function hasLedgerContent(record) {
  const a = ledgerAmounts(record)
  return !!(a.revenue || a.pos || a.online || a.refund || a.cashIncome || a.orderCount || a.cashBalance != null)
}

module.exports = { DUPLICATE_FIELDS, ledgerAmounts, compareLedgerEntries, hasLedgerContent }
