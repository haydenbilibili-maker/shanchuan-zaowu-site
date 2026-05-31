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

async function deductStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) throw new Error('商品 ID 无效')

  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) throw new Error('商品不存在')

  if (hasSkus(product) && skuId) {
    const idx = findSkuIndex(product, skuId)
    if (idx < 0) throw new Error('规格不存在')
    const sku = product.skus[idx]
    const stock = parseInt(sku.stock, 10) || 0
    if (stock < buyNum) throw new Error(`库存不足：${product.title}`)

    const skus = product.skus.map((s, i) =>
      i === idx ? { ...s, stock: stock - buyNum } : s
    )
    await db.collection('products').doc(productId).update({
      data: {
        skus,
        stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0),
        soldCount: _.inc(buyNum)
      }
    })
    return
  }

  const stock = parseInt(product.stock, 10) || 0
  if (stock < buyNum) throw new Error(`库存不足：${product.title}`)

  await db.collection('products').doc(productId).update({
    data: {
      stock: _.inc(-buyNum),
      soldCount: _.inc(buyNum)
    }
  })
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
        stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0),
        soldCount: _.inc(-buyNum)
      }
    })
    return
  }

  await db.collection('products').doc(productId).update({
    data: { stock: _.inc(buyNum), soldCount: _.inc(-buyNum) }
  })
}

module.exports = { hasSkus, deductStock, restoreStock }
