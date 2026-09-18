/**
 * 结账台「顺手带走一件」+ 免邮凑单 —— **纯逻辑**（不碰 UI、不碰数据库、不碰 wx）
 *
 * 业务口径（2026-09-18 产品负责人）：
 *   1. 结账时在结算栏上方摆一件低价品，像超市吧台的口香糖，**一次点按就带走**；
 *      第一优先级：**¥10 以下**（低价植物标本）；
 *      第二优先级：**¥50 以下**（低价植物果实手链）。
 *   2/3. 未达包邮门槛时给「免邮凑单」建议。
 *
 * 为什么单独成模块：这段要被 ① 单测断言、② 购物车页调用、③ 后续结算页复用。
 * 判定/排序全部是纯函数，**不依赖真实网络**，所以能被 `test-checkout-addon.mjs` 逐条钉住。
 *
 * 实测依据（2026-09-18 读代码，非猜测）：
 *   · 购物车 = `collections` 集合（`pages/cart/index.js:361`），商品扩数据来自 `products`；
 *   · 上架过滤的既有写法 = `{ isOffShelf: _.neq(true) }`（`pages/index/index.js:940`）；
 *   · 加车写路径 = 云函数 `toggleCollection`（`pages/cart/index.js:531`、`feature/detail/index.js:1836`）。
 */

/** 优先级阶梯（上→下）。价格上界含边界；下一档从上一档上界之上开始，避免同一件被两档重复计。 */
const ADDON_TIERS = [
  { key: 'under10', maxPrice: 10, label: '10 元以下', en: 'UNDER ¥10' },
  { key: 'under50', maxPrice: 50, label: '50 元以下', en: 'UNDER ¥50' }
]

/** 查询候选池时的价格上界 = 最后一档（用于 DB where，避免把全量商品拉下来） */
const ADDON_MAX_PRICE = ADDON_TIERS[ADDON_TIERS.length - 1].maxPrice

function toPrice(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function pickImage(product) {
  const p = product || {}
  const raw = p.image || p.cover || p.thumbnail
  if (raw) return String(raw)
  const list = Array.isArray(p.images) ? p.images : []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const url = typeof item === 'string' ? item : (item && (item.url || item.src))
    if (url) return String(url)
  }
  return ''
}

/**
 * 商品 → 候选（不合格返回 null）
 *
 * 刻意排除两类：
 *   · `hasSku`：多规格必须让用户选规格，**不是「一次点按」的顺手件**（且加车不带 skuId 会留下无效项）；
 *   · 库存字段明确为 0：不推荐买不到的东西。
 * 注意：`stock` 缺失时**不**当售罄（既有购物车把 NaN/0 视作 99，见 `pages/cart/index.js:403-405`）。
 */
function normalizeCandidate(product) {
  const p = product || {}
  const id = String(p._id || p.id || '').trim()
  if (!id) return null
  if (p.hasSku === true) return null
  if (p.isOffShelf === true) return null
  const price = toPrice(p.price)
  if (price == null) return null
  if (p.stock != null && p.stock !== '' && Number(p.stock) <= 0) return null
  return {
    id,
    title: String(p.title || p.name || '').trim() || '藏品',
    price,
    priceText: price.toFixed(2),
    image: pickImage(p),
    latinName: String(p.latinName || '').trim(),
    categoryPath: String(p.rootCategoryName || p.category || '').trim(),
    stock: p.stock == null || p.stock === '' ? null : Number(p.stock)
  }
}

/** 候选池：规范化 + 排除购物车里已有的 + 去重 */
function listCandidates(products, options) {
  const opts = options || {}
  const exclude = new Set((opts.excludeIds || []).map((x) => String(x)))
  const seen = new Set()
  const out = []
  ;(products || []).forEach((raw) => {
    const c = normalizeCandidate(raw)
    if (!c) return
    if (exclude.has(c.id)) return
    if (seen.has(c.id)) return
    seen.add(c.id)
    out.push(c)
  })
  return out
}

/** 命中第几档（0 起）；都不命中返回 -1 */
function tierIndexOfPrice(price) {
  const p = toPrice(price)
  if (p == null) return -1
  let lower = 0
  for (let i = 0; i < ADDON_TIERS.length; i += 1) {
    const tier = ADDON_TIERS[i]
    if (p > lower && p <= tier.maxPrice) return i
    lower = tier.maxPrice
  }
  return -1
}

/**
 * 挑出「顺手带走」的那一件。
 *
 * 排序 = 业务优先级本身：
 *   ① 先按阶梯（¥10 以下 优先于 ¥50 以下）；
 *   ② 同档内**价格从低到高** —— 顺手件的核心是「不假思索地拿」，越便宜越该排前；
 *   ③ 同价按标题稳定排序（避免每次进购物车换一件，看起来像随机抖动）。
 *
 * @returns {{item:object, tier:object, tierIndex:number}|null}
 */
function pickAddon(candidates) {
  const list = (candidates || []).filter(Boolean)
  if (!list.length) return null
  const scored = list
    .map((item) => ({ item, tierIndex: tierIndexOfPrice(item.price) }))
    .filter((row) => row.tierIndex >= 0)
  if (!scored.length) return null
  scored.sort((a, b) => {
    if (a.tierIndex !== b.tierIndex) return a.tierIndex - b.tierIndex
    if (a.item.price !== b.item.price) return a.item.price - b.item.price
    return String(a.item.title).localeCompare(String(b.item.title), 'zh-Hans-CN')
  })
  const best = scored[0]
  return { item: best.item, tier: ADDON_TIERS[best.tierIndex], tierIndex: best.tierIndex }
}

/**
 * 结算栏文案（把「为什么是它」说清楚：档位 + 价格）
 * @param {{item:object, tier:object}|null} pick
 */
function buildAddonText(pick) {
  if (!pick || !pick.item) return null
  return {
    overline: 'ADD ONE',
    title: '顺手带走一件',
    tierLabel: pick.tier ? pick.tier.label : '',
    priceText: `¥${pick.item.priceText}`,
    cta: '带走',
    reason: pick.tier ? `${pick.tier.label} · 结账台上随手带一件` : '结账台上随手带一件'
  }
}

/**
 * 免邮凑单（需求 2/3）—— 纯函数：运费配置由调用方注入，模块自身不 require 任何文件。
 *
 * 口径必须与结算一致（`pages/cart/index.js:calculateTotal` 的注释已写明）：
 * 包邮门槛按**优惠前商品合计**判定，不要传折后应付，否则会和确认页 / `makeOrder` 对不上。
 *
 * @param {{ goodsAmount:number, selectedItems:Array, shipping:object,
 *   shippingCoveredByCoupon?:boolean }} args
 *   `shippingCoveredByCoupon`：本单已选「免邮券」时传 true —— 否则会一边用券免邮、
 *   一边还在劝「再买 ¥x 免运费」，两个提示互相打架（券的节省额 = 运费，见 `couponSaveFor`）。
 * @returns {null|{campaignActive:boolean, coveredByCoupon:boolean, reached:boolean, gap:number,
 *   gapText:string, fee:number, threshold:number, kindLabel:string, detailText:string,
 *   progress:number, filler:object|null, fillerText:string}}
 */
function computeFreeShipping(args) {
  const opts = args || {}
  const cfg = opts.shipping
  if (!cfg || typeof cfg.resolveThreshold !== 'function') return null

  const amount = Number(opts.goodsAmount) || 0
  const items = Array.isArray(opts.selectedItems) ? opts.selectedItems : []
  const threshold = Number(cfg.resolveThreshold(items)) || 0
  const campaignActive = typeof cfg.isCampaignActive === 'function' ? !!cfg.isCampaignActive() : false
  const fee = typeof cfg.calcShippingFee === 'function'
    ? (Number(cfg.calcShippingFee(amount, items)) || 0)
    : 0
  const kindLabel = typeof cfg.resolveOrderKind === 'function' && cfg.resolveOrderKind(items) === 'accessory'
    ? '饰品'
    : '藏品'
  const carrier = String((cfg.defaultCarrier || cfg.carrier || '顺丰速运')).replace(/速运$/, '')

  if (campaignActive) {
    return {
      campaignActive: true,
      coveredByCoupon: false,
      reached: true,
      gap: 0,
      gapText: '0.00',
      fee: 0,
      threshold,
      kindLabel,
      detailText: typeof cfg.getCampaignLabel === 'function' ? cfg.getCampaignLabel() : '当前全场免邮',
      progress: 100,
      filler: null,
      fillerText: ''
    }
  }

  const rawGap = threshold - amount
  const gap = rawGap > 0 ? Math.round(rawGap * 100) / 100 : 0
  const coveredByCoupon = opts.shippingCoveredByCoupon === true

  /**
   * 「已免邮」的判据**不能**用 `fee <= 0`（原实现的 bug）：
   * `calcShippingFee(0)` 在**没勾选任何商品**时也返回 0 —— 于是刚进购物车（合计 ¥0）就被判成
   * 「已包邮」，免邮凑单行整块不显示（2026-09-18 真机反馈）。
   * 购物车进入时所有条目 `selected:false`（`cloudfunctions/getCartList/index.js:137`），
   * 所以这正是最常见的第一眼状态。
   *
   * 现在只认四种**真的不用付运费**的情形：① 全场免邮活动；② 已选免邮券；
   * ③ 规则本身不收运费（`shippingFee = 0`）；④ 已勾选且合计达门槛。
   * 其余（含「还没勾选」）一律显示进度与缺口。
   */
  const rawFee = cfg.shippingFee != null ? cfg.shippingFee : cfg.flatFee
  const hasFeeConfig = rawFee != null && Number.isFinite(Number(rawFee))
  const baseFee = hasFeeConfig ? Number(rawFee) : 0
  // 配置缺失时按「要收运费」处理：宁可多提示一次，也不要把可能省下的运费吞掉（fail-safe）
  const feeChargeable = hasFeeConfig ? baseFee > 0 : true
  const amountReached = amount > 0 && amount >= threshold
  const reached = campaignActive || coveredByCoupon || amountReached || !feeChargeable
  /** 展示与凑单上界用「本单实际适用的运费」：未达门槛时就是规则里的 flat fee */
  const applicableFee = reached ? 0 : (fee > 0 ? fee : baseFee)
  const progress = threshold > 0 ? Math.min(100, Math.max(0, Math.round((amount / threshold) * 100))) : 100

  return {
    campaignActive: false,
    coveredByCoupon,
    reached,
    gap,
    // 与 formatPrice / buildAddonText 同口径：金额一律两位小数（勿只吃 .00，否则 ¥7.5 与 ¥7.00 两种形态并存）
    gapText: gap.toFixed(2),
    fee: applicableFee,
    baseFee,
    threshold,
    kindLabel,
    /** 还没勾选任何商品：UI 据此把「再买」换成中性的「满 … 免运费」（进度为 0） */
    nothingSelected: amount <= 0,
    gapTitle: amount > 0
      ? `再买 ¥${gap.toFixed(2)} 免运费`
      : `${kindLabel}满 ¥${threshold} 免运费`,
    detailText: coveredByCoupon
      ? '已用免邮券 · 本单免运费'
      : (reached
        ? `${carrier} · 已包邮（${kindLabel}满 ¥${threshold}）`
        : `${carrier} · ${kindLabel}满 ¥${threshold} 包邮，当前运费 ¥${applicableFee}`),
    progress: reached ? 100 : progress,
    filler: null,
    fillerText: ''
  }
}

/**
 * 挑「凑单那一件」：只推荐**加了它以后多花的钱不超过本来要付的运费**的商品，
 * 即 `gap ≤ price ≤ gap + fee`。区间内取最便宜的（最小代价刚刚够到免邮）。
 *
 * 为什么要有上界：门槛 ¥500、缺口 ¥480 时，推一件 ¥50 的毫无意义（加完还差 ¥430）；
 * 而缺口 ¥8、运费 ¥18 时，加一件 ¥9.9 是明显划算的 —— 上界把这两种情况分开。
 */
function pickGapFiller(candidates, freeShip) {
  const fs = freeShip || {}
  if (!fs || fs.reached || !(fs.fee > 0) || !(fs.gap > 0)) return null
  const max = fs.gap + fs.fee
  const list = (candidates || [])
    .filter(Boolean)
    .filter((c) => c.price >= fs.gap && c.price <= max)
  if (!list.length) return null
  list.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price
    return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
  })
  return list[0]
}

/** 把凑单件写进 freeShip（返回新对象，便于 setData） */
function attachGapFiller(freeShip, candidates) {
  if (!freeShip) return null
  const filler = pickGapFiller(candidates, freeShip)
  return Object.assign({}, freeShip, {
    filler,
    fillerText: filler
      ? `凑单：加 ¥${filler.priceText}「${filler.title}」即免邮`
      : ''
  })
}

module.exports = {
  ADDON_TIERS,
  ADDON_MAX_PRICE,
  normalizeCandidate,
  listCandidates,
  tierIndexOfPrice,
  pickAddon,
  buildAddonText,
  computeFreeShipping,
  pickGapFiller,
  attachGapFiller
}
