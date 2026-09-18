/** 从商品文档解析已售数量（真实值） */
function getSoldCount(product) {
  if (!product) return 0
  const sold = parseInt(product.soldCount, 10)
  if (!Number.isNaN(sold) && sold >= 0) return sold
  const legacy = parseInt(product.sales, 10)
  if (!Number.isNaN(legacy) && legacy >= 0) return legacy
  return 0
}

function isOneOfAKindProduct(product) {
  if (!product) return false
  return !!(product.isUnique || product.isOneOfAKind || product.isTreasure)
}

function productTaxonomyText(product) {
  if (!product) return ''
  const tax = product.taxonomy || {}
  return [
    product.rootCategoryName,
    product.rootCategory,
    product.category,
    product.categoryName,
    product.subCategoryName,
    product.title,
    product.latinName,
    tax.order,
    tax.family,
    tax.class,
    tax.genus
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 蝴蝶 / 甲虫判定（用于前端销量展示美化）
 * 甲虫优先，避免「昆虫馆」等宽词误伤。
 */
function getSalesDisplayKind(product) {
  const text = productTaxonomyText(product)
  if (/甲虫|鞘翅|Coleoptera|beetle/i.test(text)) return 'beetle'
  if (
    /蝴蝶|鳞翅|凤蝶|蛱蝶|粉蝶|眼蝶|弄蝶|斑蝶|绢蝶|Lepidoptera|butterfly/i.test(
      text
    )
  ) {
    return 'butterfly'
  }
  return null
}

/** 基于商品 ID 的稳定伪随机整数，区间 [0, maxInclusive] */
function stableRandomInt(seed, maxInclusive) {
  const max = Math.max(0, maxInclusive | 0)
  const s = String(seed || '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % (max + 1)
}

/**
 * 前端展示用销量：
 * - 孤品 / 镇店之宝：返回 null（卡片不展示销量，改打孤品标）
 * - 蝴蝶类：稳定随机 0–50
 * - 甲虫类：稳定随机 0–20
 * - 其它：真实销量
 */
function getDisplaySoldCount(product) {
  if (!product) return 0
  if (isOneOfAKindProduct(product)) return null

  const kind = getSalesDisplayKind(product)
  const seed = product._id || product.id || productTaxonomyText(product)
  if (kind === 'butterfly') return stableRandomInt(seed, 50)
  if (kind === 'beetle') return stableRandomInt(seed, 20)
  return getSoldCount(product)
}

/**
 * ── 2026-09-18：新增「已售 0」的诚实展示口径 ──
 *
 * 问题：美化只覆盖昆虫类（蝴蝶随机 0–50 / 甲虫 0–20），**非昆虫的新品**落到真实值 0，
 * 卡片就渲染出「已售 0」；而随机函数取到 0 时昆虫卡同样会显示「已售 0」。
 *
 * 处置（产品负责人 2026-09-18 拍板 方案 A：**零造假**）：
 *   真实销量为 0 时不再显示「已售 0」，改显示**真实成立**的状态 ——
 *   「建档时间在窗口内的新品」打「馆方新藏」标；否则**什么都不显示**（与孤品一致）。
 *
 * ⚠️ 刻意**没有**做的两件事（都写进了 docs/商品销量展示口径_2026-09-18.md）：
 *   1. 不往 DB 的 `soldCount` 写任何默认值 —— `admin/src/utils/b2bFulfillment.js`
 *      会做 `soldCount = 现有 + 数量`，假基数一旦入库就与真实销量永久混合，排序/报表从此不可信；
 *   2. 不回填"随机美化销量"到非昆虫类 —— 展示层虚构在售商品的销售状况仍属虚假宣传。
 */
// 2026-09-18 产品负责人定：**7 天内**才算「新藏」。定这个数的实测依据（205 件线上商品）：
// 窗内占比 1天 8 / 3天 9 / 7天 38 / 14天 186 / 30天 186 —— 14 天以上几乎等价于"全站"，
// 「新藏」会印在约 180 张卡上而失去信号意义；7 天是唯一能把"这周新到"分出来的档位。
const NEW_ARRIVAL_DAYS = 7
const SOLD_LABEL_NEW = '馆方新藏'

/**
 * 解析商品时间字段（云函数回包可能是 `{ $date }`；本仓已有 4 处按此兼容）。
 * 裸 `new Date(obj)` 会得到 Invalid Date → 新品判定静默失效。
 */
function productTimeMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0
    // ⚠️ 秒级时间戳（10 位）会被 new Date() 当 1970 年 → 新品判定静默失效。
    // 实测云端是毫秒（Date），但历史/脚本写入的文档可能是秒，这里一并认下。
    return value < 1e12 ? value * 1000 : value
  }
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof value === 'object') {
    if (value.$date != null) return productTimeMs(value.$date)
    // Mongo 扩展 JSON：{$date:{$numberLong:"1758000000000"}}
    if (value.$numberLong != null) return productTimeMs(Number(value.$numberLong))
    if (value.$numberDouble != null) return productTimeMs(Number(value.$numberDouble))
    if (typeof value.getTime === 'function') {
      const t = value.getTime()
      return Number.isNaN(t) ? 0 : t
    }
    return 0
  }
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 是否新品：以**建档时间** `createTime` 为准。
 * 选它的理由（不是随手挑）：C 端「最新」排序用的也是 `createTime` ——
 * 拿同一字段说「新藏」，与用户已经看到的排序口径一致。
 * 取不到时间 → **不算新品**（宁可什么都不显示，也不乱打标）。
 */
function isNewArrival(product, nowMs, days) {
  const limitDays = Number(days) > 0 ? Number(days) : NEW_ARRIVAL_DAYS
  // `_createTime` 是云开发自动字段，部分历史文档只有它
  const created = productTimeMs(product && (product.createTime || product._createTime))
  if (!created) {
    // ⚠️ 一条实测反馈（2026-09-18）：卡片上有 NEW 角标、却没有「馆方新藏」。
    // 根因是两套"新"的定义：角标用 `info.isNew`（列表在按最新排序时的上下文），
    // chip 用建档时间。**拿不到建档时间时**退回角标那个信号，保证两者一致；
    // 拿得到时间时以时间为准（那时角标也由同一个函数驱动，见 ProductCard）。
    return !!(product && product.isNew === true)
  }
  const base = Number.isFinite(nowMs) ? nowMs : Date.now()
  return base - created < limitDays * 86400000
}

/**
 * 卡片/详情「销量位」的唯一出口。
 * @returns {{kind:'sold'|'new'|'none', text:string, count:number}}
 *   · 孤品/镇店之宝 → none（由孤品角标承载，不显示销量）
 *   · 展示销量 > 0  → sold「已售 N」
 *   · 展示销量 = 0 且是新建档 → new「馆方新藏」
 *   · 其余 → none（**不显示「已售 0」**）
 * 不变量：`text` 永远不可能是「已售 0」（守卫 test:sold-display 钉住）。
 */
function getSoldDisplay(product, nowMs) {
  const empty = { kind: 'none', text: '', count: 0 }
  if (!product) return empty
  if (isOneOfAKindProduct(product)) return empty
  const raw = getDisplaySoldCount(product)
  const count = raw == null ? 0 : Math.max(0, Math.floor(Number(raw) || 0))
  if (count > 0) return { kind: 'sold', text: `已售 ${count}`, count }
  if (isNewArrival(product, nowMs)) return { kind: 'new', text: SOLD_LABEL_NEW, count: 0 }
  return empty
}

module.exports = {
  getSoldCount,
  getDisplaySoldCount,
  getSalesDisplayKind,
  isOneOfAKindProduct,
  productTimeMs,
  isNewArrival,
  getSoldDisplay,
  NEW_ARRIVAL_DAYS,
  SOLD_LABEL_NEW
}
