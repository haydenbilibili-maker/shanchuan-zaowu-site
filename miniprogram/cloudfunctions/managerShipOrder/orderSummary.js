/**
 * 山海有信 — 订单商品摘要（规范副本，由 scripts/sync-order-summary.sh 同步到各云函数）
 *
 * 背景：订单类站内信原先只写「订单 ORDxxxxx」，用户看不出买的是什么。
 * 这里把订单商品的**名称 + 规格 + 工艺 + 装裱**渲染成一行可读文本。
 *
 * 字段来源（下单时由 makeOrder/pricing.js 快照进 order.products[]）：
 *   title     商品名称（必有）
 *   skuLabel  规格（来自 SKU 的 specLabel）
 *   count     数量
 *
 * 为什么**只用 skuLabel**、不拼 craftType / framerName：
 *   这两个字段存的是**内部值**——craftType 是 accessory/cloche/wing_art 这类枚举码，
 *   framerName 里混着 NATURE / Amber Light / "Hayden " 这类品牌与带空格的名字。
 *   小程序端靠 config/productTaxonomy.js 的 craftTypeLabel() 才能显示成中文，
 *   而云函数无法 require 该前端配置。把它直接写进用户私信会露出内部码，
 *   看起来像 bug，所以一律不带。
 *
 * 用法：
 *   const { orderProductLine } = require('./orderSummary')
 *   orderProductLine(order.products)                 // "黑马标本·马上有（大号）"
 *   orderProductLine(order.products, { max: 1 })     // 同上；多条时折叠
 *   orderProductLine(null, { fallback: '藏品' })      // "藏品"
 */

/** 默认最多展开几件，超出折叠为「等 N 件」——站内信长度有限，列表过长反而不好读 */
const DEFAULT_MAX_ITEMS = 2

function clean(value) {
  return String(value == null ? '' : value).trim()
}

/** 单件商品：名称（规格）×N */
function formatOrderItem(product) {
  const p = product || {}
  const name = clean(p.title) || clean(p.name) || '藏品'
  const spec = clean(p.skuLabel)
  const count = Number(p.count || p.quantity || 1) || 1
  const specPart = spec ? `（${spec}）` : ''
  const countPart = count > 1 ? ` ×${count}` : ''
  return `${name}${specPart}${countPart}`
}

/**
 * 订单商品摘要。
 * @param {Array} products order.products
 * @param {{max?: number, fallback?: string}} [options]
 */
function orderProductLine(products, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : DEFAULT_MAX_ITEMS
  const fallback = clean(options.fallback) || '藏品订单'
  const list = (Array.isArray(products) ? products : []).filter(Boolean)
  if (!list.length) return fallback

  // 合并同名同规格的重复条目（同一 SKU 被拆成多行时更整洁）
  const merged = []
  for (const item of list) {
    const text = formatOrderItem(item)
    const hit = merged.find((m) => m.text === text)
    if (hit) hit.count += 1
    else merged.push({ text, count: 1 })
  }
  if (merged.length === 1 && merged[0].count > 1) {
    return `${merged[0].text} 等 ${merged[0].count} 件`
  }

  const head = merged.slice(0, max).map((m) => m.text).join('\n')
  return merged.length > max ? `${head}\n等 ${merged.length} 件` : head
}

/** 站内信商品卡上限：超出只留前 N 件，避免私信文档与渲染都过长 */
const DEFAULT_CARD_MAX = 5

/**
 * 站内信商品卡（需求 10：信件里的商品展示粒度 = **名称 + 图片 + 规格**）。
 *
 * 为什么不直接存 order.products：它带着 price / craftType / framerName / tags 等
 * **内部字段**——私信文档没必要、也不该带上（读到一封信就能反推成本与内部枚举码）。
 * 所以这里单独裁一遍，只留可展示口径。
 *
 * 同款同规格（title+skuLabel+image 相同）合并计数，避免 SKU 被拆行时出现重复卡片。
 *
 * @param {Array} products order.products
 * @param {{max?: number}} [options]
 * @returns {Array<{id:string,title:string,image:string,skuLabel:string,count:number}>}
 */
function pickMessageProducts(products, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : DEFAULT_CARD_MAX
  const list = (Array.isArray(products) ? products : []).filter(Boolean)
  const merged = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const p = item
    const title = clean(p.title) || clean(p.name)
    const image = clean(p.image) || clean(p.cover)
    const skuLabel = clean(p.skuLabel)
    // 名称与图片都没有的条目对用户毫无信息量，直接丢
    if (!title && !image) continue
    const id = clean(p.id) || clean(p.productId)
    const key = `${title}|${skuLabel}|${image}`
    const hit = merged.find((m) => m.key === key)
    if (hit) {
      hit.count += Math.max(1, parseInt(p.count, 10) || 1)
      continue
    }
    merged.push({
      key,
      id: id.slice(0, 64),
      title: (title || '藏品').slice(0, 60),
      image: image.slice(0, 512),
      skuLabel: skuLabel.slice(0, 40),
      count: Math.max(1, parseInt(p.count, 10) || 1)
    })
    if (merged.length >= max) break
  }
  return merged.map(({ key, ...rest }) => rest)
}

module.exports = {
  orderProductLine,
  formatOrderItem,
  pickMessageProducts,
  DEFAULT_MAX_ITEMS,
  DEFAULT_CARD_MAX
}
