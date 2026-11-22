/**
 * 我的捐赠 · 账本纯函数（2026-11-22 产品负责人「我的钱包新增我的捐赠，1% 公益重点展示」）
 *
 * 口径与店内账本 `syncFinanceData.reconcileOnlineOrders` + `calcPledgeDueFromMp` 一致：
 *   · 计入状态 = 已收款的那 8 个状态；GMV 取 totalPrice（扣券后、含运费的实付）
 *   · 退款扣回 refundFee（部分退款只扣退掉的那部分）
 *   · 应捐 = max(0, 净额) × 1%，分位四舍五入（与 C 端 onePercentPledge.calcOnePercentYuan 同一算法）
 * 只对顾客更诚实的一处：`refunded` 却没有 refundFee 的老单按**全额退款**算（店内账本此时按 0 扣，
 * 对账可见；但给顾客看「已退款的单还算我捐了」是错的）。退款处理中的单暂不计入，退款结束后自然归位。
 *
 * 不 require 任何东西：守卫在内存里直接求值本文件。
 */
const COUNTED = ['paid', 'paid_awaiting_address', 'shipped', 'received', 'aftersales', 'refunded']
const PENDING = ['refunding', 'expired_refunding']
const ALL_STATUSES = COUNTED.concat(PENDING)
const ROW_MAX = 300
const DAY_MS = 86400000
const TZ_MS = 8 * 3600000

function toYuanNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const n = parseFloat(String(raw == null ? '' : raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 元 → 分（整数）；负数按 0 */
function toFen(raw) {
  const v = toYuanNumber(raw)
  return v > 0 ? Math.round(v * 100) : 0
}

/** 1% 应捐（分）：与 calcOnePercentYuan 相同 —— 先取整到分，再 ×0.01 四舍五入 */
function pledgeFen(baseFen) {
  const b = Number(baseFen)
  return Number.isFinite(b) && b > 0 ? Math.round(Math.round(b) * 0.01) : 0
}

/** 云库日期（Date / 毫秒 / ISO / {$date}）→ 毫秒；读不出返回 0 */
function toMs(v) {
  if (!v) return 0
  if (v instanceof Date) return v.getTime() || 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'object' && v.$date != null) return toMs(v.$date)
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : 0
}

/** 北京时间的 { year, date: 'YYYY.MM.DD' } */
function bizDay(ms) {
  if (!ms) return { year: 0, date: '' }
  const d = new Date(ms + TZ_MS)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return { year: y, date: `${y}.${m}.${day}` }
}

/** 单号只露尾 6 位（列表给顾客自己看，也不必整串） */
function maskOrderNo(no) {
  const s = String(no || '').trim()
  return s.length > 6 ? `…${s.slice(-6)}` : s
}

function titleOf(order) {
  const list = Array.isArray(order && order.products) ? order.products : []
  const first = list.find((p) => p && (p.title || p.name)) || {}
  const name = String(first.title || first.name || '').trim().slice(0, 40)
  const count = list.reduce((n, p) => n + (Math.max(1, parseInt(p && (p.quantity || p.count), 10) || 1)), 0)
  if (!name) return { title: '藏品订单', count }
  return { title: name, count }
}

/**
 * 单笔：{ paidFen, refundFen, netFen, state }
 *   state: counted 全额计入 / partial 部分退款 / refunded 全额退回 / pending 退款处理中（暂不计入）
 */
function orderNet(order) {
  const o = order || {}
  const paidFen = toFen(o.totalPrice != null ? o.totalPrice : (o.payAmount != null ? o.payAmount : o.amount))
  if (PENDING.indexOf(o.status) >= 0) return { paidFen, refundFen: 0, netFen: 0, state: 'pending' }
  let refundFen = 0
  if (o.refundFee != null && o.refundFee !== '') refundFen = Math.min(paidFen, toFen(o.refundFee))
  else if (o.status === 'refunded') refundFen = paidFen
  const netFen = Math.max(0, paidFen - refundFen)
  const state = refundFen <= 0 ? 'counted' : netFen > 0 ? 'partial' : 'refunded'
  return { paidFen, refundFen, netFen, state }
}

/**
 * @param {Array} orders 本人订单（任意顺序；不在 ALL_STATUSES 里的会被忽略）
 * @param {{ now?: number, withRows?: boolean }} [opts]
 */
function buildLedger(orders, opts) {
  const o = opts || {}
  const now = Number(o.now) || Date.now()
  const thisYear = bizDay(now).year
  const list = (Array.isArray(orders) ? orders : []).filter((x) => x && ALL_STATUSES.indexOf(x.status) >= 0)
  const items = list.map((x) => {
    const ms = toMs(x.paidTime) || toMs(x.createTime)
    const net = orderNet(x)
    const t = titleOf(x)
    return Object.assign({ id: String(x._id || ''), orderNo: maskOrderNo(x.orderNo), ms }, bizDay(ms), t, net, { pledgeFen: pledgeFen(net.netFen) })
  }).sort((a, b) => b.ms - a.ms)

  let paidFen = 0
  let refundFen = 0
  let netFen = 0
  let counted = 0
  let pendingCount = 0
  let firstMs = 0
  const byYear = {}
  items.forEach((it) => {
    if (it.state === 'pending') { pendingCount += 1; return }
    paidFen += it.paidFen
    refundFen += it.refundFen
    netFen += it.netFen
    if (it.netFen > 0) {
      counted += 1
      if (!firstMs || (it.ms && it.ms < firstMs)) firstMs = it.ms
    }
    const y = it.year || thisYear
    if (!byYear[y]) byYear[y] = { year: y, netFen: 0, orderCount: 0 }
    byYear[y].netFen += it.netFen
    if (it.netFen > 0) byYear[y].orderCount += 1
  })

  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a).map((y) => {
    const row = byYear[y]
    return {
      year: y,
      netFen: row.netFen,
      pledgeFen: pledgeFen(row.netFen),
      orderCount: row.orderCount,
      // 只按日历说话：当年「进行中」，往年「已截止」；拨付与凭证以年度捐赠报告为准，这里不替基金下结论
      phase: y >= thisYear ? 'open' : 'closed'
    }
  })

  const out = {
    paidFen,
    refundFen,
    netFen,
    pledgeFen: pledgeFen(netFen),
    orderCount: counted,
    pendingCount,
    firstDate: firstMs ? bizDay(firstMs).date : '',
    days: firstMs ? Math.max(1, Math.floor((now - firstMs) / DAY_MS) + 1) : 0,
    years,
    truncated: false
  }
  if (o.withRows !== false) {
    out.rows = items.slice(0, ROW_MAX).map((it) => ({
      id: it.id,
      orderNo: it.orderNo,
      date: it.date,
      year: it.year,
      title: it.title,
      count: it.count,
      paidFen: it.paidFen,
      refundFen: it.refundFen,
      netFen: it.netFen,
      pledgeFen: it.pledgeFen,
      state: it.state
    }))
    out.truncated = items.length > ROW_MAX
  }
  return out
}

module.exports = { COUNTED, PENDING, ALL_STATUSES, ROW_MAX, toFen, pledgeFen, toMs, bizDay, maskOrderNo, orderNet, buildLedger }
