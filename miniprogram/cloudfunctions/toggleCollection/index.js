// cloudfunctions/toggleCollection/index.js
/**
 * C 端收藏 / 购物车 / 想要候补 / 文章收藏与点赞
 * - product：购物车（collections）
 * - favorite：有货备忘收藏（不通知馆员）
 * - wishlist：售罄想要候补（通知馆员补货）
 * - article collect：collections（targetType=article）
 * - article like：likes + articles.stats.likes（articles 已 write:false，必须经云函数）
 * - cartItem：本人购物车改数量 / 删除
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { notifyStaffWishlist } = require('./staffNotify')

async function dispatchWishlistMessage(payload) {
  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', ...payload }
    })
    const result = res.result || {}
    if (result.success) return result
  } catch (e) {
    console.warn('dispatchMessage wishlist failed:', e && e.message)
  }

  const openid = payload.openid
  const eventType = payload.eventType || 'wishlist_restock_request'
  const relatedId = payload.relatedId || ''
  const vars = payload.vars || {}
  const productTitle = vars.productTitle || '藏品'
  const stockHint = vars.stockHint || ''
  const productId = vars.relatedId || String(relatedId).split(':')[0] || ''
  const dedupeKey = `${eventType}:${relatedId}:${openid}`

  // 顾客有信：无模板降级时写简洁确认；员工补货仍用 ops 文案
  const isCustomerConfirm = eventType === 'wishlist_registered'
  try {
    const dup = await db.collection('user_messages').where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) {
      return { success: true, skipped: true, reason: 'dedupe' }
    }
  } catch (e) {
    // ignore
  }
  try {
    await db.collection('user_messages').add({
      data: {
        _openid: openid,
        openid,
        recipient: openid,
        category: isCustomerConfirm ? 'activity' : 'ops',
        type: eventType,
        title: isCustomerConfirm ? '候补已记下' : '藏家想要补货',
        content: isCustomerConfirm
          ? `「${productTitle}」已记入你的候补。\n到货或重新上架时，山海有信会再来一封。`
          : `「${productTitle}」有藏家想要${stockHint}\n请安排新制作或补货。`,
        relatedId,
        actionUrl: isCustomerConfirm
          ? `subpackages/feature/detail/index?id=${productId}`
          : `subpackages/manager/manager/index?tab=1&title=藏品库&editId=${productId}`,
        templateCode: eventType,
        dedupeKey,
        queue: isCustomerConfirm ? 'customer' : 'workflow',
        read: false,
        createTime: db.serverDate(),
        _createTime: db.serverDate()
      }
    })
    return { success: true, fallback: true }
  } catch (e) {
    return { success: false, msg: e && e.message }
  }
}

async function toggleArticleCollect(openid, event) {
  const articleId = String(event.targetId || event.articleId || '').trim()
  if (!articleId) return { success: false, msg: '缺少文章 id' }
  const snapshot = event.snapshot || {}
  const existing = await db
    .collection('collections')
    .where({ _openid: openid, targetType: 'article', targetId: articleId })
    .limit(1)
    .get()
  const row = existing.data && existing.data[0]
  if (row && row._id) {
    await db.collection('collections').doc(row._id).remove()
    return { success: true, action: 'removed', collected: false, msg: '已取消' }
  }
  await db.collection('collections').add({
    data: {
      _openid: openid,
      targetType: 'article',
      targetId: articleId,
      targetTitle: snapshot.title || event.targetTitle || '',
      targetImage: snapshot.coverImage || snapshot.image || event.targetImage || '',
      type: 'article',
      createTime: db.serverDate()
    }
  })
  return { success: true, action: 'added', collected: true, msg: '已收藏' }
}

async function toggleArticleLike(openid, event) {
  const articleId = String(event.targetId || event.articleId || '').trim()
  if (!articleId) return { success: false, msg: '缺少文章 id' }
  const existing = await db
    .collection('likes')
    .where({ _openid: openid, targetType: 'article', targetId: articleId })
    .limit(1)
    .get()
  const row = existing.data && existing.data[0]
  if (row && row._id) {
    await db.collection('likes').doc(row._id).remove()
    try {
      await db.collection('articles').doc(articleId).update({
        data: { 'stats.likes': _.inc(-1) }
      })
    } catch (e) {
      console.warn('articles.stats.likes dec', e && e.message)
    }
    return { success: true, action: 'removed', liked: false, msg: '已取消点赞' }
  }
  await db.collection('likes').add({
    data: {
      _openid: openid,
      targetType: 'article',
      targetId: articleId,
      createTime: db.serverDate()
    }
  })
  try {
    await db.collection('articles').doc(articleId).update({
      data: { 'stats.likes': _.inc(1) }
    })
  } catch (e) {
    console.warn('articles.stats.likes inc', e && e.message)
  }
  return { success: true, action: 'added', liked: true, msg: '已点赞' }
}

async function updateCartItem(openid, event) {
  const id = String(event.id || event.docId || '').trim()
  if (!id) return { success: false, msg: '缺少记录 id' }
  const docRes = await db.collection('collections').doc(id).get()
  const doc = docRes.data
  if (!doc || doc._openid !== openid) {
    return { success: false, code: 'FORBIDDEN', msg: '无权操作该记录' }
  }
  if (event.remove === true || event.action === 'removeCart') {
    await db.collection('collections').doc(id).remove()
    return { success: true, action: 'removed' }
  }
  if (event.count != null) {
    const count = Math.max(1, parseInt(event.count, 10) || 1)
    await db.collection('collections').doc(id).update({
      data: { count, updateTime: db.serverDate() }
    })
    return { success: true, action: 'updated', count }
  }
  return { success: false, msg: '缺少 count 或 remove' }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '请先登录' }

  const engage = String(event.engage || event.mode || '').trim()
  if (engage === 'articleCollect' || (event.type === 'article' && engage !== 'articleLike')) {
    try {
      return await toggleArticleCollect(openid, event)
    } catch (e) {
      console.error(e)
      return { success: false, msg: '操作失败' }
    }
  }
  if (engage === 'articleLike' || event.action === 'toggleLike') {
    try {
      return await toggleArticleLike(openid, event)
    } catch (e) {
      console.error(e)
      return { success: false, msg: '操作失败' }
    }
  }
  if (engage === 'cartItem' || event.action === 'updateCart' || event.action === 'removeCart') {
    try {
      return await updateCartItem(openid, {
        ...event,
        remove: event.action === 'removeCart' || event.remove === true
      })
    } catch (e) {
      console.error(e)
      return { success: false, msg: '操作失败' }
    }
  }

  const { targetId, type, snapshot, skuId, skuLabel, action } = event
  const normalizedSkuId = skuId || ''
  const recordType = type || 'product'
  const isWishlist = recordType === 'wishlist'
  const isFavorite = recordType === 'favorite'
  const isBookmark = isWishlist || isFavorite

  try {
    const check = await db.collection('collections').where({
      _openid: openid,
      productId: targetId,
      skuId: normalizedSkuId,
      type: recordType
    }).get()

    if (action === 'add' || (!action && check.data.length === 0)) {
      const addCount = Math.max(1, parseInt(snapshot && snapshot.count, 10) || 1)
      if (check.data.length > 0) {
        if (isWishlist) {
          return {
            success: true,
            action: 'exists',
            msg: '已登记想要候补',
            already: true
          }
        }
        if (isFavorite) {
          return {
            success: true,
            action: 'exists',
            msg: '已在收藏中',
            already: true
          }
        }
        const existing = check.data[0]
        const newCount = (parseInt(existing.count, 10) || 1) + addCount
        await db.collection('collections').doc(existing._id).update({
          data: {
            count: newCount,
            price: snapshot && snapshot.price != null ? snapshot.price : existing.price,
            title: (snapshot && snapshot.title) || existing.title,
            image: (snapshot && snapshot.image) || existing.image,
            skuLabel: skuLabel || (snapshot && snapshot.skuLabel) || existing.skuLabel || '',
            updateTime: db.serverDate()
          }
        })
        return { success: true, action: 'merged', msg: '已更新数量', count: newCount }
      }
      await db.collection('collections').add({
        data: {
          _openid: openid,
          productId: targetId,
          skuId: normalizedSkuId,
          skuLabel: skuLabel || (snapshot && snapshot.skuLabel) || '',
          type: recordType,
          title: (snapshot && snapshot.title) || '',
          image: (snapshot && snapshot.image) || '',
          price: snapshot && snapshot.price,
          latinName: (snapshot && snapshot.latinName) || '',
          count: isBookmark ? 1 : addCount,
          soldOut: !!(snapshot && snapshot.soldOut),
          createTime: db.serverDate()
        }
      })

      if (isWishlist) {
        const productTitle = (snapshot && snapshot.title) || '藏品'
        const soldOut = !!(snapshot && snapshot.soldOut)
        const dedupeRelatedId = `${targetId}:${openid}`

        // 顾客山海有信：候补登记确认（幂等：wishlist_registered:{productId}:{openid}）
        dispatchWishlistMessage({
          eventType: 'wishlist_registered',
          openid,
          relatedId: `wishlist_registered:${targetId}:${openid}`,
          vars: {
            productTitle,
            relatedId: targetId
          }
        }).catch((err) => console.warn('wishlist user notify failed:', err))

        // 员工工作信息：补货/制作提醒
        notifyStaffWishlist(db, {
          relatedId: dedupeRelatedId,
          vars: {
            productTitle,
            stockHint: soldOut ? '（当前售罄）' : '',
            relatedId: targetId
          },
          dispatchInAppMessage: async (_db, opts) =>
            dispatchWishlistMessage({
              eventType: opts.eventType,
              openid: opts.openid,
              relatedId: opts.relatedId,
              vars: opts.vars
            })
        }).catch((err) => console.warn('wishlist staff notify failed:', err))

        return { success: true, action: 'added', msg: '已登记想要，到货优先通知' }
      }

      if (isFavorite) {
        return { success: true, action: 'added', msg: '已收藏' }
      }

      return { success: true, action: 'added', msg: '已加入购物车' }
    }

    if (check.data.length > 0) {
      await db.collection('collections').doc(check.data[0]._id).remove()
      let removedMsg = '已移出购物车'
      if (isWishlist) removedMsg = '已取消想要候补'
      else if (isFavorite) removedMsg = '已取消收藏'
      return {
        success: true,
        action: 'removed',
        msg: removedMsg
      }
    }

    return { success: true, action: 'none', msg: '未找到记录' }
  } catch (e) {
    console.error(e)
    return { success: false, msg: '操作失败' }
  }
}
