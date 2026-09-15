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

module.exports = {
  getSoldCount,
  getDisplaySoldCount,
  getSalesDisplayKind,
  isOneOfAKindProduct
}
