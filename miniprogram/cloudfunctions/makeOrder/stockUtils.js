/**
 * 服务端库存：hold / consume / deduct / restore
 *
 * 语义（可回滚）：
 * - holdStock：仅减可用库存（soldCount 不变）——下单预占
 * - consumeHeldStock：仅加 soldCount（库存已在 hold 时扣过）——支付履约
 * - deductStock：减库存 + 加销量 —— 兼容未预占的历史单
 * - restoreHeldStock：加回可用库存（不动 soldCount）——取消/超时释放预占
 * - restoreStock：加回库存；可选回滚销量（退款等）
 *
 * 并发：
 * - 无 SKU：where stock >= n + _.inc
 * - 有 SKU：stockRev 乐观锁重试（数组字段无法做条件 inc）
 */
const MAX_CAS_RETRY = 8

function hasSkus(product) {
  return !!(product && product.hasSku && Array.isArray(product.skus) && product.skus.length > 0)
}

function findSkuIndex(product, skuId) {
  if (!hasSkus(product) || !skuId) return -1
  return product.skus.findIndex((s) => s && s.id === skuId)
}

function sumSkuStock(product) {
  if (!hasSkus(product)) return parseInt(product && product.stock, 10) || 0
  return product.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
}

function updatedCount(res) {
  if (!res || !res.stats) return 0
  return Number(res.stats.updated != null ? res.stats.updated : res.stats.updatedCount) || 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function titleOf(product) {
  return (product && product.title) || '商品'
}

/**
 * SKU 乐观锁更新；mutator(product) => { data, ok, msg }
 */
async function casUpdateProduct(db, _, productId, mutator) {
  let lastMsg = '库存更新失败'
  for (let attempt = 0; attempt < MAX_CAS_RETRY; attempt++) {
    const productRes = await db.collection('products').doc(productId).get()
    const product = productRes.data
    if (!product) throw new Error('商品不存在')

    const planned = mutator(product)
    if (!planned || planned.ok === false) {
      throw new Error(planned && planned.msg ? planned.msg : `库存不足：${titleOf(product)}`)
    }

    const rev = product.stockRev != null ? Number(product.stockRev) : 0
    const nextRev = Number.isFinite(rev) ? rev + 1 : 1
    const patch = { ...(planned.data || {}), stockRev: nextRev }

    let claim
    if (!Number.isFinite(rev) || rev === 0) {
      claim = await db.collection('products').where({
        _id: productId,
        stockRev: _.exists(false)
      }).update({ data: patch })
      if (updatedCount(claim) <= 0) {
        claim = await db.collection('products').where({
          _id: productId,
          stockRev: 0
        }).update({ data: patch })
      }
    } else {
      claim = await db.collection('products').where({
        _id: productId,
        stockRev: rev
      }).update({ data: patch })
    }

    if (updatedCount(claim) > 0) return product

    lastMsg = `库存繁忙：${titleOf(product)}`
    await sleep(20 + attempt * 30)
  }
  throw new Error(lastMsg)
}

async function adjustPlainStock(db, _, productId, buyNum, { deltaStock, deltaSold, title }) {
  if (deltaStock < 0) {
    const need = Math.abs(deltaStock)
    const atomic = await db.collection('products').where({
      _id: productId,
      stock: _.gte(need)
    }).update({
      data: {
        stock: _.inc(deltaStock),
        ...(deltaSold ? { soldCount: _.inc(deltaSold) } : {})
      }
    })
    if (updatedCount(atomic) <= 0) {
      throw new Error(`库存不足：${title || '商品'}`)
    }
    return
  }

  const data = {}
  if (deltaStock) data.stock = _.inc(deltaStock)
  if (deltaSold) data.soldCount = _.inc(deltaSold)
  if (!Object.keys(data).length) return
  await db.collection('products').doc(productId).update({ data })
}

/** 预占：仅减可用库存 */
async function holdStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) throw new Error('商品 ID 无效')

  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) throw new Error('商品不存在')

  if (hasSkus(product) && skuId) {
    await casUpdateProduct(db, _, productId, (p) => {
      const idx = findSkuIndex(p, skuId)
      if (idx < 0) return { ok: false, msg: '规格不存在' }
      const stock = parseInt(p.skus[idx].stock, 10) || 0
      if (stock < buyNum) return { ok: false, msg: `库存不足：${titleOf(p)}` }
      const skus = p.skus.map((s, i) =>
        i === idx ? { ...s, stock: stock - buyNum } : s
      )
      return {
        ok: true,
        data: {
          skus,
          stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
        }
      }
    })
    return
  }

  await adjustPlainStock(db, _, productId, buyNum, {
    deltaStock: -buyNum,
    deltaSold: 0,
    title: titleOf(product)
  })
}

/** 履约消费预占：只加销量 */
async function consumeHeldStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) return
  await db.collection('products').doc(productId).update({
    data: { soldCount: _.inc(buyNum) }
  }).catch((e) => {
    console.warn('consumeHeldStock soldCount failed', productId, skuId, e && e.message)
  })
}

/**
 * 完整扣减（历史未预占订单）：减库存 + 加销量
 */
async function deductStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) throw new Error('商品 ID 无效')

  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) throw new Error('商品不存在')

  if (hasSkus(product) && skuId) {
    await casUpdateProduct(db, _, productId, (p) => {
      const idx = findSkuIndex(p, skuId)
      if (idx < 0) return { ok: false, msg: '规格不存在' }
      const stock = parseInt(p.skus[idx].stock, 10) || 0
      if (stock < buyNum) return { ok: false, msg: `库存不足：${titleOf(p)}` }
      const skus = p.skus.map((s, i) =>
        i === idx ? { ...s, stock: stock - buyNum } : s
      )
      return {
        ok: true,
        data: {
          skus,
          stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0),
          soldCount: _.inc(buyNum)
        }
      }
    })
    return
  }

  await adjustPlainStock(db, _, productId, buyNum, {
    deltaStock: -buyNum,
    deltaSold: buyNum,
    title: titleOf(product)
  })
}

/** 释放预占：加回可用库存，不动销量 */
async function restoreHeldStock(db, _, productId, skuId, count) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) return

  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) return

  if (hasSkus(product) && skuId) {
    await casUpdateProduct(db, _, productId, (p) => {
      const idx = findSkuIndex(p, skuId)
      if (idx < 0) return { ok: false, msg: '规格不存在' }
      const stock = parseInt(p.skus[idx].stock, 10) || 0
      const skus = p.skus.map((s, i) =>
        i === idx ? { ...s, stock: stock + buyNum } : s
      )
      return {
        ok: true,
        data: {
          skus,
          stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
        }
      }
    }).catch((e) => {
      console.warn('restoreHeldStock sku failed', productId, skuId, e && e.message)
    })
    return
  }

  await db.collection('products').doc(productId).update({
    data: { stock: _.inc(buyNum) }
  }).catch((e) => {
    console.warn('restoreHeldStock plain failed', productId, e && e.message)
  })
}

/**
 * 退款等回补：加库存；默认不回滚销量（与历史 refundOrder 一致）
 * options.reverseSold=true 时同时减销量
 */
async function restoreStock(db, _, productId, skuId, count, options = {}) {
  const buyNum = Math.max(1, parseInt(count, 10) || 1)
  if (!productId) return
  const reverseSold = !!options.reverseSold

  const productRes = await db.collection('products').doc(productId).get()
  const product = productRes.data
  if (!product) return

  if (hasSkus(product) && skuId) {
    await casUpdateProduct(db, _, productId, (p) => {
      const idx = findSkuIndex(p, skuId)
      if (idx < 0) return { ok: false, msg: '规格不存在' }
      const stock = parseInt(p.skus[idx].stock, 10) || 0
      const skus = p.skus.map((s, i) =>
        i === idx ? { ...s, stock: stock + buyNum } : s
      )
      const data = {
        skus,
        stock: skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
      }
      if (reverseSold) data.soldCount = _.inc(-buyNum)
      return { ok: true, data }
    }).catch((e) => {
      console.warn('restoreStock sku failed', productId, skuId, e && e.message)
    })
    return
  }

  const data = { stock: _.inc(buyNum) }
  if (reverseSold) data.soldCount = _.inc(-buyNum)
  await db.collection('products').doc(productId).update({ data }).catch((e) => {
    console.warn('restoreStock plain failed', productId, e && e.message)
  })
}

/** 批量预占；失败时回滚已占 */
async function holdOrderProducts(db, _, products) {
  const held = []
  try {
    for (const item of products || []) {
      const productId = item.id || item.productId
      const skuId = item.skuId || ''
      const count = Math.max(1, parseInt(item.count, 10) || 1)
      await holdStock(db, _, productId, skuId, count)
      held.push({ productId, skuId, count })
    }
    return held
  } catch (err) {
    for (let i = held.length - 1; i >= 0; i--) {
      const h = held[i]
      await restoreHeldStock(db, _, h.productId, h.skuId, h.count)
    }
    throw err
  }
}

/** 释放订单预占（幂等）：有 order._id 时先原子标记 stockHoldReleased，再回补库存 */
async function releaseOrderStockHold(db, _, order) {
  if (!order || !order.stockHeld) return { released: false, reason: 'not_held' }
  if (order.stockHoldReleased) return { released: false, reason: 'already_released' }
  if (order.stockHoldConsumed || order.fulfillStockDone) {
    return { released: false, reason: 'already_consumed' }
  }

  const orderId = order._id
  if (orderId) {
    let claimed = await db.collection('orders').where({
      _id: orderId,
      stockHeld: true,
      stockHoldReleased: false
    }).update({
      data: { stockHoldReleased: true }
    })
    if (updatedCount(claimed) <= 0) {
      // 兼容尚未写入 stockHoldReleased=false 的文档
      claimed = await db.collection('orders').where({
        _id: orderId,
        stockHeld: true,
        stockHoldReleased: _.exists(false)
      }).update({
        data: { stockHoldReleased: true }
      })
    }
    if (updatedCount(claimed) <= 0) {
      return { released: false, reason: 'claim_failed' }
    }
  }

  const items = Array.isArray(order.stockHoldItems) && order.stockHoldItems.length
    ? order.stockHoldItems
    : (order.products || []).map((p) => ({
      productId: p.id || p.productId,
      skuId: p.skuId || '',
      count: p.count || 1
    }))

  for (const item of items) {
    await restoreHeldStock(
      db,
      _,
      item.productId || item.id,
      item.skuId || '',
      item.count || 1
    )
  }
  return { released: true, count: items.length }
}

/** 履约侧处理库存：有预占则消费销量；否则走完整扣减 */
async function fulfillOrderStock(db, _, order) {
  const products = order.products || []
  if (order.stockHeld && !order.stockHoldConsumed) {
    for (const item of products) {
      await consumeHeldStock(
        db,
        _,
        item.id || item.productId,
        item.skuId || '',
        item.count || 1
      )
    }
    return { mode: 'consume_hold' }
  }
  for (const item of products) {
    await deductStock(
      db,
      _,
      item.id || item.productId,
      item.skuId || '',
      item.count || 1
    )
  }
  return { mode: 'deduct' }
}

module.exports = {
  hasSkus,
  findSkuIndex,
  sumSkuStock,
  holdStock,
  consumeHeldStock,
  deductStock,
  restoreHeldStock,
  restoreStock,
  holdOrderProducts,
  releaseOrderStockHold,
  fulfillOrderStock
}
