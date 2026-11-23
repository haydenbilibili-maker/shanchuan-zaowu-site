/**
 * AI 智能中心 · 虚拟员工的经营上下文（2026-11-23 产品负责人：员工「没有任何上下文」）
 *
 * 口径：
 * - 只做**近 30 天**的服务端汇总，5 分钟内存缓存（同一函数实例复用），避免每次提问都扫库；
 * - 只读 orders / products / users / bookings / finance_records / purchase_orders / stock_movements / ops_purchases 八张表 + 飞书成品库存 + 员工花名册 / 工资条 / 考勤 / 请假，**不取姓名 / 手机 / 账号标识等个人信息**；
 * - 每个块独立 try/catch：某张表失败就少一块，不影响其它块，也不把错误抛给调用方；
 * - 输出一段 ≤ 760 字的中文事实清单，交给模型当「当前经营数据」，并明确「没出现的指标就是没有数据」。
 *
 * 字段口径（已在代码里核对）：
 *   orders.status / totalPrice（回退 payAmount / amount）/ refundFee（回退 refundAmount）/ createTime
 *   products.isOffShelf / stock / category
 *   users.createTime · bookings.createTime
 */

const DAY_MS = 86400000
const WINDOW_DAYS = 30
const TTL_MS = 5 * 60 * 1000
const TEXT_MAX = 800
const WEEK_MS = 7 * DAY_MS

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

/**
 * 近 7 天 vs 前 7 天（2026-11-23 第六轮「根据最新的数据给出决策参考」）：只算已付单的笔数与金额，外加今天（北京时间）的已付笔数。
 * createTime 可能是 Date / 时间戳 / 字符串，统一转毫秒；转不出来的那条不进趋势（仍计入 30 天合计）。
 */
function toMs(v) {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date != null) return toMs(v.$date)
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : NaN
}

function summarizeTrend(rows, now) {
  const list = Array.isArray(rows) ? rows : []
  const t = Number(now) || Date.now()
  const bjDayStart = Math.floor((t + 8 * 3600000) / DAY_MS) * DAY_MS - 8 * 3600000
  const out = { last7: 0, prev7: 0, gmv7: 0, gmvPrev7: 0, today: 0 }
  for (const o of list) {
    if (!o || PAID_STATUS.indexOf(String(o.status || '')) < 0) continue
    const at = toMs(o.createTime)
    if (!Number.isFinite(at)) continue
    const amount = fenOfYuan(o.totalPrice != null ? o.totalPrice : (o.payAmount != null ? o.payAmount : o.amount))
    if (at >= t - WEEK_MS) { out.last7 += 1; out.gmv7 += amount } else if (at >= t - 2 * WEEK_MS) { out.prev7 += 1; out.gmvPrev7 += amount }
    if (at >= bjDayStart) out.today += 1
  }
  return out
}

/** 环比：前一期 < 3 时不算百分比（样本太小，百分比会吓人） */
function changePct(cur, prev) {
  if (!(prev >= 3)) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function pctText(p) {
  if (p == null) return ''
  return p === 0 ? '持平' : `${p > 0 ? '↑' : '↓'}${Math.abs(p)}%`
}

/** 礼券：近 30 天发出 / 核销；核销率只在发出 ≥ 10 张时给（样本太小不给百分比） */
function summarizeCoupons(issued, used) {
  const i = Math.max(0, Number(issued) || 0)
  const u = Math.max(0, Number(used) || 0)
  return { issued: i, used: u, rate: i >= 10 ? Math.round((u / i) * 100) : null }
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

function summarizePurchases(rows) {
  const list = Array.isArray(rows) ? rows : []
  let count = list.length
  let amount = 0
  let paid = 0
  for (const p of list) {
    if (!p) continue
    amount += fenOfYuan(p.totalAmount)
    const ps = String(p.paymentStatus || '')
    if (ps === 'paid' || ps === 'marked_paid') paid += 1
  }
  return { count, amount, paid }
}

function summarizeFeishuInventory(rows) {
  const list = Array.isArray(rows) ? rows : []
  let qty = 0
  let lines = 0
  for (const r of list) {
    if (!r) continue
    if (r.qty == null || r.qty === '') continue
    const q = Number(r.qty)
    if (!Number.isFinite(q)) continue
    qty += q
    lines += 1
  }
  return { lines, qty }
}

function summarizeHr(pack) {
  const p = (pack && pack) || {}
  const pays = p.payslips && Array.isArray(p.payslips.data) ? p.payslips.data : []
  let gross = 0
  let net = 0
  let deduction = 0
  for (const r of pays) {
    if (!r) continue
    gross += fenOfYuan(r.gross)
    net += fenOfYuan(r.net)
    deduction += fenOfYuan(r.deduction)
  }
  const att = p.attendance && Array.isArray(p.attendance.data) ? p.attendance.data : []
  let late = 0
  let early = 0
  for (const a of att) {
    const st = String(a && a.status || '')
    if (st === 'late') late += 1
    else if (st === 'early_leave') early += 1
  }
  return {
    month: p.month || '',
    headcount: (p.members && p.members.total) || 0,
    payslipCount: pays.length,
    gross, net, deduction,
    punches: att.length,
    late, early,
    pendingLeaves: (p.leaves && p.leaves.total) || 0
  }
}

const OPS_OPEN_STATUS = ['draft', 'pending_pay', 'paid', 'ordered', 'pending_ship', 'shipped']

function summarizeOpsPurchases(rows) {
  const list = Array.isArray(rows) ? rows : []
  let count = 0
  let amount = 0
  let openCount = 0
  let storeAmount = 0
  let studioAmount = 0
  for (const r of list) {
    if (!r || r.deleted === true) continue
    const st = String(r.status || '')
    if (st === 'cancelled') continue
    const amt = r.amount != null ? fenOfYuan(r.amount) : (Number(r.qty) || 0) * (Number(r.unitPrice) || 0)
    count += 1
    amount += amt
    if (OPS_OPEN_STATUS.indexOf(st) >= 0) openCount += 1
    if (String(r.scope || '') === 'studio') studioAmount += amt
    else storeAmount += amt
  }
  return { count, amount, openCount, storeAmount, studioAmount }
}

function summarizeMoves(rows) {
  const list = Array.isArray(rows) ? rows : []
  let inQty = 0
  let outQty = 0
  for (const m of list) {
    if (!m) continue
    const d = fenOfYuan(m.delta)
    if (d > 0) inQty += d
    else if (d < 0) outQty += -d
  }
  return { moves: list.length, inQty, outQty, net: inQty - outQty }
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
  const out = { at: now, coupons: null, orders: null, trend: null, products: null, users: null, bookings: null, finance: null, purchases: null, moves: null, ops: null, feishuInv: null, hr: null }

  const tasks = [
    (async () => {
      try {
        const r = await db.collection('orders')
          .where({ createTime: _.gte(since) })
          .field({ status: true, totalPrice: true, payAmount: true, amount: true, refundFee: true, refundAmount: true, createTime: true })
          .limit(1000).get()
        out.orders = summarizeOrders(r && r.data)
        out.trend = summarizeTrend(r && r.data, now)
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
        const [r, r7, rPrev] = await Promise.all([
          db.collection('users').where({ createTime: _.gte(since) }).count(),
          db.collection('users').where({ createTime: _.gte(new Date(now - WEEK_MS)) }).count(),
          db.collection('users').where({ createTime: _.and(_.gte(new Date(now - 2 * WEEK_MS)), _.lt(new Date(now - WEEK_MS))) }).count()
        ])
        out.users = { newCount: (r && r.total) || 0, last7: (r7 && r7.total) || 0, prev7: (rPrev && rPrev.total) || 0 }
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      try {
        const r = await db.collection('bookings').where({ createTime: _.gte(since) }).count()
        out.bookings = { count: (r && r.total) || 0 }
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // 礼券（2026-11-23 第八轮，市场 / 财务 / 数据）：字段已在写入方核对 ——
      //   领取 receiveCoupon / issueCampaignCoupon：status 'unused' + createTime；
      //   核销 confirmPayment/fulfillOrder、verifyStoreCoupon：status 'used' + usedTime。只做两次 count，不取持券人。
      try {
        const [issued, used] = await Promise.all([
          db.collection('user_coupons').where({ createTime: _.gte(since) }).count(),
          db.collection('user_coupons').where({ status: 'used', usedTime: _.gte(since) }).count()
        ])
        out.coupons = summarizeCoupons((issued && issued.total) || 0, (used && used.total) || 0)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // B2B 采购单：只在创建 30 天内、只取金额与状态（不取采购商信息）
      try {
        const r = await db.collection('purchase_orders')
          .where({ createdAt: _.gte(now - WINDOW_DAYS * DAY_MS) })
          .field({ totalAmount: true, status: true, paymentStatus: true, createdAt: true })
          .limit(500).get()
        out.purchases = summarizePurchases(r && r.data)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // 店内采购（订货履约 SSOT）：门店 / 工作室两套账，只取金额与状态
      try {
        const r = await db.collection('ops_purchases')
          .where({ createdAt: _.gte(now - WINDOW_DAYS * DAY_MS) })
          .field({ amount: true, qty: true, unitPrice: true, status: true, scope: true, deleted: true, createdAt: true })
          .limit(1000).get()
        out.ops = summarizeOpsPurchases(r && r.data)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // 库存流水：出库扣减与飞书对齐入库，只取增减量
      try {
        const r = await db.collection('stock_movements')
          .where({ createdAt: _.gte(now - WINDOW_DAYS * DAY_MS) })
          .field({ delta: true, type: true, createdAt: true })
          .limit(1000).get()
        out.moves = summarizeMoves(r && r.data)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // 飞书「成品库存」镜像：只取数量，用于和流水对账（采购已由 ops_purchases 覆盖，不重复计）
      try {
        const r = await db.collection('feishu_inventory')
          .field({ qty: true })
          .limit(1000).get()
        out.feishuInv = summarizeFeishuInventory(r && r.data)
      } catch (e) { /* ignore */ }
    })(),
    (async () => {
      // HR：只做**聚合**——不取姓名、不取单人薪资（隐私红线）
      try {
        const bj = new Date(now + 8 * 3600000)
        const month = bj.toISOString().slice(0, 7)
        const monthStart = `${month}-01`
        const [members, payslips, attendance, leaves] = await Promise.all([
          db.collection('staff_members').where({ status: 'active' }).count().catch(() => null),
          db.collection('staff_payslips').where({ month }).field({ gross: true, net: true, deduction: true }).limit(500).get().catch(() => null),
          db.collection('staff_attendance').where({ dateKey: _.gte(monthStart) }).field({ status: true }).limit(1000).get().catch(() => null),
          db.collection('staff_leave_requests').where({ status: 'pending' }).count().catch(() => null)
        ])
        out.hr = summarizeHr({ month, members, payslips, attendance, leaves })
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

/** 数据时间（北京时间 MM-DD HH:mm）：回答与页面都标上「截至几点」，决策时知道数据有多新 */
function asOfText(at) {
  const t = Number(at)
  if (!Number.isFinite(t) || t <= 0) return ''
  const d = new Date(t + 8 * 3600000).toISOString()
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`
}

/**
 * 全局一句（2026-11-23 第六轮「每一个虚拟员工都具有应该具有的全局信息」）：每个角色都先看到同一份经营全貌，
 * 再看到自己专业那几块。只放计数与金额合计，不放工资（工资合计只给人事经理）。
 */
/** 最近一次快照的时间（回答里「依据几点的数据」用；没有快照返回空串） */
function lastAsOf() {
  return cache && cache.value ? asOfText(cache.at) : ''
}

function globalLine(snap) {
  const s = snap || {}
  const parts = []
  const tr = s.trend
  if (tr) {
    const p = pctText(changePct(tr.last7, tr.prev7))
    parts.push(`近 7 天已付订单 ${tr.last7} 笔${p ? `（前 7 天 ${tr.prev7} 笔，${p}）` : `（前 7 天 ${tr.prev7} 笔）`}、实付 ¥${money(tr.gmv7)}，今天已付 ${tr.today} 笔`)
  }
  if (s.products) parts.push(`在售 ${s.products.onSale} 件（库存 ≤3 的 ${s.products.lowStock} 件）`)
  if (s.users) parts.push(`近 7 天新增会员 ${s.users.last7} 人（前 7 天 ${s.users.prev7} 人）`)
  if (s.hr && s.hr.pendingLeaves) parts.push(`待审批请假 ${s.hr.pendingLeaves} 条`)
  return parts.length ? `全局：${parts.join('；')}` : ''
}

/**
 * 给页面的「经营脉搏」（只给计数与金额合计；不含工资）。字段缺失即 null，页面写「—」不编 0。
 */
function pulseOf(snap) {
  const s = snap || {}
  const tr = s.trend
  return {
    asOf: asOfText(s.at),
    orders7: tr ? tr.last7 : null,
    ordersChange: tr ? changePct(tr.last7, tr.prev7) : null,
    gmv7: tr ? Math.round(tr.gmv7) : null,
    today: tr ? tr.today : null,
    onSale: s.products ? s.products.onSale : null,
    lowStock: s.products ? s.products.lowStock : null,
    members7: s.users ? s.users.last7 : null,
    membersChange: s.users ? changePct(s.users.last7, s.users.prev7) : null
  }
}

/**
 * 角色 → 上下文。先给全局一句，再给这个角色专业上用得上的块；没有的指标不编。
 * @returns {Promise<string>} 空串表示这次没有可用上下文
 */
async function contextFor(roleId, db) {
  const snap = await loadSnapshot(db)
  const lines = []
  const g = globalLine(snap)
  if (g) lines.push(g)
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
  if ((roleId === 'procurement' || roleId === 'creative_director') && snap.feishuInv && snap.feishuInv.lines) {
    lines.push(`飞书成品库存镜像 ${snap.feishuInv.lines} 行、合计 ${snap.feishuInv.qty} 件（与库存流水对账用）`)
  }
  if (roleId === 'procurement') {
    const p = snap.purchases
    if (p && p.count) lines.push(`近 ${WINDOW_DAYS} 天 B2B 采购单 ${p.count} 张，合计 ¥${money(p.amount)}（已付 ${p.paid} 张）`)
    const m = snap.moves
    if (m) lines.push(`近 ${WINDOW_DAYS} 天库存流水：入库 ${m.inQty} 件、出库 ${m.outQty} 件、净变化 ${m.net >= 0 ? '+' : ''}${m.net} 件`)
    const o = snap.ops
    if (o && o.count) lines.push(`近 ${WINDOW_DAYS} 天店内采购 ${o.count} 单、合计 ¥${money(o.amount)}（门店 ¥${money(o.storeAmount)} / 工作室 ¥${money(o.studioAmount)}），其中未结 ${o.openCount} 单`)
  }
  if (roleId === 'store_manager' && snap.bookings) lines.push(`近 ${WINDOW_DAYS} 天预约 ${snap.bookings.count} 单`)
  if (roleId === 'hr_manager' && snap.hr) {
    const h = snap.hr
    if (h.headcount) lines.push(`在职员工 ${h.headcount} 人`)
    if (h.payslipCount) lines.push(`${h.month} 工资条 ${h.payslipCount} 份：应发合计 ¥${money(h.gross)}、实发合计 ¥${money(h.net)}、扣款合计 ¥${money(h.deduction)}（只给合计，不含个人明细）`)
    if (h.punches) lines.push(`本月考勤打卡 ${h.punches} 次，其中迟到 ${h.late} 次、早退 ${h.early} 次`)
    if (h.pendingLeaves) lines.push(`待审批请假 ${h.pendingLeaves} 条`)
  }
  if (roleId === 'store_manager' && snap.ops && snap.ops.count) {
    lines.push(`近 ${WINDOW_DAYS} 天店内采购 ${snap.ops.count} 单、合计 ¥${money(snap.ops.amount)}，其中未结 ${snap.ops.openCount} 单`)
  }
  if ((roleId === 'marketing' || roleId === 'data_analyst') && snap.users) lines.push(`近 ${WINDOW_DAYS} 天新增会员 ${snap.users.newCount} 人`)
  if (['marketing', 'cfo', 'data_analyst'].indexOf(roleId) >= 0 && snap.coupons && (snap.coupons.issued || snap.coupons.used)) {
    const c = snap.coupons
    lines.push(`近 ${WINDOW_DAYS} 天发出礼券 ${c.issued} 张、核销 ${c.used} 张${c.rate != null ? `（核销率约 ${c.rate}%，核销含更早领的券）` : ''}`)
  }
  if (roleId === 'creative_director' && snap.orders) lines.push(`近 ${WINDOW_DAYS} 天订单 ${snap.orders.total} 笔`)
  if (!lines.length) return ''
  const asOf = asOfText(snap.at)
  return `${asOf ? `（数据截至北京时间 ${asOf}）` : ''}${lines.join('；')}`.slice(0, TEXT_MAX)
}

module.exports = { summarizeCoupons, lastAsOf, contextFor, loadSnapshot, summarizeTrend, changePct, pctText, globalLine, pulseOf, asOfText, toMs, summarizeOrders, summarizeProducts, summarizeFinance, summarizePurchases, summarizeMoves, summarizeOpsPurchases, summarizeFeishuInventory, summarizeHr, PAID_STATUS, WINDOW_DAYS, TEXT_MAX, __resetCache: () => { cache = { at: 0, value: null } } }
