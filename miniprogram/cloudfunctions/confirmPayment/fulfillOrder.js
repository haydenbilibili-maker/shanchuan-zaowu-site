/**
 * 支付成功后履约：扣库存、核销券、更新订单、清理购物车
 * 礼赠 invite_address → paid_awaiting_address（填址前不可发货）
 *
 * 幂等：pending_pay → fulfilling 原子抢占，避免 confirmPayment / payCallback 双路重复扣库存。
 */
const { fulfillOrderStock, releaseOrderStockHold } = require('./stockUtils')
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')
const { notifyStaffNewOrder } = require('./staffNotify')
const {
  isInviteAddressGift,
  isGiftOrder,
  computeExpireAt,
  createClaimCode,
  DEFAULT_ADDRESS_TIMEOUT_DAYS
} = require('./giftMeta')
const { notifyGiftSubscribe } = require('./giftSubscribe')
const { buildAddressLine } = require('./staffOrderSubscribe')
const { postCommissionForOrder, notifyArtisanSkuSold } = require('./artisanCommission')
const {
  fulfillDepositPayment,
  settleDepositIntentAfterOrder,
  isDepositOrder
} = require('./depositFulfill')

const DONE_STATUSES = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']
const STALE_FULFILL_MS = 90 * 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function updatedCount(res) {
  if (!res || !res.stats) return 0
  return Number(res.stats.updated != null ? res.stats.updated : res.stats.updatedCount) || 0
}

function createPickupCode() {
  return require('crypto').randomBytes(5).toString('hex').toUpperCase()
}

const WALLET_INTERNAL_KEY =
  process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

/** 支付超时关单前释放 held 钱包（与 cancelOrder 同口径） */
async function releaseHeldWalletOnPayTimeout(orderId, order) {
  if (!(order.walletDebitStatus === 'held' || (Number(order.walletPaidFen) || 0) > 0)) {
    return
  }
  try {
    const payload = {
      action: 'refundWalletForOrder',
      orderId,
      openid: order._openid,
      remark: '支付超时·钱包回账'
    }
    if (WALLET_INTERNAL_KEY) payload.internalKey = WALLET_INTERNAL_KEY
    const res = await cloud.callFunction({
      name: 'manageStoredValue',
      data: payload
    })
    const result = (res && res.result) || {}
    if (result.success === false && !result.nothingToRefund) {
      console.warn('fulfillOrder timeout wallet release incomplete', orderId, result)
    }
  } catch (e) {
    console.warn('fulfillOrder timeout wallet release failed', orderId, e && e.message)
  }
}

async function unlockCouponOnTimeout(db, _, order, orderId) {
  if (!order.couponId) return
  try {
    const couponRes = await db.collection('user_coupons').doc(order.couponId).get()
    const coupon = couponRes.data
    if (
      coupon &&
      coupon.status === 'locked' &&
      (!coupon.lockedOrderId || coupon.lockedOrderId === orderId)
    ) {
      await db.collection('user_coupons').doc(order.couponId).update({
        data: {
          status: 'unused',
          lockedOrderId: _.remove(),
          lockedTime: _.remove()
        }
      })
    }
  } catch (e) {
    console.warn('fulfillOrder timeout coupon unlock failed:', e && e.message)
  }
}

async function waitPeerFulfill(db, orderId, openid) {
  for (let i = 0; i < 10; i++) {
    await sleep(350)
    const res = await db.collection('orders').doc(orderId).get()
    const order = res.data
    if (!order || order._openid !== openid) throw new Error('无权操作此订单')
    if (DONE_STATUSES.includes(order.status)) {
      return {
        success: true,
        alreadyPaid: true,
        orderId,
        status: order.status,
        isGift: isGiftOrder(order),
        inviteAddress: isGiftOrder(order) && isInviteAddressGift(order)
      }
    }
    if (order.status !== 'fulfilling') break
  }
  return null
}

async function tryClaimPending(db, orderId) {
  const claim = await db.collection('orders').where({
    _id: orderId,
    status: 'pending_pay'
  }).update({
    data: {
      status: 'fulfilling',
      fulfillStartedAt: db.serverDate()
    }
  })
  return updatedCount(claim) > 0
}

async function tryReclaimStale(db, orderId) {
  const res = await db.collection('orders').doc(orderId).get()
  const order = res.data
  if (!order || order.status !== 'fulfilling') return { ok: false, order }
  if (order.fulfillStockDone && order.fulfillCouponDone) {
    return { ok: true, order, resume: true }
  }
  const started = order.fulfillStartedAt ? new Date(order.fulfillStartedAt).getTime() : 0
  const stale = !started || (Date.now() - started > STALE_FULFILL_MS)
  if (!stale && order.fulfillStockDone) {
    return { ok: true, order, resume: true }
  }
  if (!stale) return { ok: false, order }
  await db.collection('orders').doc(orderId).update({
    data: { fulfillStartedAt: db.serverDate() }
  }).catch(() => {})
  return { ok: true, order, resume: true }
}

async function fulfillOrder(db, _, orderId, openid) {
  const orderRes = await db.collection('orders').doc(orderId).get()
  let order = orderRes.data

  if (!order) throw new Error('订单不存在')
  if (order._openid !== openid) throw new Error('无权操作此订单')

  if (DONE_STATUSES.includes(order.status)) {
    return {
      success: true,
      alreadyPaid: true,
      orderId,
      status: order.status,
      isGift: isGiftOrder(order),
      inviteAddress: isGiftOrder(order) && isInviteAddressGift(order)
    }
  }

  if (order.status === 'pending_pay') {
    if (order.payExpireTime && new Date(order.payExpireTime) < new Date()) {
      await releaseHeldWalletOnPayTimeout(orderId, order)
      await releaseOrderStockHold(db, _, { ...order, _id: orderId }).catch((e) =>
        console.warn('fulfillOrder timeout stock release', e && e.message)
      )
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'void',
          cancelReason: '支付超时'
        }
      })
      await unlockCouponOnTimeout(db, _, order, orderId)
      throw new Error('订单已超时，请重新下单')
    }

    const claimed = await tryClaimPending(db, orderId)
    if (!claimed) {
      const peer = await waitPeerFulfill(db, orderId, openid)
      if (peer) return peer
      const reclaim = await tryReclaimStale(db, orderId)
      if (!reclaim.ok) {
        const peer2 = await waitPeerFulfill(db, orderId, openid)
        if (peer2) return peer2
        throw new Error('订单状态不可支付')
      }
      order = reclaim.order
    } else {
      order = { ...order, status: 'fulfilling' }
    }
  } else if (order.status === 'fulfilling') {
    const peer = await waitPeerFulfill(db, orderId, openid)
    if (peer) return peer
    const reclaim = await tryReclaimStale(db, orderId)
    if (!reclaim.ok) {
      const peer2 = await waitPeerFulfill(db, orderId, openid)
      if (peer2) return peer2
      throw new Error('订单支付确认中，请稍后刷新')
    }
    order = reclaim.order
  } else {
    throw new Error('订单状态不可支付')
  }

  // 定金单：不占库存、不走普通发货履约
  if (isDepositOrder(order)) {
    const depositResult = await fulfillDepositPayment(db, _, order, orderId)
    cloud
      .callFunction({
        name: 'manageDeposit',
        data: {
          action: 'afterDepositPaid',
          _internal: true,
          intentId: depositResult.intentId || order.depositIntentId || '',
          productId: depositResult.productId || order.depositProductId || '',
          openid: order._openid || openid || '',
          orderId,
          orderNo: order.orderNo || '',
          depositAmount: order.totalPrice,
          productTitle:
            (order.products && order.products[0] && order.products[0].title) || ''
        }
      })
      .catch((err) => console.warn('afterDepositPaid notify', err && err.message))
    return depositResult
  }

  if (!order.fulfillStockDone) {
    const stockResult = await fulfillOrderStock(db, _, order)
    const stockPatch = {
      fulfillStockDone: true
    }
    if (stockResult.mode === 'consume_hold') {
      stockPatch.stockHoldConsumed = true
    }
    await db.collection('orders').doc(orderId).update({
      data: stockPatch
    })
    order.fulfillStockDone = true
    if (stockResult.mode === 'consume_hold') order.stockHoldConsumed = true
  }

  if (order.couponId && !order.fulfillCouponDone) {
    const couponRes = await db.collection('user_coupons').doc(order.couponId).get()
    const coupon = couponRes.data
    if (coupon) {
      const lockedForThis =
        coupon.status === 'locked' &&
        (!coupon.lockedOrderId || coupon.lockedOrderId === orderId)
      const unusedOk = ['unused', 'available'].includes(String(coupon.status || '').toLowerCase())
      if (lockedForThis || unusedOk) {
        await db.collection('user_coupons').doc(order.couponId).update({
          data: {
            status: 'used',
            usedTime: db.serverDate(),
            usedOrder: orderId,
            lockedOrderId: _.remove(),
            lockedTime: _.remove()
          }
        })
      }
    }
    await db.collection('orders').doc(orderId).update({
      data: { fulfillCouponDone: true }
    })
    order.fulfillCouponDone = true
  }

  const gift = isGiftOrder(order)
  const invite = gift && isInviteAddressGift(order)
  const giftMeta = order.giftMeta || null
  const isRegularStorePickup = !!(
    !gift &&
    (order.storePickup || order.fulfillmentType === 'store_pickup')
  )
  const isGiftStorePickup = !!(gift && giftMeta && giftMeta.deliveryType === 'store_pickup')
  // 普通自取 → ready_pickup（勿进「待发货填单号」）；礼赠自提仍 paid + claimCode
  const nextStatus = invite
    ? 'paid_awaiting_address'
    : (isRegularStorePickup ? 'ready_pickup' : 'paid')
  const updateData = {
    status: nextStatus,
    paidTime: db.serverDate(),
    wxPayMode: order.wxPayMode || (order.wxTransactionId ? 'wechat' : 'mock')
  }

  if (invite && giftMeta) {
    const days = giftMeta.addressTimeoutDays || DEFAULT_ADDRESS_TIMEOUT_DAYS
    const expireAt = computeExpireAt(new Date(), days)
    updateData.giftMeta = {
      ...giftMeta,
      addressStatus: giftMeta.addressStatus || 'none',
      acceptStatus: giftMeta.acceptStatus || 'none',
      expireAt
    }
  } else if (isGiftStorePickup) {
    const nextMeta = { ...giftMeta }
    if (!nextMeta.claimCode) {
      nextMeta.claimCode = createClaimCode()
    }
    if (nextMeta.claimStatus !== 'claimed') {
      nextMeta.claimStatus = 'ready'
    }
    updateData.giftMeta = nextMeta
  } else if (isRegularStorePickup) {
    updateData.storePickup = true
    updateData.fulfillmentType = 'store_pickup'
    if (!order.pickupCode) {
      updateData.pickupCode = createPickupCode()
    }
    if (order.pickupStatus !== 'claimed') {
      updateData.pickupStatus = 'ready'
    }
  }

  const finalize = await db.collection('orders').where({
    _id: orderId,
    status: _.in(['fulfilling', 'pending_pay'])
  }).update({ data: updateData })

  if (updatedCount(finalize) === 0) {
    const latest = await db.collection('orders').doc(orderId).get()
    const o = latest.data
    if (o && DONE_STATUSES.includes(o.status)) {
      return {
        success: true,
        alreadyPaid: true,
        orderId,
        status: o.status,
        isGift: gift,
        inviteAddress: invite
      }
    }
  }

  // 尾款正式单：定金抵扣后标记 settled
  if (order.depositIntentId) {
    const settled = await settleDepositIntentAfterOrder(db, _, order, orderId).catch((err) => {
      console.warn('settleDepositIntentAfterOrder failed:', err && err.message)
      return null
    })
    if (settled && settled.settled) {
      cloud
        .callFunction({
          name: 'manageDeposit',
          data: {
            action: 'afterDepositSettled',
            _internal: true,
            intentId: settled.intentId || order.depositIntentId,
            productId: settled.productId || order.depositProductId || '',
            openid: order._openid || openid || '',
            orderId,
            orderNo: order.orderNo || '',
            productTitle:
              (order.products && order.products[0] && order.products[0].title) || ''
          }
        })
        .catch((err) => console.warn('afterDepositSettled notify', err && err.message))
    }
  }

  const collectionIds = order.collectionIds || []
  if (collectionIds.length) {
    await Promise.all(
      collectionIds.map((cid) =>
        db.collection('collections').doc(cid).remove().catch(() => null)
      )
    )
  }

  const productNames = (order.products || []).map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、')

  if (gift && invite) {
    const addressDays =
      (giftMeta && giftMeta.addressTimeoutDays) || DEFAULT_ADDRESS_TIMEOUT_DAYS
    await dispatchInAppMessage(db, {
      eventType: 'gift_paid',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        totalPrice: order.totalPrice || '0.00',
        productNames,
        days: addressDays,
        tip: `请把礼笺交给 TA；${addressDays} 日内未填址将自动退回`
      }
    }).catch((err) => console.warn('gift_paid message failed:', err))

    await dispatchInAppMessage(db, {
      eventType: 'gift_awaiting_address',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        productNames
      }
    }).catch((err) => console.warn('gift_awaiting_address message failed:', err))

    await notifyGiftSubscribe(cloud, 'paid_await_address', {
      openid,
      orderId,
      orderNo: order.orderNo,
      tip: '礼已备妥，请交给 TA 留下地址'
    }).catch((err) => console.warn('gift subscribe paid_await', err))
  } else if (gift) {
    const deliveryType = (giftMeta && giftMeta.deliveryType) || ''
    let tip = '礼赠已备妥，可按约定转交。'
    if (deliveryType === 'store_pickup') tip = `礼赠已备妥，可到「${(giftMeta && giftMeta.storeName) || '门店'}」领取。`
    else if (deliveryType === 'ship_to_self') tip = '礼赠将寄给你，收到后再转交。'
    else if (deliveryType === 'ship_to_receiver') tip = '礼赠将快递给 TA。'
    await dispatchInAppMessage(db, {
      eventType: 'gift_paid',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        totalPrice: order.totalPrice || '0.00',
        productNames,
        tip,
        days: ''
      }
    }).catch((err) => console.warn('gift_paid message failed:', err))
  } else {
    await dispatchInAppMessage(db, {
      eventType: 'order_paid',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        totalPrice: order.totalPrice || '0.00',
        productNames
      }
    }).catch((err) => console.warn('order_paid message failed:', err))
  }

  // 超管 / 店长：新订单提示（同一订单 dedupe，失败不阻断履约）
  const addr = order.address || {}
  const receiverName =
    (addr && addr.name) ||
    (gift && invite ? '礼赠待填址' : '') ||
    (order.storePickup || (order.giftMeta && order.giftMeta.deliveryType === 'store_pickup')
      ? '门店自提'
      : '')
  const receiverAddress =
    buildAddressLine(addr) ||
    (gift && invite ? '礼赠待填址' : '') ||
    (order.storePickup || (order.giftMeta && order.giftMeta.deliveryType === 'store_pickup')
      ? '门店自提'
      : '')
  await notifyStaffNewOrder(db, {
    relatedId: orderId,
    vars: {
      orderNo: order.orderNo || '',
      totalPrice: order.totalPrice || '0.00',
      productNames: productNames || (gift ? '礼赠订单' : '藏品订单'),
      orderTime: order.createTime || order.payTime || order.updateTime || new Date(),
      receiverName: receiverName || '待确认',
      receiverAddress: receiverAddress || '待确认'
    },
    dispatchInAppMessage
  }).catch((err) => console.warn('staff_order_paid notify failed:', err))

  // 标本师销售提成入账（失败不阻断履约；幂等）
  try {
    const latestRes = await db.collection('orders').doc(orderId).get()
    const latest = (latestRes && latestRes.data) || order
    latest._id = latest._id || orderId
    await postCommissionForOrder(db, _, latest, { source: 'confirmPayment' })
  } catch (err) {
    console.warn('artisan commission post failed:', err && err.message)
  }

  // 关联标本师：SKU 售出工作信息（workflow；幂等）
  try {
    const latestRes = await db.collection('orders').doc(orderId).get()
    const latest = (latestRes && latestRes.data) || order
    latest._id = latest._id || orderId
    await notifyArtisanSkuSold(db, _, latest, dispatchInAppMessage, { source: 'confirmPayment' })
  } catch (err) {
    console.warn('artisan sku sold notify failed:', err && err.message)
  }

  return { success: true, orderId, status: nextStatus, isGift: gift, inviteAddress: invite }
}

module.exports = { fulfillOrder }
