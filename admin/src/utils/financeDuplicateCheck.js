/**
 * 财务日账「重复录入」判定（纯函数，ERP / 清理脚本 / 守卫共用）。
 *
 * 重复 = **归属后同门店 + 同营业日**（2026-09-29 产品负责人）：
 * - 门店按 `resolveFinanceStore`：旧主店 id `store_1780146782017_6w0okpr` 与空 storeId 一律归山川造物；
 * - 日账没有「类型」维度（全部是门店日结 offline_pos），同店同日即同类。
 * 再按内容分两档：
 * - `identical`（完全重复）：营收 / POS / 线上 / 退款 / 现金收入一致，订单数与在手现金在双方都有值时也一致；
 * - 否则为「同日同店金额不同」—— 可能是更正或真实多笔，**只提示、不自动删**。
 *
 * 云函数副本：miniprogram/cloudfunctions/syncFinanceData/ledgerDuplicate.js（CJS，同判据，
 * `test:finance-duplicate` 用同一组用例同时跑两份）。
 */
import { resolveFinanceStore } from './financeDayAggregate.js'

const round2 = (n) => Math.round(n * 100) / 100
const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? round2(x) : 0
}
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : round2(Number(v)))

export const DUPLICATE_FIELDS = [
  { key: 'revenue', label: '营收' },
  { key: 'pos', label: 'POS' },
  { key: 'online', label: '线上' },
  { key: 'refund', label: '退款' },
  { key: 'cashIncome', label: '现金收入' },
  { key: 'orderCount', label: '订单数', optional: true },
  { key: 'cashBalance', label: '在手现金', optional: true },
]

export function ledgerDateOf(record) {
  return String(record?.date || record?.bizDate || '').trim().slice(0, 10)
}

/** 归属后门店 id（与日报「门店营收按店拆分」同一规则） */
export function canonicalLedgerStoreId(record) {
  return resolveFinanceStore(record).storeId
}

/** 重复判定键：归属后门店 | 营业日 */
export function duplicateKey(record) {
  return `${canonicalLedgerStoreId(record)}|${ledgerDateOf(record)}`
}

/** 各集合字段名不一：daily_revenues 用 total / cash，账本用 revenue|netAmount / cashIncome */
export function ledgerAmounts(record) {
  const r = record || {}
  const hasBalance = numOrNull(r.cashBalance) != null
  const cashIncome = hasBalance ? num(r.cashIncome) : num(r.cashIncome ?? r.cash)
  const oc = Number(r.orderCount)
  return {
    revenue: num(r.revenue ?? r.netAmount ?? r.total),
    pos: num(r.pos),
    online: num(r.online),
    refund: num(r.refundAmount ?? r.refund),
    cashIncome,
    orderCount: Number.isFinite(oc) && oc > 0 ? oc : null,
    cashBalance: numOrNull(r.cashBalance),
  }
}

/**
 * 两条同键日账逐字段对比。
 * @returns {{ identical: boolean, diffs: Array<{key,label,existing,incoming}>, existing: object, incoming: object }}
 */
export function compareLedgerEntries(existing, incoming) {
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

/**
 * 录入前检测：本次录入与已有日账同店同日。
 * @param {object[]} existingRecords 已有日账（本机缓存 / 云端合并视图）
 * @param {object} incoming 本次录入
 * @returns {null | { key, record, identical, diffs, existing, incoming }}
 */
export function findExistingDuplicate(existingRecords, incoming) {
  const date = ledgerDateOf(incoming)
  if (!date) return null
  const key = duplicateKey(incoming)
  const matches = (existingRecords || []).filter((r) => r && r !== incoming && duplicateKey(r) === key)
  if (!matches.length) return null
  const cmp = matches.map((r) => ({ record: r, ...compareLedgerEntries(r, incoming) }))
  const hit = cmp.find((c) => c.identical) || cmp[0]
  return { key, ...hit }
}

/**
 * 「仍要新增」= 同日真实多笔：流水类金额累加到已有记录；在手现金是余额，取本次值；原文追加。
 */
export function accumulateLedgerEntry(existing, incoming) {
  const a = ledgerAmounts(existing)
  const b = ledgerAmounts(incoming)
  const pos = round2(a.pos + b.pos)
  const online = round2(a.online + b.online)
  const refund = round2(a.refund + b.refund)
  const cashIncome = round2(a.cashIncome + b.cashIncome)
  const hasChannels = pos || online || refund || cashIncome
  const revenue = hasChannels ? Math.max(0, round2(pos + online + cashIncome - refund)) : round2(a.revenue + b.revenue)
  const orderCount = a.orderCount != null || b.orderCount != null ? (a.orderCount || 0) + (b.orderCount || 0) : null
  const raws = [existing?.raw, incoming?.raw].map((s) => String(s || '').trim()).filter(Boolean)
  return {
    ...existing,
    ...incoming,
    storeId: incoming?.storeId || existing?.storeId,
    revenue,
    pos,
    online,
    refund,
    cash: cashIncome,
    cashIncome,
    orderCount,
    cashBalance: b.cashBalance ?? a.cashBalance,
    raw: raws.join('\n—— 同日追加 ——\n'),
  }
}

/** 同组去留评分：主店 canonical id → 较新时间戳 → 有渠道明细 → 金额较大 */
function keepScore(r) {
  const sid = String(r?.storeId || '').trim()
  const a = ledgerAmounts(r)
  return [
    sid && sid === canonicalLedgerStoreId(r) ? 1 : 0,
    Number(r?._updateTime || r?.syncedAt || r?.updateTime || 0) || 0,
    a.pos || a.online || a.refund || a.cashIncome ? 1 : 0,
    a.revenue,
  ]
}

export function compareForKeep(a, b) {
  const x = keepScore(a)
  const y = keepScore(b)
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  }
  return 0
}

/**
 * 历史数据分组：同键多条 → identical（完全重复，可删多余）/ differ（金额不同，待逐条定）。
 * identical 组内保留 compareForKeep 最高的一条。
 */
export function classifyDuplicateGroups(rows) {
  const map = new Map()
  ;(rows || []).forEach((r, index) => {
    if (!r || r.deleted === true || !ledgerDateOf(r)) return
    const key = duplicateKey(r)
    const list = map.get(key) || []
    list.push({ row: r, index })
    map.set(key, list)
  })
  const groups = []
  for (const [key, list] of map) {
    if (list.length < 2) continue
    const sorted = [...list].sort((p, q) => compareForKeep(q.row, p.row))
    const keep = sorted[0]
    const identical = sorted.slice(1).every((x) => compareLedgerEntries(keep.row, x.row).identical)
    const [storeId, date] = key.split('|')
    groups.push({
      key,
      storeId,
      date,
      identical,
      keep,
      remove: identical ? sorted.slice(1) : [],
      others: sorted.slice(1),
      diffs: sorted.slice(1).map((x) => compareLedgerEntries(keep.row, x.row).diffs),
    })
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key))
}
