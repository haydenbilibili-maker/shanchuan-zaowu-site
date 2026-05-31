/** 从商品文档解析已售数量 */
function getSoldCount(product) {
  if (!product) return 0
  const sold = parseInt(product.soldCount, 10)
  if (!Number.isNaN(sold) && sold >= 0) return sold
  const legacy = parseInt(product.sales, 10)
  if (!Number.isNaN(legacy) && legacy >= 0) return legacy
  return 0
}

module.exports = { getSoldCount }
