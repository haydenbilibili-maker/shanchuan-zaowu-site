/**
 * 祈福墙展品主角区的纯逻辑：挑出「这面墙的那件商品」+ 合成展签数据。
 *
 * 为什么需要"挑"：门店码 scene 只有 `from=store_qr&k=mashangyou`，**不带 productId** ——
 * 现场扫码进来的人此前到不了马上有的商品页（页头只剩一枚点不动的「本墙 马上有」）。
 * 页面按既有读取方式（`products` 集合 `read: true`，与详情页 / gift-ops 同形）只读取候选，
 * 这里用与入口组件**同一套**命中口径（`isWishWallProduct` + `resolveWishWallKey`）挑出一件。
 * 不写库、不改任何云函数入参出参。
 */
const { isWishWallProduct, resolveWishWallKey } = require('../../../utils/wishWall')
const { exhibitFor } = require('../../../config/wallExhibit')

/**
 * @param {Array<object>} rows 候选商品（只读查询结果）
 * @param {string} productKey 这面墙的作用域
 * @returns {object|null} 命中的那件；没有就 null（绝不拿别的商品凑数）
 */
function pickWallProduct(rows, productKey) {
  const key = String(productKey || '').trim() || 'mashangyou'
  const list = Array.isArray(rows) ? rows : []
  const hit = list.filter((p) => p && p._id &&
    p.isOffShelf !== true &&
    isWishWallProduct(p) &&
    resolveWishWallKey(p) === key)
  if (!hit.length) return null
  // 显式开了墙的优先（标题子串只是过渡兜底）；同级按 _id 稳定排序，结果可预期
  hit.sort((a, b) => {
    const ea = a.wishWallEnabled === true ? 0 : 1
    const eb = b.wishWallEnabled === true ? 0 : 1
    return (ea - eb) || String(a._id).localeCompare(String(b._id))
  })
  return hit[0]
}

/**
 * 展签数据：静态文案（config/wallExhibit，逐条有出处）+ 商品记录里**读得到**的字段。
 * 商品字段缺失就留空（页面据此不画那一格），不拿占位文字冒充事实。
 *
 * @param {string} productKey
 * @param {object|null} product 已解析的商品（可为 null）
 * @param {string} coverUrl 已换成 https 的主图（cloud:// 由页面换好再传进来）
 */
function buildExhibitView(productKey, product, coverUrl) {
  const base = exhibitFor(productKey)
  if (!base) return null
  const p = product || {}
  return Object.assign({}, base, {
    productId: p._id ? String(p._id) : '',
    cover: String(coverUrl || ''),
    latinName: String(p.latinName || p.latin || ''),
    themeName: String(p.themeName || ''),
    themeNote: String(p.themeNote || '')
  })
}

module.exports = {
  pickWallProduct,
  buildExhibitView
}
