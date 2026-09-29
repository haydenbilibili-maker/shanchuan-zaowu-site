/**
 * 财务账本「按营业日聚合」：同一天可能有多家门店各一条日账（store_shanhaizaowu / store_xingchen …）。
 *
 * 热力日历、「今日」速览在「全部门店」视图下必须把同日多店**求和**；
 * 只取 `records.find(r => r.date === day)` 会随机显示其中一家（2026-09-26 事故：
 * 山川造物 ¥9812.6 / 150 单被星宸 ¥2886.32 / 0 单顶掉，日历显示 ¥2886 且无订单）。
 */

/**
 * @param {Array<{date?: string, revenue?: number, profit?: number, orderCount?: number,
 *   storeId?: string, storeName?: string, storeCode?: string}>} records
 * @returns {Map<string, {
 *   date: string, revenue: number, profit: number, orderCount: number|null,
 *   storeCount: number, records: Array<object>,
 * }>}
 */
export function groupFinanceRecordsByDate(records) {
  const map = new Map()
  for (const r of records || []) {
    const date = String(r?.date || '').trim()
    if (!date) continue
    let g = map.get(date)
    if (!g) {
      g = { date, revenue: 0, profit: 0, orderCount: null, storeCount: 0, records: [] }
      map.set(date, g)
    }
    g.revenue += Number(r.revenue) || 0
    g.profit += Number(r.profit) || 0
    const oc = Number(r.orderCount)
    if (Number.isFinite(oc) && oc > 0) g.orderCount = (g.orderCount || 0) + oc
    g.records.push(r)
    g.storeCount = g.records.length
  }
  for (const g of map.values()) {
    g.revenue = Math.round(g.revenue * 100) / 100
    g.profit = Math.round(g.profit * 100) / 100
  }
  return map
}

/** 日历/提示里的门店短名 */
export function financeRecordStoreLabel(r) {
  const name = String(r?.storeName || '').trim()
  if (name) return name
  return resolveFinanceStore(r).name
}

/**
 * ERP「店铺管理」本地门店（CCYS001 · 长春这有山1号门店）缺 canonical storeId 时写入账本的本地 id，
 * 与 store_shanhaizaowu 同一门店实体。每换浏览器 / 清缓存重建门店就会多一个，故是列表不是单值
 * （2026-09-29 产品负责人拍板归入山川造物）。源头已在 storeStorage.resolveFinanceStoreWriteId 堵住。
 * **全仓各份归属实现须与此逐字一致**：syncFinanceData / getAnalyticsDashboard / dailyDigest /
 * manageStaffWorkspace / 小程序 storeLedger.js，由 `npm run test:finance-ledger-integrity` 比对。
 */
export const LEGACY_MAIN_STORE_IDS = [
  'store_1780146782017_6w0okpr',
  'store_1780160394767_szo1k77',
  'store_1780841157244_p48w0bx',
]

/**
 * 「门店营收」按店拆分的门店目录（2026-09-29 产品负责人：日报门店营收需要区分门店）。
 * 与云函数 syncFinanceData 的 REPORT_STORES、dailyDigest/reportCatalog 的 REPORT_STORES 同一份：
 */
export const FINANCE_REPORT_STORES = [
  { storeId: 'store_shanhaizaowu', name: '山川造物', aliases: LEGACY_MAIN_STORE_IDS },
  { storeId: 'store_xingchen', name: '星宸标本', aliases: [] },
]

/**
 * 账本行 → 门店：别名归主店；**无 storeId 一律归山川造物**（与 syncFinanceData.resolveDocStoreId 同一惯例，
 * 2026-09-29 产品负责人拍板：不按店名/原文推断）。
 */
export function resolveFinanceStore(r) {
  const sid = String(r?.storeId || '').trim()
  const main = FINANCE_REPORT_STORES[0]
  if (!sid || sid === 'default') return { storeId: main.storeId, name: main.name }
  for (const s of FINANCE_REPORT_STORES) {
    if (s.storeId === sid || s.aliases.includes(sid)) return { storeId: s.storeId, name: s.name }
  }
  return { storeId: sid, name: String(r?.storeName || '').trim() || sid }
}

const round2 = (n) => Math.round(n * 100) / 100
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** 当日按店列：营收 = 账本 revenue（POS + 线上 − 退款）；在手现金是余额，不计入营收 */
export const STORE_DAY_COLUMNS = ['revenue', 'pos', 'online', 'refund', 'orderCount', 'cashBalance']
/** 本月按店列 */
export const STORE_MONTH_COLUMNS = ['revenue', 'orderCount', 'days']

function sumColumns(rows, columns) {
  const total = { storeId: '__total__', name: '合计' }
  for (const k of columns) {
    const vals = rows.map((r) => r[k]).filter((v) => v != null)
    total[k] = vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null
  }
  return total
}

function storeOrder(id) {
  const i = FINANCE_REPORT_STORES.findIndex((s) => s.storeId === id)
  return i !== -1 ? i : 500
}

/**
 * 门店营收按店拆分：某一营业日 + 本月（records 已按月份/门店筛选过）。
 * 合计行一律由各店行求和得出（合计 = Σ 各店，结构性保证；守卫另行断言）。
 * @returns {{ date: string, day: {rows: object[], total: object}, month: {rows: object[], total: object} }}
 */
export function buildFinanceStoreBreakdown(records, { date } = {}) {
  const list = (records || []).filter((r) => String(r?.date || '').trim())
  const day = String(date || '').trim() || list.map((r) => r.date).sort().pop() || ''

  const dayMap = new Map()
  const monthMap = new Map()
  for (const r of list) {
    const s = resolveFinanceStore(r)
    let m = monthMap.get(s.storeId)
    if (!m) {
      m = { storeId: s.storeId, name: s.name, revenue: 0, orderCount: null, days: 0, _dates: new Set() }
      monthMap.set(s.storeId, m)
    }
    m.revenue = round2(m.revenue + (Number(r.revenue) || 0))
    const oc = Number(r.orderCount)
    if (Number.isFinite(oc) && oc > 0) m.orderCount = (m.orderCount || 0) + oc
    m._dates.add(r.date)
    m.days = m._dates.size

    if (r.date !== day) continue
    let d = dayMap.get(s.storeId)
    if (!d) {
      d = { storeId: s.storeId, name: s.name }
      STORE_DAY_COLUMNS.forEach((k) => { d[k] = null })
      dayMap.set(s.storeId, d)
    }
    for (const k of STORE_DAY_COLUMNS) {
      const v = k === 'orderCount' ? (Number(r.orderCount) > 0 ? Number(r.orderCount) : null) : numOrNull(r[k])
      if (v == null) continue
      d[k] = round2((d[k] || 0) + v)
    }
  }

  const dayRows = [...dayMap.values()].sort((a, b) => storeOrder(a.storeId) - storeOrder(b.storeId))
  const monthRows = [...monthMap.values()]
    .map(({ _dates, ...rest }) => rest)
    .sort((a, b) => storeOrder(a.storeId) - storeOrder(b.storeId))
  const monthTotal = sumColumns(monthRows, STORE_MONTH_COLUMNS)
  monthTotal.days = new Set(list.map((r) => r.date)).size
  return {
    date: day,
    day: { rows: dayRows, total: sumColumns(dayRows, STORE_DAY_COLUMNS) },
    month: { rows: monthRows, total: monthTotal },
  }
}
