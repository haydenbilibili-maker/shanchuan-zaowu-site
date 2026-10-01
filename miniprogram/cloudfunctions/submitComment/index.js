/**
 * 提交评价 / 查询订单评价资格
 * action: submit（默认）| check | orderStatus
 *
 * 商品评价必须绑定已签收订单：orderId + productId，防重复。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { checkText, checkFileImages } = require('./contentSecurity')

const ALLOWED_TARGET_TYPES = new Set(['product', 'activity', 'course'])
const MAX_IMAGES = 3
const MIN_CONTENT = 5
const MAX_CONTENT = 500

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function isOrderActor(order, openid) {
  if (!openid || !order) return false
  if (openid === order._openid || openid === order.openid) return true
  const receiver = order.giftMeta && order.giftMeta.receiverOpenid
  return !!(receiver && receiver === openid)
}

function productIdOf(p) {
  if (!p || typeof p !== 'object') return ''
  return String(p.id || p._id || p.productId || '').trim()
}

function isVoucherLikeProduct(p) {
  if (!p) return false
  const priceStr = p.price != null ? String(p.price) : ''
  if (priceStr.includes('PTS') || priceStr.includes('积分')) return true
  const latinUpper = p.latin ? String(p.latin).toUpperCase() : ''
  if (latinUpper === 'COUPON' || latinUpper === 'VOUCHER' || latinUpper.includes('COUPON')) return true
  const type = String(p.type || p.productType || '').toLowerCase()
  return type === 'voucher' || type === 'coupon'
}

function isVoucherOrder(order) {
  if (!order) return true
  if (order.source === 'exchange') return true
  const products = Array.isArray(order.products) ? order.products : []
  if (!products.length) return true
  return products.every(isVoucherLikeProduct)
}

function listReviewableProducts(order) {
  const products = Array.isArray(order && order.products) ? order.products : []
  const seen = new Set()
  const list = []
  products.forEach((p) => {
    if (isVoucherLikeProduct(p)) return
    const id = productIdOf(p)
    if (!id || seen.has(id)) return
    seen.add(id)
    list.push({
      productId: id,
      title: p.title || p.name || '藏品',
      image: (Array.isArray(p.images) && p.images[0]) || p.image || p.cover || '',
      latinName: p.latinName || p.latin || ''
    })
  })
  return list
}

/** createdAt 是 Date、updatedAt 经审核后是毫秒数（moderateComment 写 Date.now()），比较前统一成毫秒 */
function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  if (typeof value === 'object' && value.$date) return new Date(value.$date).getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

/** 本人评价的只读快照（评价页「我的评价」查看态用）；只给本人自己的那条 */
function myReviewOf(comment) {
  if (!comment) return null
  return {
    status: comment.status || 'pending',
    rating: Number(comment.rating) || 0,
    content: String(comment.content || ''),
    images: Array.isArray(comment.images) ? comment.images.filter(Boolean).slice(0, MAX_IMAGES) : [],
    createdAt: toMs(comment.createdAt),
    merchantReply: comment.merchantReply ? String(comment.merchantReply) : ''
  }
}

function statusLabel(status) {
  if (status === 'approved') return '已评价'
  if (status === 'pending') return '审核中'
  if (status === 'hidden') return '已隐藏'
  if (status === 'rejected') return '未通过'
  return '去评价'
}

/**
 * 评价内容安全：文本 + 图片。
 * - 违规（risky）→ 直接拒绝
 * - 检测报错/图片超限 → 不拒绝但记录原因，评论保持 pending 由人工审核
 */
async function runCommentChecks(openid, content, images) {
  const reviewReasons = []
  const textCheck = await checkText(openid, content, 2)
  if (!textCheck.ok && textCheck.reason === 'risky') {
    return { ok: false, msg: '内容未通过安全检测，请稍作修改后再试' }
  }
  if (!textCheck.ok) reviewReasons.push(textCheck.openapiUnavailable ? 'text_check_openapi_unavailable' : 'text_check_error')
  else if (textCheck.needReview) reviewReasons.push('text_suggest_review')

  const imgCheck = await checkFileImages(images, 9)
  if (!imgCheck.ok && imgCheck.reason === 'risky') {
    return { ok: false, msg: '图片未通过安全检测，请更换后重试' }
  }
  if (!imgCheck.ok) reviewReasons.push(imgCheck.openapiUnavailable ? 'image_check_openapi_unavailable' : `image_check_${imgCheck.reason}`)

  return { ok: true, reviewReasons, textSuggest: textCheck.suggest || '' }
}

async function loadOrder(orderId) {
  const res = await db.collection('orders').doc(orderId).get()
  return res.data || null
}

async function findCommentsForOrder(orderId, userId) {
  const res = await db
    .collection('comments')
    .where({
      orderId,
      userId,
      targetType: 'product',
      status: _.neq('rejected')
    })
    .limit(50)
    .get()
  return res.data || []
}

async function buildOrderStatus(orderId, openid) {
  if (!orderId) return fail('缺少订单 ID')
  const order = await loadOrder(orderId)
  if (!order) return fail('订单不存在')
  if (!isOrderActor(order, openid)) return fail('无权查看此订单评价', { code: 'FORBIDDEN' })

  const reviewable = listReviewableProducts(order)
  const received = order.status === 'received' || order.status === 'signed'
  const voucher = isVoucherOrder(order)
  const existing = received && !voucher ? await findCommentsForOrder(orderId, openid) : []
  const byProduct = {}
  existing.forEach((c) => {
    const pid = String(c.targetId || '').trim()
    if (!pid) return
    const prev = byProduct[pid]
    if (!prev || toMs(c.updatedAt || c.createdAt) > toMs(prev.updatedAt || prev.createdAt)) {
      byProduct[pid] = c
    }
  })

  const products = reviewable.map((p) => {
    const comment = byProduct[p.productId]
    const status = comment ? comment.status || 'pending' : 'none'
    return {
      ...p,
      reviewStatus: status,
      statusLabel: statusLabel(status),
      canReview: received && !voucher && status === 'none',
      commentId: comment ? comment._id : '',
      rating: comment ? comment.rating : 0,
      myReview: myReviewOf(comment)
    }
  })

  const pendingCount = products.filter((p) => p.canReview).length
  const reviewedCount = products.filter((p) => p.reviewStatus !== 'none').length

  return {
    success: true,
    orderId,
    orderStatus: order.status || '',
    received,
    voucherOrder: voucher,
    canReviewAny: pendingCount > 0,
    pendingCount,
    reviewedCount,
    totalReviewable: products.length,
    products,
    summaryLabel:
      products.length === 0
        ? '无需评价'
        : pendingCount > 0
          ? `还有 ${pendingCount} 件可评价`
          : reviewedCount > 0
            ? '已评价'
            : '暂不可评价'
  }
}

async function checkEligibility(event, openid) {
  const orderId = String(event.orderId || '').trim()
  const targetType = String(event.targetType || 'product').trim() || 'product'
  const targetId = String(event.targetId || event.productId || '').trim()

  if (targetType !== 'product') {
    return {
      success: true,
      canReview: true,
      targetType,
      targetId,
      reason: ''
    }
  }

  if (!orderId) {
    return fail('请从已签收订单进入评价', { code: 'NEED_ORDER', canReview: false })
  }
  if (!targetId) return fail('缺少商品 ID', { canReview: false })

  const statusRes = await buildOrderStatus(orderId, openid)
  if (!statusRes.success) return { ...statusRes, canReview: false }

  const hit = (statusRes.products || []).find((p) => p.productId === targetId)
  if (!hit) {
    return fail('该订单中没有这件商品', { code: 'NOT_IN_ORDER', canReview: false })
  }
  if (!statusRes.received) {
    return fail('确认签收后再评价', { code: 'NOT_RECEIVED', canReview: false, orderStatus: statusRes })
  }
  if (statusRes.voucherOrder) {
    return fail('此订单无需评价', { code: 'VOUCHER', canReview: false })
  }
  if (!hit.canReview) {
    return {
      success: true,
      canReview: false,
      code: hit.reviewStatus === 'pending' ? 'PENDING' : 'ALREADY',
      msg: hit.reviewStatus === 'pending' ? '评价审核中，通过后将展示在商品页' : '这件藏品已评价过',
      product: hit,
      orderStatus: statusRes
    }
  }

  return {
    success: true,
    canReview: true,
    msg: '可以评价',
    product: hit,
    orderStatus: statusRes
  }
}

async function submitProductReview(event, openid) {
  const orderId = String(event.orderId || '').trim()
  const targetId = String(event.targetId || event.productId || '').trim()
  const rating = Number(event.rating)
  const content = String(event.content || '').trim()
  const images = Array.isArray(event.images) ? event.images.filter(Boolean).slice(0, MAX_IMAGES) : []

  if (!orderId) return fail('请从已签收订单进入评价', { code: 'NEED_ORDER' })
  if (!targetId) return fail('缺少商品 ID')
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return fail('请选择 1–5 星评分')
  if (!content) return fail('请写下你的感受')
  if (content.length < MIN_CONTENT) return fail(`评价至少 ${MIN_CONTENT} 个字`)
  if (content.length > MAX_CONTENT) return fail(`评价不超过 ${MAX_CONTENT} 字`)
  if (images.length > MAX_IMAGES) return fail(`最多上传 ${MAX_IMAGES} 张图片`)

  const eligibility = await checkEligibility(
    { orderId, targetType: 'product', targetId },
    openid
  )
  if (!eligibility.success) return eligibility
  if (!eligibility.canReview) {
    return fail(eligibility.msg || '暂不可评价', {
      code: eligibility.code,
      product: eligibility.product,
      orderStatus: eligibility.orderStatus
    })
  }

  const secCheck = await runCommentChecks(openid, content, images)
  if (!secCheck.ok) return fail(secCheck.msg)

  const now = new Date()
  const product = eligibility.product || {}
  const result = await db.collection('comments').add({
    data: {
      targetType: 'product',
      targetId,
      orderId,
      userId: openid,
      rating: Math.round(rating),
      content,
      images,
      productTitle: product.title || '',
      likes: 0,
      likedBy: [],
      replies: [],
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
  })

  try {
    await cloud.callFunction({
      name: 'earnPoints',
      data: {
        action: 'review',
        productId: targetId,
        sourceId: result._id
      }
    })
  } catch (e) {
    console.warn('发放评价奖励失败:', e)
  }

  return {
    success: true,
    msg: '已收到，审核通过后会展示在商品页',
    commentId: result._id,
    status: 'pending'
  }
}

async function submitGenericReview(event, openid) {
  const targetType = String(event.targetType || '').trim()
  const targetId = String(event.targetId || '').trim()
  const rating = Number(event.rating)
  const content = String(event.content || '').trim()
  const images = Array.isArray(event.images) ? event.images.filter(Boolean).slice(0, MAX_IMAGES) : []

  if (!ALLOWED_TARGET_TYPES.has(targetType) || !targetId) return fail('参数不完整')
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return fail('请选择 1–5 星评分')
  if (!content) return fail('请写下你的感受')
  if (content.length < MIN_CONTENT) return fail(`评价至少 ${MIN_CONTENT} 个字`)
  if (images.length > MAX_IMAGES) return fail(`最多上传 ${MAX_IMAGES} 张图片`)

  const secCheck = await runCommentChecks(openid, content, images)
  if (!secCheck.ok) return fail(secCheck.msg)

  const existingComment = await db
    .collection('comments')
    .where({
      targetType,
      targetId,
      userId: openid,
      status: _.neq('rejected')
    })
    .limit(1)
    .get()

  if (existingComment.data.length > 0) {
    const commentId = existingComment.data[0]._id
    await db.collection('comments').doc(commentId).update({
      data: {
        rating: Math.round(rating),
        content,
        images,
        status: 'pending',
        updatedAt: new Date()
      }
    })
    return { success: true, msg: '评价已更新，等待审核', commentId, status: 'pending' }
  }

  const result = await db.collection('comments').add({
    data: {
      targetType,
      targetId,
      userId: openid,
      rating: Math.round(rating),
      content,
      images,
      likes: 0,
      likedBy: [],
      replies: [],
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })

  return {
    success: true,
    msg: '评价提交成功，等待审核',
    commentId: result._id,
    status: 'pending'
  }
}

exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  if (!openid) return fail('请先登录')

  const action = String(event.action || 'submit').trim() || 'submit'

  try {
    if (action === 'check') {
      return await checkEligibility(event, openid)
    }
    if (action === 'orderStatus') {
      return await buildOrderStatus(String(event.orderId || '').trim(), openid)
    }
    if (action === 'submit') {
      const targetType = String(event.targetType || 'product').trim() || 'product'
      if (targetType === 'product') {
        return await submitProductReview(event, openid)
      }
      return await submitGenericReview(event, openid)
    }
    return fail('未知操作')
  } catch (e) {
    console.error('submitComment failed:', action, e)
    return fail(e.message || '提交评价失败')
  }
}
