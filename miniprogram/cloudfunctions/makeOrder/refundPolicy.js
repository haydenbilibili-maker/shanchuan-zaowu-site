/**
 * 下单时快照退款规则（与 utils/refundPolicy.js 语义一致）
 */

const TREASURE_DEDUCT_RATE = 0.3

function textIncludesUnique(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '')
  return /孤品|镇店之宝|镇馆之宝/.test(text)
}

function isTreasureLike(product) {
  if (!product) return false
  if (product.isTreasure === true || product.isUnique === true) return true
  return textIncludesUnique(product.title) || textIncludesUnique(product.tags)
}

function snapshotFromOrderContext({ isCustom, products }) {
  if (isCustom) {
    return {
      type: 'custom',
      deductRate: 0,
      label: '定制标本',
      shortLabel: '定制不退款'
    }
  }
  const hasTreasure = (products || []).some((p) => isTreasureLike(p))
  if (hasTreasure) {
    return {
      type: 'treasure',
      deductRate: TREASURE_DEDUCT_RATE,
      label: '镇店之宝 / 孤品',
      shortLabel: '退款扣 30% 损耗'
    }
  }
  return {
    type: 'standard',
    deductRate: 0,
    label: '现货藏品',
    shortLabel: '发货前可申请退款'
  }
}

module.exports = {
  TREASURE_DEDUCT_RATE,
  isTreasureLike,
  snapshotFromOrderContext
}
