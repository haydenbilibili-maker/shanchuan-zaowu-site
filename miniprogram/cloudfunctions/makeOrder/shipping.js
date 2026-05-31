const FREE_SHIPPING_THRESHOLD = 299
const DEFAULT_SHIPPING_FEE = 15

function calcShipping(goodsAmount) {
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  if (amount >= FREE_SHIPPING_THRESHOLD) return 0
  return DEFAULT_SHIPPING_FEE
}

module.exports = { FREE_SHIPPING_THRESHOLD, DEFAULT_SHIPPING_FEE, calcShipping }
