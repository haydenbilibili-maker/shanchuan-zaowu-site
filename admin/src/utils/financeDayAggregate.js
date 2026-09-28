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
  const id = String(r?.storeId || r?.storeCode || '').trim()
  if (/xingchen/i.test(id)) return '星宸'
  if (/shanhaizaowu/i.test(id)) return '山川造物'
  return id || '未标门店'
}
