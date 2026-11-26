/**
 * 联系专员 ·「选择咨询的订单」（2026-11-26 产品负责人：不只按单号，要按商品认）—— 纯函数。
 * 一行 = 商品缩略图 + 首件商品名（多件写「等 N 件」）+ 状态 · 金额 · 日期 + 单号尾号；可按商品名 / 规格 / 单号搜。
 */
const pad = (n) => String(n).padStart(2, '0')

function dateText(v) {
  const t = typeof v === 'number' ? v : Date.parse(v && v.$date ? v.$date : v)
  if (!Number.isFinite(t) || !t) return ''
  const d = new Date(t + 8 * 3600 * 1000)
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

function money(n) {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')
}

/** 云端 recentOrders → 面板行；urlMap = cloud:// → 临时链接 */
function toRows(orders, urlMap) {
  const map = urlMap || {}
  return (Array.isArray(orders) ? orders : []).map((o) => {
    const products = Array.isArray(o.products) ? o.products : []
    const first = products[0] || {}
    const name = String(first.title || o.title || '').trim() || '订单'
    const more = (Number(o.kinds) || products.length) > 1 ? ` 等 ${Number(o.itemCount) || products.length} 件` : (Number(o.itemCount) > 1 ? ` ×${o.itemCount}` : '')
    const img = String(first.image || '')
    const no = String(o.orderNo || '')
    return {
      id: o.id,
      no,
      noTail: no.length > 6 ? no.slice(-6) : no,
      title: name,
      more,
      spec: String(first.spec || ''),
      thumb: map[img] || (/^https?:\/\//.test(img) ? img : ''),
      status: String(o.statusText || ''),
      amount: money(o.amount),
      time: dateText(o.createTime),
      // 搜索用：所有商品名 + 规格 + 单号
      search: products.map((p) => `${p.title || ''} ${p.spec || ''}`).concat(no).join(' ').toLowerCase()
    }
  })
}

function filterRows(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows || []
  return (rows || []).filter((r) => r.search.indexOf(q) !== -1)
}

/** 面板要换临时链接的商品图（只取每单首图） */
function thumbIds(orders) {
  return (Array.isArray(orders) ? orders : []).map((o) => (o.products && o.products[0] && o.products[0].image) || '').filter((u) => /^cloud:\/\//.test(u))
}

module.exports = { toRows, filterRows, thumbIds, dateText }
