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

/**
 * 发货「包装图片」上限。**这是可选附件，不是商品图**：
 * 不传时全链路必须与「没有这个功能」完全一致（需求 1：非必须）。
 */
const DEFAULT_MAX_PHOTOS = 6
/** 单张图片地址上限（cloud fileID / https URL 都在此内），防脏数据把私信文档撑大 */
const PHOTO_URL_MAX = 512

/**
 * 这个地址是不是**本机临时路径**（换台设备就失效）。
 * 单独成一个函数、且**不用正则**，是为了让「必须丢掉本机路径」这条判据有唯一、
 * 无转义的落点 —— 正则里的 `\/` 会把守卫的注入锚点坑掉（第一版就因此注入打空却显示"通过"）。
 */
function isLocalTempPhotoPath(url) {
  const s = clean(url)
  return s.indexOf('wxfile://') === 0
    || s.indexOf('http://tmp/') === 0
    || s.indexOf('https://tmp/') === 0
}

/**
 * 这个地址能不能被 `<image src>` 渲染出来（且**换了设备也还在**）。
 */
function isRenderablePhotoUrl(url) {
  const s = clean(url)
  if (!s) return false
  // 云存储 fileID：小程序侧渲染无需再换临时链接
  if (s.indexOf('cloud://') === 0) return true
  // 微信选图/相机返回的是**本机路径**：wxfile:// 或 http://tmp/…
  // 它们只在那台手机上有效，落库 = 别人打开只看到破图。
  if (isLocalTempPhotoPath(s)) return false
  // 其余仅接受 https（生产图床全走 https；http 明文在真机上会被拦或告警）
  return s.indexOf('https://') === 0
}

/**
 * 发货包装图片（**可选**）—— 归一化成「可渲染 URL 字符串数组」。
 *
 * 为什么要有这个函数（而不是各处自己 map 一遍）：
 *   同一批发货图片会**同时**落两处 —— ①「山海有信」私信文档的 `photos` 字段，
 *   ② 订单文档的 `packagePhotos`。两处若各写一份归一化，迟早漂移成
 *   「信里有图、订单详情里没有」（或反过来），而这类不一致**不报错**。
 *   故真源只有这一份，两个调用点都必须过它（守卫 check:package-photos 钉住）。
 *
 * 为什么空输入返回 []（而不是 undefined）：
 *   前端与云端都按「长度 0 = 不渲染任何东西」处理，于是**存量订单/老消息**
 *   （根本没有这个字段）与「店长这次没选图」走**同一条**零渲染分支 —— 这正是需求 4。
 *
 * 只收「看起来能被 <image> 渲染」的地址：
 *   · `cloud://…` 云存储 fileID（本仓上传返回的就是这个）
 *   · `https://…` 远程地址
 *   · `wxfile://` / `http://tmp/…` 这类**本地临时路径**必须丢弃 ——
 *     它们只在那台手机上有效，落库后别的设备只会看到破图（静默坏图）。
 *
 * ⚠️ **不能只用「是不是 http:// 开头」当判据**：微信选图返回的本地路径恰好也是
 *   `http://tmp/…` 形状（2026-09-21 由本模块的行为断言当场抓出 —— 见守卫
 *   `check:package-photos` 的注入 `photos-keep-local`）。本地路径一律排除。
 *
 * @param {Array<string|{url?:string,fileID?:string,src?:string}>} raw
 * @param {{max?:number}} [options]
 * @returns {string[]} 保持输入顺序、去重、已截断
 */
function pickPackagePhotos(raw, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : DEFAULT_MAX_PHOTOS
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const item of list) {
    if (item === null || item === undefined) continue
    const value = typeof item === 'string'
      ? item
      : (typeof item === 'object' ? (item.url || item.fileID || item.src) : '')
    const url = clean(value).slice(0, PHOTO_URL_MAX)
    if (!url) continue
    if (!isRenderablePhotoUrl(url)) continue
    if (out.indexOf(url) !== -1) continue
    out.push(url)
    if (out.length >= max) break
  }
  return out
}

module.exports = {
  orderProductLine,
  formatOrderItem,
  pickMessageProducts,
  pickPackagePhotos,
  isRenderablePhotoUrl,
  isLocalTempPhotoPath,
  DEFAULT_MAX_ITEMS,
  DEFAULT_CARD_MAX,
  DEFAULT_MAX_PHOTOS,
  PHOTO_URL_MAX
}
