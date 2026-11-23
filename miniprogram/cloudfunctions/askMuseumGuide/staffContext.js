/**
 * AI 智能中心 · 虚拟员工的经营上下文（2026-11-23 产品负责人：员工「没有任何上下文」）
 *
 * 口径：
 * - 只做**近 30 天**的服务端汇总，5 分钟内存缓存（同一函数实例复用），避免每次提问都扫库；
 * - 只读 orders / products / users / bookings / finance_records 五张表，**不取姓名 / 手机 / 账号标识等个人信息**；
 * - 每个块独立 try/catch：某张表失败就少一块，不影响其它块，也不把错误抛给调用方；
 * - 输出一段 ≤ 500 字的中文事实清单，交给模型当「当前经营数据」，并明确「没出现的指标就是没有数据」。
 *
 * 字段口径（已在代码里核对）：
 *   orders.status / totalPrice（回退 payAmount / amount）/ refundFee（回退 refundAmount）/ createTime
 *   products.isOffShelf / stock / category
 *   users.createTime · bookings.createTime
 */

const DAY_MS = 86400000
const WINDOW_DAYS = 30
const TTL_MS = 5 * 60 * 1000
const TEXT_MAX = 520

const PAID_STATUS = ['paid', 'paid_awaiting_address', 'shipped', 'received', 'aftersales', 'refunded']

let cache = { at: 0, value: null }

function fenOfYuan(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function money(n) {
  const v = Math.round(Number(n) || 0)
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : String(v)
}

function summarizeOrders(rows) {
  const list = Array.isArray(rows) ? rows : []
  let paidCount = 0
  let gmv = 0
  let refund = 0
  for (const o of list) {
    if (!o) continue
    const st = String(o.status || '')
    const amount = fenOfYuan(o.totalPrice != null ? o.totalPrice : (o.payAmount != null ? o.payAmount : o.amount))
    if (PAID_STATUS.indexOf(st) >= 0) { paidCount += 1; gmv += amount }
    const rf = fenOfYuan(o.refundFee != null ? o.refundFee : o.refundAmount)
    if (rf > 0) refund += rf
  }
  return { total: list.length, paidCount, gmv, refund, aov: paidCount ? Math.round(gmv / paidCount) : 0 }
}

function summarizeProducts(rows) {
  const list = Array.isArray(rows) ? rows : []
  let onSale = 0
  let lowStock = 0
  const cats = {}
  for (const p of list) {
    if (!p || p.isOffShelf === true) continue
    onSale += 1
    if (Number(p.stock) <= 3) lowStock += 1
    const c = String(p.category || '').trim()
    if (c) cats[c] = (cats[c] || 0) + 1
  }
  const top = Object.keys(cats).sort((a, b) => cats[b] - cats[a]).slice(0, 3)
    .map((k) => `${k} ${cats[k]}`).join('、')
  return { onSale, lowStock, top }
}

function summarizeFinance(rows) {
  const list = Array.isArray(rows) ? rows : []
  let cash = 0
  let pos = 0
  let online = 0
  let refund = 0
  for (const r of list) {
    if (!r) continue
    cash += fenOfYuan(r.cashIncome != null ? r.cashIncome : r.cash)
    pos += fenOfYuan(r.pos)
    online += fenOfYuan(r.online)
    refund += fenOfYuan(r.refund)
  }
  const total = cash + pos + online
  return { days: list.length, cash, pos, online, refund, total }
}

async function loadSnapshot(db) {
  const now = Date.now()
  if (cache.value && now - cache.at < TTL_MS) return cache.value
  const since = new Date(now - WINDOW_DAYS * DAY_MS)
  const _ = db.command
  const out = { orders: null, products: null, users: null, bookings: null, finance: null }

  const tasks = [
    (async () => {
      try {
        const r = await db.collection('orders')
          .where({ createTime: _.gte(since) })
          .field({ status: true, totalPrice: true, payAmount: true, amount: true, refundFee: true, refundAmount: true })
          .limit(1000).get()
        out.orders = summarizeOrders(r && r.data)
      } catch (e) { /* 少一块不影响其它 */ }
    })(),
    (async () => {
      try {
        const r = await db.collection('products')
          .where({ isOffShelf: _.neq(true) })
          .field({ stock: true, category: true, isOffShelf: true })
          .limit(1000).get()
        out.products = summarizeProducts(r && r.data)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      try {
        const r = await db.collection('users').where({ createTime: _.gte(since) }).count()
        out.users = { newCount: (r && r.total) || 0 }
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      try {
        const r = await db.collection('bookings').where({ createTime: _.gte(since) }).count()
        out.bookings = { count: (r && r.total) || 0 }
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // 门店日账（ERP 维护）：date 是 'YYYY-MM-DD' 字符串，按北京时间近 30 天取
      try {
        const bj = new Date(now + 8 * 3600000)
        const start = new Date(bj.getTime() - WINDOW_DAYS * DAY_MS)
        const startStr = start.toISOString().slice(0, 10)
        const r = await db.collection('finance_records')
          .where({ date: _.gte(startStr) })
          .field({ date: true, cash: true, cashIncome: true, pos: true, online: true, refund: true })
          .limit(500).get()
        out.finance = summarizeFinance(r && r.data)
      } catch (e) { /* ignore */ }
    })()
  ]
  await Promise.all(tasks)
  cache = { at: now, value: out }
  return out
}

function financeLine(o) {
  if (!o) return ''
  return `近 ${WINDOW_DAYS} 天订单 ${o.total} 笔（已付 ${o.paidCount} 笔），实付 GMV ¥${money(o.gmv)}，客单价 ¥${money(o.aov)}，退款 ¥${money(o.refund)}`
}

function productLine(p) {
  if (!p) return ''
  return `在售藏品 ${p.onSale} 件，其中库存 ≤3 的 ${p.lowStock} 件${p.top ? `；门类分布前三：${p.top}` : ''}`
}

/**
 * 角色 → 上下文。只给这个角色真正用得上的块；没有的指标不编。
 * @returns {Promise<string>} 空串表示这次没有可用上下文
 */
async function contextFor(roleId, db) {
  const snap = await loadSnapshot(db)
  const lines = []
  const financeRoles = ['cfo', 'data_analyst', 'store_manager', 'marketing']
  if (financeRoles.indexOf(roleId) >= 0) {
    const l = financeLine(snap.orders)
    if (l) lines.push(l)
    const f = snap.finance
    if (f && f.total > 0) lines.push(`近 ${WINDOW_DAYS} 天门店日账合计 ¥${money(f.total)}（现金 ¥${money(f.cash)} / POS ¥${money(f.pos)} / 线上 ¥${money(f.online)}，退款 ¥${money(f.refund)}）`)
  }
  if (roleId === 'procurement' || roleId === 'creative_director') {
    const l = productLine(snap.products)
    if (l) lines.push(l)
    if (roleId === 'procurement' && snap.orders) lines.push(`近 ${WINDOW_DAYS} 天订单 ${snap.orders.total} 笔`)
  }
  if (roleId === 'store_manager' && snap.bookings) lines.push(`近 ${WINDOW_DAYS} 天预约 ${snap.bookings.count} 单`)
  if ((roleId === 'marketing' || roleId === 'data_analyst') && snap.users) lines.push(`近 ${WINDOW_DAYS} 天新增会员 ${snap.users.newCount} 人`)
  if (roleId === 'creative_director' && snap.orders) lines.push(`近 ${WINDOW_DAYS} 天订单 ${snap.orders.total} 笔`)
  if (!lines.length) return ''
  return lines.join('；').slice(0, TEXT_MAX)
}

module.exports = { contextFor, loadSnapshot, summarizeOrders, summarizeProducts, summarizeFinance, PAID_STATUS, WINDOW_DAYS, TEXT_MAX, __resetCache: () => { cache = { at: 0, value: null } } }
