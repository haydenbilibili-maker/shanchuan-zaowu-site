/**
 * 退款金额规则（与 utils/refundPolicy.js 语义一致）
 */

const TREASURE_DEDUCT_RATE = 0.3

function parseYuan(amount) {
  const num = parseFloat(String(amount == null ? 0 : amount).replace(/,/g, ''))
  if (!num || num <= 0) return 0
  return Math.round(num * 100) / 100
}

function isCustomOrder(order) {
  if (!order) return false
  if (order.source === 'custom') return true
  return !!(order.customMeta && order.customMeta.isCustom)
}

function isPetOrder(order) {
  if (!order) return false
  if (order.source === 'pet' || order.source === 'pet_memorial') return true
  return !!(order.pet || order.petMemorial)
}

function isTreasureLike(product) {
  if (!product) return false
  if (product.isTreasure === true || product.isUnique === true) return true
  const text = `${product.title || ''} ${Array.isArray(product.tags) ? product.tags.join(' ') : (product.tags || '')}`
  return /孤品|镇店之宝|镇馆之宝/.test(text)
}

function resolveType(order) {
  if (order && order.refundPolicy && order.refundPolicy.type) return order.refundPolicy.type
  if (isPetOrder(order)) return 'pet'
  if (isCustomOrder(order)) return 'custom'
  const products = (order && order.products) || []
  if (products.some((p) => isTreasureLike(p))) return 'treasure'
  return 'standard'
}

function resolveDeductRate(order) {
  const type = resolveType(order)
  if (order && order.refundPolicy && typeof order.refundPolicy.deductRate === 'number') {
    return order.refundPolicy.deductRate
  }
  return type === 'treasure' ? TREASURE_DEDUCT_RATE : 0
}

function calcRefundYuan(order) {
  const paid = parseYuan(order && order.totalPrice)
  const deductRate = resolveDeductRate(order)
  const deduct = Math.round(paid * deductRate * 100) / 100
  const refund = Math.round((paid - deduct) * 100) / 100
  return {
    type: resolveType(order),
    paid,
    deductRate,
    deduct,
    refund
  }
}

module.exports = {
  TREASURE_DEDUCT_RATE,
  resolveType,
  calcRefundYuan
}
