/**
 * 服务端库存操作（SKU 兼容）
 */
function hasSkus(product) {
  return !!(product && product.hasSku && Array.isArray(product.skus) && product.skus.length > 0)
}

function findSkuIndex(product, skuId) {
  if (!hasSkus(product) || !skuId) return -1
  return product.skus.findIndex((s) => s && s.id === skuId)
}

async function restoreStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) return

  if (hasSkus(product) && skuId) {
    const idx = findSkuIndex(product, skuId)
    if (idx < 0) return
    const skus = product.skus.map((s, i) =>
      i === idx ? { ...s, stock: (parseInt(s.stock, 10) || 0) + buyNum } : s
    )
    await db.collection('products').doc(productId).update({
      data: {
        skus,
        stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
      }
    })
    return
  }

  await db.collection('products').doc(productId).update({
    data: { stock: _.inc(buyNum) }
  })
}

module.exports = { restoreStock }
