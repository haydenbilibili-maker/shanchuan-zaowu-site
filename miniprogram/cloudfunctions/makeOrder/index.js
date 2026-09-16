const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { calculateOrderPricing } = require('./pricing')
const { dispatchInAppMessage } = require('./inAppMessage')
const { snapshotFromOrderContext } = require('./refundPolicy')
const shipping = require('./shipping')
const { normalizeGiftMeta, isInviteAddressGift } = require('./giftMeta')
const { holdOrderProducts, releaseOrderStockHold } = require('./stockUtils')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAY_TIMEOUT_MS = 30 * 60 * 1000

/** 普通买单自取码：短 hex 大写；扫码 payload 约定 PICKUP:{code}（与礼赠 GIFT: 分流） */
function createPickupCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase()
}

function normalizeFulfillmentType(raw) {
  const v = String(raw || '').trim()
  if (v === 'store_pickup' || v === 'express' || v === 'gift_invite') return v
  return ''
}

/** 读取超管 gift_settings；失败时回落代码默认 */
async function resolveGiftDefaults() {
  const fallback = { addressFillTimeoutDays: 7, defaultDeliveryType: 'invite_address' }
  try {
    let doc = null
    try {
      const byKey = await db.collection('gift_settings').where({ key: 'default' }).limit(1).get()
      doc = (byKey.data && byKey.data[0]) || null
    } catch (e1) {
      /* ignore */
    }
    if (!doc) {
      const res = await db.collection('gift_settings').limit(1).get()
      doc = (res.data && res.data[0]) || null
    }
    if (!doc) return fallback
    const days = parseInt(doc.addressFillTimeoutDays, 10)
    const timeoutOk = [3, 7, 14].indexOf(days) !== -1
    const delivery = String(doc.defaultDeliveryType || '').trim()
    const deliveryOk = ['invite_address', 'ship_to_receiver', 'ship_to_self', 'store_pickup'].indexOf(delivery) !== -1
    return {
      addressFillTimeoutDays: timeoutOk ? days : fallback.addressFillTimeoutDays,
      defaultDeliveryType: deliveryOk ? delivery : fallback.defaultDeliveryType
    }
  } catch (e) {
    return fallback
  }
}

function normalizeRawItems(event) {
  const { products, items } = event
  let rawItems = items
  if (!rawItems || !rawItems.length) {
    if (!products || !products.length) return null
    rawItems = products.map((p) => ({
      productId: p.id || p.productId,
      skuId: p.skuId || '',
      count: p.count || 1,
      collectionId: p.collectionId || null
    }))
  }
  return rawItems
}

function buildProvisionalTip(provisional) {
  if (!provisional || !provisional.applied) return ''
  const name = provisional.levelName || `Lv${provisional.level}`
  return `本单可达${name}，已按该等级权益计价`
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const {
    couponId,
    address,
    remark,
    invoice,
    collectionIds: extraCollectionIds,
    customMeta,
    customExtraPrice,
    giftMeta: giftMetaRaw,
    source: sourceRaw,
    previewOnly,
    useWalletPay,
    depositIntentId: depositIntentIdRaw,
    storePickup: storePickupRaw,
    fulfillmentType: fulfillmentTypeRaw,
    storeId: storeIdRaw,
    storeName: storeNameRaw,
    clientRequestId: clientRequestIdRaw
  } = event
  /**
   * 下单幂等键：同一 (openid, clientRequestId) 只允许产生一笔订单。
   * 此前无幂等 → 云函数已成功但响应丢失时用户重按会重复下单、重复占库存、重复锁券。
   */
  const clientRequestId = String(clientRequestIdRaw || '').trim().slice(0, 64)

  const depositIntentId = String(depositIntentIdRaw || '').trim()
  const rawItems = normalizeRawItems(event)
  if (!rawItems || !rawItems.length) {
    return { success: false, msg: '订单商品不能为空' }
  }

  const walletPay = !!useWalletPay
  let giftMetaInput = giftMetaRaw
  if (giftMetaRaw || sourceRaw === 'gift') {
    const defaults = await resolveGiftDefaults()
    giftMetaInput = {
      deliveryType: defaults.defaultDeliveryType,
      addressTimeoutDays: defaults.addressFillTimeoutDays,
      ...(giftMetaRaw && typeof giftMetaRaw === 'object' ? giftMetaRaw : {})
    }
    if (giftMetaInput.addressTimeoutDays == null || giftMetaInput.addressTimeoutDays === '') {
      giftMetaInput.addressTimeoutDays = defaults.addressFillTimeoutDays
    }
  }
  let giftMeta = normalizeGiftMeta(giftMetaInput, { generateToken: true, generateClaim: true })
  // 服务端兜底：超管关闭「允许开启/关闭隐价」后，无论客户端传什么都必须隐价。
  // 原实现只信任 giftMeta.hidePrice，运营开关形同虚设。
  if (giftMeta && !previewOnly) {
    try {
      const setRes = await db.collection('gift_settings').doc('default').get()
      const settings = (setRes && setRes.data) || {}
      if (settings.allowHidePriceToggle === false && giftMeta.hidePrice === false) {
        giftMeta = { ...giftMeta, hidePrice: true, hidePriceForced: true }
      }
    } catch (e) {
      // 集合/文档缺失时保持默认（默认隐价），不阻塞下单
    }
  }
  const isGift = !!(giftMeta || sourceRaw === 'gift')
  const inviteAddress = isGift && isInviteAddressGift(giftMeta)
  const giftStorePickup = isGift && giftMeta && giftMeta.deliveryType === 'store_pickup'
  // 普通单门店自取：前端勾选或显式 fulfillmentType；礼赠自提仍走 giftMeta
  const requestStorePickup =
    !!storePickupRaw ||
    String(fulfillmentTypeRaw || '').trim() === 'store_pickup'
  const storePickup = giftStorePickup || (!isGift && requestStorePickup)

  // 确认页预览：不写库、不要求地址
  if (previewOnly) {
    try {
      const pricing = await calculateOrderPricing(
        db,
        openid,
        rawItems,
        couponId || null,
        customExtraPrice || (customMeta && customMeta.customExtraPrice) || 0,
        { useWalletPay: walletPay, depositIntentId, storePickup }
      )
      const provisional = pricing.provisionalMemberLevel || null
      return {
        success: true,
        preview: true,
        totalPrice: pricing.totalPrice,
        originalPrice: pricing.originalPrice,
        vipTotal: pricing.vipTotal,
        goodsPrice: pricing.goodsPrice,
        shippingFee: pricing.shippingFee,
        discountRate: pricing.discountRate,
        memberDiscountRate: pricing.memberDiscountRate,
        level: pricing.level,
        levelName: pricing.levelName,
        couponValue: pricing.couponValue,
        depositCredit: pricing.depositCredit || 0,
        growthAmount: pricing.growthAmount,
        provisionalMemberLevel: provisional,
        provisionalTip: buildProvisionalTip(provisional),
        useWalletPay: pricing.useWalletPay,
        walletAvailableFen: pricing.walletAvailableFen,
        paymentBreakdown: pricing.paymentBreakdown,
        walletBenefitSnapshot: pricing.walletBenefitSnapshot
      }
    } catch (err) {
      console.error('makeOrder preview error:', err)
      return { success: false, msg: err.message || '计价预览失败' }
    }
  }

  // 先付后填址：邀请 TA 填地址时下单不强制收货地址；门店自取/自提需选门店
  if (storePickup) {
    const needStoreId = giftStorePickup
      ? String((giftMeta && giftMeta.storeId) || '').trim()
      : String(storeIdRaw || '').trim()
    if (!needStoreId) {
      return { success: false, msg: '请选择自提门店' }
    }
  } else if (!inviteAddress && (!address || !address.name || !address.phone)) {
    return { success: false, msg: '请填写完整收货地址' }
  }

  try {
    const pricing = await calculateOrderPricing(
      db,
      openid,
      rawItems,
      couponId || null,
      customExtraPrice || (customMeta && customMeta.customExtraPrice) || 0,
      { useWalletPay: walletPay, depositIntentId, storePickup }
    )

    let collectionIds = [...pricing.collectionIds]
    if (Array.isArray(extraCollectionIds)) {
      extraCollectionIds.forEach((id) => {
        if (id && !collectionIds.includes(id)) collectionIds.push(id)
      })
    }

    const orderNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000)
    const payExpireTime = new Date(Date.now() + PAY_TIMEOUT_MS)
    const isCustom = !!(customMeta && customMeta.isCustom)
    const refundPolicy = snapshotFromOrderContext({
      isCustom,
      products: pricing.products
    })

    let orderSource = 'cart'
    if (isGift) orderSource = 'gift'
    else if (isCustom) orderSource = 'custom'

    const pickupStoreId = giftStorePickup
      ? String(giftMeta.storeId || '').trim()
      : String(storeIdRaw || (address && address.storeId) || '').trim()
    const pickupStoreName = giftStorePickup
      ? String(giftMeta.storeName || '').trim()
      : String(storeNameRaw || '').trim()

    // 自取：可选保留联系人/手机；不写完整快递地址
    let addressPayload = null
    if (!inviteAddress && !storePickup) {
      addressPayload = address || {}
    } else if (storePickup && !giftStorePickup && address && (address.name || address.phone)) {
      addressPayload = {
        name: String(address.name || '').slice(0, 40),
        phone: String(address.phone || '').slice(0, 20)
      }
    }

    let fulfillmentType = 'express'
    if (storePickup) fulfillmentType = 'store_pickup'
    else if (inviteAddress) fulfillmentType = 'gift_invite'

    // 幂等预检：命中直接返回既有订单（含其已占用的库存/券状态）
    if (!previewOnly && clientRequestId) {
      try {
        const dup = await db.collection('orders')
          .where({ _openid: openid, clientRequestId })
          .limit(1)
          .get()
        if (dup.data && dup.data.length) {
          const exist = dup.data[0]
          return {
            success: true,
            duplicated: true,
            orderId: exist._id,
            orderNo: exist.orderNo || '',
            status: exist.status,
            totalPrice: exist.totalPrice,
            msg: '该订单已创建，未重复下单'
          }
        }
      } catch (e) {
        // 无索引时 where 可能失败：退化为「按 clientRequestId 全表精确匹配」仍不可行则跳过预检，
        // 依赖 add 之后的二次校验与人工对账，不阻塞正常下单。
        console.warn('makeOrder idempotency precheck skipped:', e && e.message)
      }
    }

    const orderData = {
      clientRequestId,
      _openid: openid,
      products: pricing.products,
      totalPrice: pricing.totalPrice,
      goodsPrice: pricing.goodsPrice,
      shippingFee: storePickup ? 0 : pricing.shippingFee,
      shippingKind: pricing.shippingKind || '',
      freeShippingThreshold: pricing.freeShippingThreshold || 0,
      carrier: storePickup ? '' : (pricing.carrier || shipping.getDefaultCarrier()),
      originalPrice: pricing.originalPrice,
      discountRate: pricing.discountRate,
      memberDiscountRate: pricing.memberDiscountRate,
      level: pricing.level || null,
      levelName: pricing.levelName || '',
      couponId: pricing.couponId,
      couponValue: pricing.couponValue,
      count: pricing.count,
      // 礼赠先付后填址 / 自提：勿写 address:null（后续 update 易触发 -502001）
      ...(addressPayload ? { address: addressPayload } : {}),
      storeId: pickupStoreId,
      storeName: pickupStoreName,
      storePickup: !!storePickup,
      fulfillmentType,
      // 普通自取码（礼赠仍用 giftMeta.claimCode）；支付履约可兜底补写
      ...(storePickup && !giftStorePickup
        ? {
          pickupCode: createPickupCode(),
          pickupStatus: 'ready',
          pickupClaimedAt: null,
          pickupClaimedByStaff: ''
        }
        : {}),
      remark: (remark || '').slice(0, 200),
      invoice: invoice && invoice.title ? {
        type: invoice.type || 'personal',
        title: String(invoice.title).slice(0, 100),
        taxNo: String(invoice.taxNo || '').slice(0, 32),
        email: String(invoice.email || '').slice(0, 80)
      } : null,
      collectionIds,
      status: 'pending_pay',
      createTime: db.serverDate(),
      payExpireTime,
      orderNo,
      source: orderSource,
      customMeta: isCustom ? customMeta : null,
      giftMeta: isGift ? giftMeta : null,
      customExtraPrice: pricing.customExtraPrice || 0,
      productionStatus: isCustom ? 'pending_make' : null,
      refundPolicy,
      useWalletPay: !!pricing.useWalletPay,
      walletBenefitSnapshot: pricing.walletBenefitSnapshot || null,
      paymentBreakdown: pricing.paymentBreakdown || null,
      depositIntentId: pricing.depositIntentId || null,
      depositProductId: pricing.depositProductId || null,
      depositCredit: pricing.depositCredit || 0
    }

    if (pricing.provisionalMemberLevel && pricing.provisionalMemberLevel.applied) {
      orderData.provisionalMemberLevel = pricing.provisionalMemberLevel
      orderData.growthAmount = pricing.growthAmount
    }

    // 下单预占库存：减可用量、不加销量；取消/超时释放，支付履约只记销量
    let stockHoldItems = []
    try {
      stockHoldItems = await holdOrderProducts(db, _, pricing.products)
    } catch (holdErr) {
      console.error('makeOrder stock hold failed:', holdErr)
      return { success: false, msg: holdErr.message || '库存不足，请稍后重试' }
    }
    orderData.stockHeld = true
    orderData.stockHoldItems = stockHoldItems
    orderData.stockHoldAt = db.serverDate()
    orderData.stockHoldReleased = false
    orderData.stockHoldConsumed = false

    let orderRes
    try {
      orderRes = await db.collection('orders').add({ data: orderData })
    } catch (addErr) {
      await releaseOrderStockHold(db, _, {
        stockHeld: true,
        stockHoldItems,
        stockHoldReleased: false,
        stockHoldConsumed: false,
        products: pricing.products
      }).catch(() => {})
      throw addErr
    }

    // 下单即锁定优惠券（条件更新），防止同一券挂多笔待支付单后重复核销
    if (pricing.couponId) {
      try {
        const lockRes = await db.collection('user_coupons').where({
          _id: pricing.couponId,
          _openid: openid,
          status: _.in(['unused', 'available'])
        }).update({
          data: {
            status: 'locked',
            lockedOrderId: orderRes._id,
            lockedTime: db.serverDate()
          }
        })
        const locked = lockRes && lockRes.stats
          ? Number(lockRes.stats.updated != null ? lockRes.stats.updated : lockRes.stats.updatedCount) || 0
          : 0
        if (locked <= 0) {
          await releaseOrderStockHold(db, _, {
            _id: orderRes._id,
            stockHeld: true,
            stockHoldItems,
            stockHoldReleased: false,
            stockHoldConsumed: false,
            products: pricing.products
          }).catch(() => {})
          await db.collection('orders').doc(orderRes._id).update({
            data: {
              status: 'void',
              cancelReason: 'coupon_unavailable'
            }
          }).catch(() => {})
          return { success: false, msg: '优惠券不可用，请重新选择' }
        }
      } catch (lockErr) {
        console.error('makeOrder coupon lock failed:', lockErr)
        await releaseOrderStockHold(db, _, {
          _id: orderRes._id,
          stockHeld: true,
          stockHoldItems,
          stockHoldReleased: false,
          stockHoldConsumed: false,
          products: pricing.products
        }).catch(() => {})
        await db.collection('orders').doc(orderRes._id).update({
          data: {
            status: 'void',
            cancelReason: 'coupon_lock_failed'
          }
        }).catch(() => {})
        return { success: false, msg: '优惠券锁定失败，请重试' }
      }
    }

    const productNames = pricing.products.map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、')
    await dispatchInAppMessage(db, {
      eventType: 'order_created',
      openid,
      relatedId: orderRes._id,
      vars: {
        // 需求 10：productNames 只够做正文摘要；products 供信件渲染「名称+图片+规格」商品卡
        products: pricing.products,
        productNames: productNames || '藏品订单',
        totalPrice: pricing.totalPrice
      }
    }).catch((err) => console.warn('order_created message failed:', err))

    return {
      success: true,
      orderId: orderRes._id,
      orderNo,
      totalPrice: pricing.totalPrice,
      discountRate: pricing.discountRate,
      levelName: pricing.levelName,
      provisionalMemberLevel: pricing.provisionalMemberLevel || null,
      provisionalTip: buildProvisionalTip(pricing.provisionalMemberLevel),
      useWalletPay: !!pricing.useWalletPay,
      paymentBreakdown: pricing.paymentBreakdown,
      status: 'pending_pay'
    }
  } catch (err) {
    console.error('makeOrder error:', err)
    return { success: false, msg: err.message || '下单失败' }
  }
}
