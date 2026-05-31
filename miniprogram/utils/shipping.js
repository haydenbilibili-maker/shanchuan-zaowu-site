/**
 * 运费规则（与 makeOrder/shipping.js 保持一致）
 */
const FREE_SHIPPING_THRESHOLD = 299
const DEFAULT_SHIPPING_FEE = 15

function calcShipping(goodsAmount) {
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  if (amount >= FREE_SHIPPING_THRESHOLD) return 0
  return DEFAULT_SHIPPING_FEE
}

function getShippingRuleText() {
  return `满 ¥${FREE_SHIPPING_THRESHOLD} 包邮，否则运费 ¥${DEFAULT_SHIPPING_FEE}`
}

module.exports = {
  FREE_SHIPPING_THRESHOLD,
  DEFAULT_SHIPPING_FEE,
  calcShipping,
  getShippingRuleText
}
