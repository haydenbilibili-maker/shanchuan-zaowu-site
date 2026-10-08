const cloud = require('wx-server-sdk')
const { restoreStock } = require('./stockUtils')
const { ENV_ID, SUB_MCH_ID, parseYuanToFen, isUserAdmin } = require('./payConfig')
const { dispatchInAppMessage } = require('./inAppMessage')
const { calcRefundYuan } = require('./refundPolicy')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { ACTION, resolveApproverRole, actorWorkspaceRole } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
const { reverseCommissionForOrder } = require('./artisanCommission')
const { isNonClientSource, isClientSource, isInternalSource, sourceSegments, describeSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 仅开发显式开启；生产禁止对非 mock 订单做本地假退款 */
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1'
const WALLET_INTERNAL_KEY = process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

/** 按原支付渠道拆分退款额（含损耗后的应退总额） */
function resolveRefundChannels(order, refundYuan) {
  const totalFen = parseYuanToFen(order.totalPrice)
  const refundFen = parseYuanToFen(refundYuan)
  const walletPaidFen = Math.max(
    0,
    Math.round(Number(order.walletPaidFen) || 0) ||
      (order.paymentBreakdown ? Math.round(Number(order.paymentBreakdown.walletPayFen) || 0) : 0)
  )
  let wxPaidFen = 0
  if (order.paymentBreakdown && order.paymentBreakdown.wxpayFen != null) {
    wxPaidFen = Math.max(0, Math.round(Number(order.paymentBreakdown.wxpayFen) || 0))
  } else if (order.wxPayMode === 'wallet') {
    wxPaidFen = 0
  } else if (order.wxPayMode === 'wechat' || order.wxTransactionId) {
    wxPaidFen = Math.max(0, totalFen - walletPaidFen)
  } else if (order.wxPayMode === 'mock') {
    wxPaidFen = Math.max(0, totalFen - walletPaidFen)
  }

  let walletRefundFen = 0
  let wxRefundFen = 0
  if (refundFen > 0) {
    if (walletPaidFen <= 0) {
      wxRefundFen = Math.min(wxPaidFen > 0 ? wxPaidFen : totalFen, refundFen)
    } else if (wxPaidFen <= 0) {
      walletRefundFen = Math.min(walletPaidFen, refundFen)
    } else if (totalFen > 0) {
      walletRefundFen = Math.min(walletPaidFen, Math.round((refundFen * walletPaidFen) / totalFen))
      wxRefundFen = Math.min(wxPaidFen, refundFen - walletRefundFen)
      const gap = refundFen - walletRefundFen - wxRefundFen
      if (gap > 0) {
        if (walletPaidFen - walletRefundFen >= gap) walletRefundFen += gap
        else if (wxPaidFen - wxRefundFen >= gap) wxRefundFen += gap
      }
    }
  }

  return { totalFen, refundFen, walletPaidFen, wxPaidFen, walletRefundFen, wxRefundFen }
}

async function creditWalletOnRefund(orderId, order, walletRefundFen, actorOpenid) {
  if (!walletRefundFen || walletRefundFen <= 0) {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }
  try {
    const payload = {
      action: 'creditRefundForOrder',
      orderId,
      openid: order._openid,
      amountFen: walletRefundFen,
      remark: '订单退款·退回钱包'
    }
    if (WALLET_INTERNAL_KEY) payload.internalKey = WALLET_INTERNAL_KEY
    if (actorOpenid) payload._callerOpenid = actorOpenid
    const res = await cloud.callFunction({
      name: 'manageStoredValue',
      data: payload
    })
    return (res && res.result) || { success: false, msg: '钱包退回无响应' }
  } catch (e) {
    console.error('creditWalletOnRefund failed', e)
    return { success: false, msg: e.message || '钱包退回失败' }
  }
}

/**
 * 礼赠退款成功后通知受赠人（若已 accept / 已绑定 receiverOpenid）。
 * 未领取（无 receiverOpenid）不发；与赠予者去重（openid 不同才发）。
 * dedupeKey = gift_refunded_receiver:orderId:openid，24h 内不重发。
 */
async function notifyGiftReceiverRefund(order, orderId) {
  const meta = (order && order.giftMeta) || {}
  const isGift = !!(order && (order.source === 'gift' || meta.deliveryType))
  if (!isGift) return { skipped: true, reason: 'not_gift' }

  const giver = String((order && (order._openid || order.openid)) || '').trim()
  const receiver = String(meta.receiverOpenid || '').trim()
  if (!receiver) return { skipped: true, reason: 'no_receiver' }
  if (giver && receiver === giver) return { skipped: true, reason: 'same_as_giver' }

  const accepted = meta.acceptStatus === 'accepted' || !!receiver
  if (!accepted) return { skipped: true, reason: 'not_accepted' }

  const isExpire =
    order.cancelReason === 'gift_address_timeout' ||
    order.statusBeforeRefund === 'expired_refunding' ||
    meta.expiredAt

  return dispatchInAppMessage(db, {
    eventType: isExpire ? 'gift_expired_refund_receiver' : 'gift_refunded_receiver',
    openid: receiver,
    relatedId: orderId,
    vars: { orderNo: (order && order.orderNo) || '' }
  })
}

async function executeRefund(orderId, order, openid, actorMeta, options = {}) {
  let split = calcRefundYuan(order)
  if (options.forceFullRefund) {
    const paid = split.paid
    split = {
      ...split,
      type: 'gift_expire_full',
      deductRate: 0,
      deduct: 0,
      refund: paid
    }
  }
  const channels = resolveRefundChannels(order, split.refund)
  const { totalFen, refundFen, walletRefundFen, wxRefundFen, wxPaidFen, walletPaidFen } = channels
  if (!totalFen || !refundFen) {
    return { success: false, msg: '退款金额异常' }
  }

  const isWechatPaid = (wxRefundFen > 0) && (
    order.wxPayMode === 'wechat' || !!order.wxTransactionId
  )
  const isFullWallet = walletPaidFen > 0 && wxPaidFen <= 0 &&
    (order.wxPayMode === 'wallet' || !order.wxTransactionId)

  let refundNo = `MOCK_REF_${Date.now()}`
  let refundMock = true
  let wxRefundResult = null

  if (isWechatPaid) {
    if (!SUB_MCH_ID || !order.orderNo) {
      return {
        success: false,
        msg: '退款未开通，请稍后重试或联系门店',
        code: 'REFUND_NOT_ENABLED'
      }
    }
    const wxTotalFee = wxPaidFen > 0 ? wxPaidFen : totalFen
    if (wxRefundFen > wxTotalFee) {
      return { success: false, msg: '微信退款额异常', code: 'INVALID_WX_REFUND' }
    }
    refundNo = `REF${String(order.orderNo).slice(-12)}${Date.now()}`.slice(0, 32)
    try {
      wxRefundResult = await cloud.cloudPay.refund({
        envId: ENV_ID,
        subMchId: SUB_MCH_ID,
        outTradeNo: order.orderNo,
        outRefundNo: refundNo,
        totalFee: wxTotalFee,
        refundFee: wxRefundFen
      })
      refundMock = false
    } catch (payErr) {
      console.error('cloudPay.refund failed:', payErr)
      return {
        success: false,
        msg: payErr.message || '微信退款接口调用失败，请稍后重试',
        code: 'REFUND_UNAVAILABLE'
      }
    }
  } else if (isFullWallet || wxRefundFen <= 0) {
    // 全额钱包或本笔无需微信退款：本地完成
    refundMock = order.wxPayMode === 'mock' || ALLOW_MOCK_PAY || isFullWallet
    if (!isFullWallet && !(order.wxPayMode === 'mock' || ALLOW_MOCK_PAY)) {
      // 无微信实付、也无钱包实付 —— 异常单
      if (walletRefundFen <= 0) {
        return {
          success: false,
          msg: '退款未开通，请稍后重试或联系门店',
          code: 'REFUND_NOT_ENABLED'
        }
      }
    }
    refundNo = `WREF${String(order.orderNo || orderId).slice(-12)}${Date.now()}`.slice(0, 32)
  } else if (!(order.wxPayMode === 'mock' || ALLOW_MOCK_PAY)) {
    return {
      success: false,
      msg: '退款未开通，请稍后重试或联系门店',
      code: 'REFUND_NOT_ENABLED'
    }
  }

  // 钱包渠道退回（幂等）。纯钱包失败则整单失败；若微信已退则继续落单并告警，避免卡死
  const walletResult = await creditWalletOnRefund(orderId, order, walletRefundFen, openid)
  if (walletRefundFen > 0 && !(walletResult && walletResult.success)) {
    if (!(isWechatPaid && !refundMock)) {
      return {
        success: false,
        msg: (walletResult && walletResult.msg) || '钱包退回失败，请稍后重试',
        code: (walletResult && walletResult.code) || 'WALLET_REFUND_FAILED',
        walletResult
      }
    }
    console.error('wallet refund failed after wechat refund', orderId, walletResult)
  }

  for (const item of order.products || []) {
    await restoreStock(db, _, item.id, item.skuId || '', item.count || 1)
  }

  if (order.couponId) {
    try {
      const couponRes = await db.collection('user_coupons').doc(order.couponId).get()
      const coupon = couponRes.data
      if (
        coupon &&
        coupon.status === 'used' &&
        (!coupon.usedOrder || coupon.usedOrder === orderId)
      ) {
        await db.collection('user_coupons').doc(order.couponId).update({
          data: {
            status: 'unused',
            usedTime: _.remove(),
            usedOrder: _.remove()
          }
        })
      }
    } catch (couponErr) {
      console.warn('refundOrder coupon restore failed:', couponErr && couponErr.message)
    }
  }

  const walletPendingReconcile =
    walletRefundFen > 0 && !(walletResult && walletResult.success)
  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'refunded',
      refundTime: db.serverDate(),
      refundNo,
      refundFee: split.refund,
      refundDeduct: split.deduct,
      refundDeductRate: split.deductRate,
      refundPolicyType: split.type,
      refundMock,
      refundChannels: {
        walletRefundFen,
        wxRefundFen,
        walletPaidFen,
        wxPaidFen
      },
      walletRefundedFen: (walletResult && walletResult.creditedFen) || walletRefundFen || 0,
      // 微信已退成功但钱包入账失败：运营可按此字段筛「待核对」
      walletRefundPendingReconcile: walletPendingReconcile,
      walletRefundPendingAt: walletPendingReconcile ? db.serverDate() : _.remove(),
      wxRefundResult: wxRefundResult || null,
      refundApprovalId: _.remove(),
      refundPendingApproval: _.remove()
    }
  })
  if (walletPendingReconcile) {
    console.error('refundOrder wallet pending reconcile', orderId, {
      walletRefundFen,
      walletResult
    })
  }

  await dispatchInAppMessage(db, {
    eventType: 'order_refunded',
    openid: order._openid,
    relatedId: orderId,
    vars: {
      orderNo: order.orderNo || '',
      products: order.products,
      refundAmount: String(split.refund.toFixed(2))
    }
  }).catch((err) => console.warn('order_refunded message failed:', err))

  // 礼赠：已绑定受赠人时同步有信（未领取不发，避免打扰）
  await notifyGiftReceiverRefund(order, orderId).catch((err) =>
    console.warn('gift_refunded_receiver message failed:', err)
  )

  if (actorMeta) {
    await writeAuditLog(db, auditFromActor(actorMeta, {
      action: 'order_refund',
      relatedId: orderId,
      relatedType: 'orders',
      detail: {
        refund: split.refund,
        deduct: split.deduct,
        refundNo,
        walletRefundFen,
        wxRefundFen
      },
      source: 'refundOrder'
    }))
  }

  // 积分冲销流水（明细口径）
  // 说明：线上订单的可用积分由 orders 状态实时汇总（orderGrowth 只计 paid/shipped/received），
  // 退款后该单自动移出汇总 → **余额已自动回冲**，无需再改 bonusPoints。
  // 但「积分明细」里那条 +N 会一直留着，用户会觉得「退了款积分还在」。
  // 这里补一条冲销流水（best-effort，失败不影响退款）。
  try {
    const granted = Number(order.pointsGranted) || 0
    if (granted > 0) {
      const dedupeKey = `online_order_refund:${orderId}`
      const exist = await db.collection('point_records').where({ dedupeKey }).limit(1).get()
      if (!exist.data || !exist.data.length) {
        await db.collection('point_records').add({
          data: {
            _openid: '',
            userOpenid: order._openid || order.openid || '',
            type: 'revoke',
            source: 'online_order',
            action: 'online_order_refund',
            points: -granted,
            title: `订单退款扣回 ¥${split.refund}`,
            refCollection: 'orders',
            refId: orderId,
            dedupeKey,
            status: 'done',
            orderNo: order.orderNo || '',
            dateStr: new Date().toISOString().slice(0, 10),
            createTime: db.serverDate()
          }
        })
      }
    }
  } catch (e) {
    console.warn('refundOrder point reversal record failed:', e && e.message)
  }

  cloud.callFunction({
    name: 'sendCareReminder',
    data: { action: 'cancel', orderId, openid: order._openid }
  }).catch((err) => console.warn('cancel care reminder failed:', err))

  // 标本师提成冲正（失败不阻断退款；幂等）
  try {
    const latestRes = await db.collection('orders').doc(orderId).get()
    const latest = (latestRes && latestRes.data) || order
    latest._id = latest._id || orderId
    await reverseCommissionForOrder(db, _, latest, {
      source: 'refundOrder',
      refundFee: split.refund
    })
  } catch (err) {
    console.warn('artisan commission reverse failed:', err && err.message)
  }

  await markApprovalDecided(db, {
    relatedId: orderId,
    actionType: ACTION.ORDER_REFUND,
    status: 'approved',
    decidedBy: openid || '',
    decidedByName: (actorMeta && actorMeta.name) || '',
    source: 'refundOrder'
  })

  const walletPart = walletRefundFen > 0
    ? `，钱包退回 ¥${(walletRefundFen / 100).toFixed(2)}`
    : ''
  const wxPart = wxRefundFen > 0
    ? `，微信退回 ¥${(wxRefundFen / 100).toFixed(2)}`
    : ''
  const walletWarn = walletRefundFen > 0 && !(walletResult && walletResult.success)
    ? '（钱包入账待核对）'
    : ''

  return {
    success: true,
    refundNo,
    refundMock,
    refundFee: split.refund,
    refundDeduct: split.deduct,
    walletRefundFen,
    wxRefundFen,
    walletResult,
    msg: refundMock
      ? `已完成退款（开发模式）${split.deduct > 0 ? `，已扣除损耗 ¥${split.deduct.toFixed(2)}` : ''}${walletPart}${wxPart}${walletWarn}`
      : (split.deduct > 0
        ? `退款已提交，退回 ¥${split.refund.toFixed(2)}（已扣损耗 ¥${split.deduct.toFixed(2)}）${walletPart}${wxPart}${walletWarn}`
        : `退款已提交${walletPart}${wxPart}${walletWarn}`)
  }
}

function normalizeEvidencePayload(evidence) {
  const raw = evidence && typeof evidence === 'object' ? evidence : {}
  const unboxVideoFileId = String(raw.unboxVideoFileId || '').trim()
  const evidenceImageFileIds = (Array.isArray(raw.evidenceImageFileIds) ? raw.evidenceImageFileIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id.indexOf('cloud://') === 0)
    .slice(0, 9)
  return { unboxVideoFileId, evidenceImageFileIds }
}

async function requestRefundByBuyer(orderId, openid, note, evidence) {
  if (!openid) return { success: false, msg: '请先登录' }
  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }
  if (order._openid !== openid) return { success: false, msg: '无权操作此订单' }

  // 兑换单（0 元、积分兑换）不走支付退款通道：退款金额为 0 必然失败，
  // 会把订单永久卡在 refunding，且消耗的积分不会回退。撤销兑换需独立流程。
  if (String(order.source || '') === 'exchange') {
    return { success: false, code: 'EXCHANGE_ORDER', msg: '积分兑换的订单不支持退款，如需撤销请联系专员' }
  }

  const allowFrom = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']
  if (!allowFrom.includes(order.status)) {
    if (order.status === 'refunding' || order.status === 'aftersales') {
      return { success: true, duplicated: true, msg: '退款申请已提交，请等待处理' }
    }
    return { success: false, msg: '当前订单状态不可申请退款' }
  }

  // 门店自取（非礼赠）：逆向流程 = 送回领取门店 → 门店确认收回 → 退款
  const isStorePickup = !!(
    !order.giftMeta &&
    order.source !== 'gift' &&
    (order.storePickup || order.fulfillmentType === 'store_pickup')
  )
  // 已核销（当面交付）等同发货后，须走送回门店的逆向流程
  const claimedPickup = isStorePickup && order.pickupStatus === 'claimed'
  const postShip = order.status === 'shipped' || order.status === 'received' || claimedPickup
  const storeReturn = isStorePickup && postShip
  const { unboxVideoFileId, evidenceImageFileIds } = normalizeEvidencePayload(evidence)

  // 发货后售后：开箱视频必填（与发货私信口径一致）
  // 门店自取为当面交接，不强制开箱视频；举证改为可选，由门店按送回实物审核
  if (postShip && !isStorePickup) {
    if (!unboxVideoFileId || unboxVideoFileId.indexOf('cloud://') !== 0) {
      return { success: false, msg: '请上传开箱视频后再提交售后' }
    }
  } else if (unboxVideoFileId && unboxVideoFileId.indexOf('cloud://') !== 0) {
    return { success: false, msg: '开箱视频无效' }
  }

  const updateData = {
    status: postShip ? 'aftersales' : 'refunding',
    statusBeforeRefund: order.status,
    refundRequestedAt: db.serverDate(),
    refundRequestNote: String(note || '').slice(0, 200)
  }
  if (unboxVideoFileId) updateData.unboxVideoFileId = unboxVideoFileId
  if (evidenceImageFileIds.length) updateData.evidenceImageFileIds = evidenceImageFileIds
  // 发货后售后显式落库，便于 B 端识别「缺开箱影像」（门店自取不适用，不落空值）
  if (postShip && !isStorePickup) {
    updateData.unboxVideoFileId = unboxVideoFileId
    updateData.evidenceImageFileIds = evidenceImageFileIds
  }
  if (storeReturn) {
    updateData.returnMode = 'store_return'
    updateData.pickupReturnStatus = 'pending'
    updateData.pickupReturnStoreId = order.storeId || ''
    updateData.pickupReturnStoreName = order.storeName || ''
  }

  await db.collection('orders').doc(orderId).update({ data: updateData })

  return {
    success: true,
    msg: storeReturn
      ? '售后申请已提交，请将藏品送回领取门店，门店确认收回后退款'
      : postShip
        ? '售后申请已提交，请等待门店处理'
        : '申请已提交，请等待门店处理'
  }
}

/** 店长/Admin：将订单置为 refunding（替代客户端直写） */
async function staffMarkRefunding(orderId, openid, adminOpsKey, note) {
  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }

  if (['refunding', 'aftersales', 'refund_approved'].includes(order.status)) {
    return { success: true, duplicated: true, msg: '订单已在退款流程中' }
  }
  const allowFrom = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']
  if (!allowFrom.includes(order.status)) {
    return { success: false, msg: '当前订单状态不可进入退款' }
  }

  const admin = await isUserAdmin(db, openid, { adminOpsKey })
  let staffActor = null
  if (!admin) {
    const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
    if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权操作' }
    staffActor = guard.actor
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'refunding',
      statusBeforeRefund: order.status,
      refundRequestedAt: db.serverDate(),
      refundRequestNote: String(note || '门店/总部发起').slice(0, 120),
      refundApprovedTime: db.serverDate()
    }
  })

  const actorMeta = staffActor || {
    openid: openid || 'admin_web',
    workspaceRole: 'super_admin',
    role: 'manager',
    name: '超管'
  }
  await writeAuditLog(db, auditFromActor(actorMeta, {
    action: 'order_mark_refunding',
    relatedId: orderId,
    relatedType: 'orders',
    detail: {},
    source: 'refundOrder'
  }))

  return { success: true, msg: '已进入退款流程' }
}

/** 店长/Admin：拒绝退款申请 */
async function staffRejectRefund(orderId, openid, adminOpsKey, reason) {
  const reasonText = String(reason || '').trim().slice(0, 200)
  if (!reasonText) return { success: false, msg: '请填写拒绝原因' }

  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }
  if (!['refunding', 'aftersales', 'refund_approved'].includes(order.status)) {
    return { success: false, msg: '当前订单不在退款申请中' }
  }

  const admin = await isUserAdmin(db, openid, { adminOpsKey })
  let staffActor = null
  if (!admin) {
    const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
    if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权操作' }
    staffActor = guard.actor
  }

  // 礼赠填址超时进入的退款不可拒绝（须继续执行全额退）
  if (
    order.status === 'expired_refunding' ||
    order.cancelReason === 'gift_address_timeout'
  ) {
    return {
      success: false,
      code: 'GIFT_EXPIRE_MUST_REFUND',
      msg: '礼赠填址过期单不可拒绝，请执行全额退款'
    }
  }

  // 退回申请前状态：优先 statusBeforeRefund（含待自取）；礼赠待填址 → paid_awaiting_address；有收货 → received；有物流 → shipped；否则 paid
  let restoreStatus = 'paid'
  const meta = order.giftMeta || {}
  const giftAwaiting =
    (order.source === 'gift' || meta.deliveryType === 'invite_address') &&
    meta.deliveryType === 'invite_address' &&
    meta.addressStatus !== 'submitted' &&
    !order.receiveTime &&
    !(order.logistics && order.logistics.trackingNumber)
  if (
    order.statusBeforeRefund &&
    ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received'].includes(order.statusBeforeRefund)
  ) {
    restoreStatus = order.statusBeforeRefund
  } else if (giftAwaiting) restoreStatus = 'paid_awaiting_address'
  else if (order.receiveTime) restoreStatus = 'received'
  else if (order.logistics && order.logistics.trackingNumber) restoreStatus = 'shipped'

  await db.collection('orders').doc(orderId).update({
    data: {
      status: restoreStatus,
      refundRejectReason: reasonText,
      refundRejectTime: db.serverDate(),
      refundPendingApproval: _.remove(),
      refundApprovalId: _.remove(),
      statusBeforeRefund: _.remove()
    }
  })

  const actorMeta = staffActor || {
    openid: openid || 'admin_web',
    workspaceRole: 'super_admin',
    role: 'manager',
    name: '超管'
  }
  await writeAuditLog(db, auditFromActor(actorMeta, {
    action: 'order_reject_refund',
    relatedId: orderId,
    relatedType: 'orders',
    detail: { reason: reasonText, restoreStatus },
    source: 'refundOrder'
  }))

  return { success: true, msg: '已拒绝退款', restoreStatus }
}

/**
 * 门店自取逆向流程：店长/超管确认已收回顾客送回门店的藏品。
 * 确认前 refundOrder 拒绝执行退款（见主线 returnMode === 'store_return' 闸门）。
 */
async function confirmPickupReturn(orderId, openid, adminOpsKey) {
  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }
  if (order.returnMode !== 'store_return') {
    return { success: false, msg: '该订单不在门店自取退货流程中' }
  }
  if (order.pickupReturnStatus === 'returned') {
    return { success: true, duplicated: true, msg: '此前已确认收回' }
  }

  const admin = await isUserAdmin(db, openid, { adminOpsKey })
  let staffActor = null
  if (!admin) {
    const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
    if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权操作' }
    staffActor = guard.actor
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      pickupReturnStatus: 'returned',
      pickupReturnedAt: db.serverDate(),
      pickupReturnedBy: (staffActor && staffActor.openid) || openid || 'admin_web',
      updated_at: db.serverDate()
    }
  })

  return { success: true, msg: '已确认收回藏品，可执行退款' }
}

/**
 * 礼赠 invite_address 超时全额退：
 * - 允许来源：定时器 / manageGift 传入 internalKey，或店长/超管
 * - 订单须为 paid_awaiting_address 或 expired_refunding
 */
async function giftExpireRefund(orderId, openid, event) {
  const internalKey = String((event && event.internalKey) || '')
  const expected = process.env.GIFT_EXPIRE_INTERNAL_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''
  // 内部凭证：持正确密钥，**或**来自非客户端来源（定时器 / 云函数互调）。
  // 后者必不可少：定时触发时 manageGift 不再把密钥写回 event（原实现让伪造
  // Type:'Timer' 即可拿到密钥），若这里仍只认密钥，礼赠过期自动退款会永久静默失败。
  const viaKey = !!(expected && internalKey && internalKey === expected)
  const viaInternal = viaKey || isNonClientSource()

  let order = null
  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    order = orderRes && orderRes.data
  } catch (e) {
    // 单条 get 在文档不存在时抛错；对外给出可读文案而非原始 DB 错误
    return { success: false, code: 'ORDER_NOT_FOUND', msg: '订单不存在' }
  }
  if (!order) return { success: false, code: 'ORDER_NOT_FOUND', msg: '订单不存在' }

  if (order.status === 'refunded') {
    return { success: true, already: true, msg: '已退款' }
  }

  const allowStatus = ['paid_awaiting_address', 'expired_refunding', 'refunding']
  if (!allowStatus.includes(order.status)) {
    return { success: false, msg: `状态不可过期退款: ${order.status}` }
  }

  const isGift = order.source === 'gift' || !!(order.giftMeta && order.giftMeta.deliveryType === 'invite_address')
  if (!isGift) {
    return { success: false, msg: '非礼赠待填址订单' }
  }

  let actorMeta = {
    openid: openid || (viaKey ? 'gift_expire_job_key' : 'gift_expire_job'),
    workspaceRole: 'super_admin',
    role: 'system',
    name: '礼赠过期退款'
  }

  if (!viaInternal) {
    const admin = await isUserAdmin(db, openid, { adminOpsKey: event && event.adminOpsKey })
    if (!admin) {
      const guard = await assertStaff(db, openid, {
        role: ROLE_MANAGER,
        adminOpsKey: event && event.adminOpsKey
      })
      if (!guard.ok) {
        return { success: false, code: guard.code, msg: guard.msg || '无权操作' }
      }
      actorMeta = guard.actor
    }
  }

  if (order.status !== 'refunding') {
    const meta = order.giftMeta || {}
    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'refunding',
        cancelReason: 'gift_address_timeout',
        refundRequestedAt: db.serverDate(),
        refundRequestNote: '礼赠填址超时自动全额退',
        giftMeta: {
          ...meta,
          shareToken: '',
          expiredAt: meta.expiredAt || db.serverDate()
        }
      }
    })
    order.status = 'refunding'
  }

  const result = await executeRefund(orderId, order, openid || actorMeta.openid, actorMeta, {
    forceFullRefund: true
  })

  if (result && result.success) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_expired_refund',
      openid: order._openid,
      relatedId: orderId,
      vars: { orderNo: order.orderNo || '', products: order.products }
    }).catch(() => {})
  }

  return result
}

exports.main = async (event) => {
  const { orderId, adminOpsKey } = event || {}
  let openid = cloud.getWXContext().OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }

  const action = String((event && event.action) || 'execute').trim()

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }

  // 买家申请退款/售后：仅改状态，禁止客户端直写；发货后须开箱视频举证
  if (action === 'request') {
    try {
      return await requestRefundByBuyer(orderId, openid, event && event.note, {
        unboxVideoFileId: event && event.unboxVideoFileId,
        evidenceImageFileIds: event && event.evidenceImageFileIds
      })
    } catch (err) {
      console.error(err)
      return { success: false, msg: err.message || '申请失败' }
    }
  }

  if (action === 'staffMarkRefunding' || action === 'markRefunding') {
    try {
      return await staffMarkRefunding(orderId, openid, adminOpsKey, event && event.note)
    } catch (err) {
      console.error(err)
      return { success: false, msg: err.message || '操作失败' }
    }
  }

  if (action === 'staffReject' || action === 'reject') {
    try {
      return await staffRejectRefund(orderId, openid, adminOpsKey, event && event.reason)
    } catch (err) {
      console.error(err)
      return { success: false, msg: err.message || '拒绝失败' }
    }
  }

  // 门店自取逆向：店长/超管确认已收回顾客送回门店的藏品
  if (action === 'confirmPickupReturn') {
    try {
      return await confirmPickupReturn(orderId, openid, adminOpsKey)
    } catch (err) {
      console.error(err)
      return { success: false, msg: err.message || '确认收回失败' }
    }
  }

  // 礼赠填址超时：全额自动退（manageGift.expireSweep / 定时器）
  if (action === 'giftExpireRefund') {
    try {
      return await giftExpireRefund(orderId, openid, event)
    } catch (err) {
      console.error(err)
      return { success: false, msg: err.message || '礼赠过期退款失败' }
    }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    if (!order) {
      return { success: false, msg: '订单不存在' }
    }

    if (!['refunding', 'aftersales', 'refund_approved', 'expired_refunding'].includes(order.status)) {
      return { success: false, msg: '订单状态不正确' }
    }

    const admin = await isUserAdmin(db, openid, { adminOpsKey })
    const fromApproval = !!(event && event._fromApproval)

    let staffActor = null
    if (!admin) {
      const guard = await assertStaff(db, openid, {
        role: ROLE_MANAGER,
        adminOpsKey
      })
      if (!guard.ok) {
        return { success: false, code: guard.code, msg: guard.msg || '无权操作此订单' }
      }
      staffActor = guard.actor
    }

    const canDirect =
      fromApproval ||
      admin ||
      (staffActor && (staffActor.superAdmin || actorWorkspaceRole(staffActor) === 'super_admin'))

    // 礼赠填址过期：店长同意即全额退，不走损耗规则
    const forceFullRefund =
      order.status === 'expired_refunding' ||
      order.cancelReason === 'gift_address_timeout'

    if (!canDirect && staffActor) {
      const ws = actorWorkspaceRole(staffActor)
      const approverRole = resolveApproverRole(ACTION.ORDER_REFUND, ws)
      if (approverRole) {
        const split = forceFullRefund
          ? { ...calcRefundYuan(order), deduct: 0, deductRate: 0, refund: calcRefundYuan(order).paid, type: 'gift_expire_full' }
          : calcRefundYuan(order)
        const enqueued = await enqueueApproval(db, {
          actionType: ACTION.ORDER_REFUND,
          applicantOpenid: openid,
          applicantName: staffActor.name || '',
          applicantRole: staffActor.role || '',
          applicantWorkspaceRole: ws,
          relatedId: orderId,
          storeId: order.storeId || '',
          title: `退款 ${order.orderNo || orderId}`,
          summary: `¥${split.refund.toFixed(2)}${split.deduct > 0 ? `（扣损 ¥${split.deduct.toFixed(2)}）` : ''}`,
          payload: {
            orderId,
            orderNo: order.orderNo || '',
            refund: split.refund,
            deduct: split.deduct,
            forceFullRefund: !!forceFullRefund
          },
          source: 'refundOrder',
          approverRole
        })
        if (!enqueued.ok) {
          return { success: false, msg: enqueued.msg || '提交退款审批失败' }
        }
        try {
          await db.collection('orders').doc(orderId).update({
            data: { refundApprovalId: enqueued.approvalId || '', refundPendingApproval: true }
          })
        } catch (e) { /* ignore */ }
        return {
          success: true,
          pendingApproval: true,
          approvalId: enqueued.approvalId,
          msg: '已提交超管审核退款，通过后将执行微信退款'
        }
      }
    }

    if (!admin && !staffActor && !fromApproval) {
      return { success: false, msg: '无权操作此订单' }
    }

    const actorMeta = staffActor || {
      openid: openid || 'admin_web',
      workspaceRole: 'super_admin',
      role: 'manager',
      name: '超管'
    }

    // 过期单先落到 refunding，便于列表与幂等
    if (order.status === 'expired_refunding') {
      const meta = order.giftMeta || {}
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'refunding',
          statusBeforeRefund: 'expired_refunding',
          cancelReason: order.cancelReason || 'gift_address_timeout',
          refundRequestedAt: order.refundRequestedAt || db.serverDate(),
          refundRequestNote: order.refundRequestNote || '礼赠填址超时自动全额退',
          giftMeta: {
            ...meta,
            shareToken: '',
            expiredAt: meta.expiredAt || db.serverDate()
          }
        }
      })
      order.status = 'refunding'
    }

    // 门店自取逆向流程闸门：未确认收回实物前不得退款（礼赠超时全额退除外）
    if (order.returnMode === 'store_return' && order.pickupReturnStatus !== 'returned' && !forceFullRefund) {
      return {
        success: false,
        code: 'RETURN_PENDING',
        msg: '请先确认已收回顾客送回门店的藏品，再执行退款'
      }
    }

    return await executeRefund(orderId, order, openid, actorMeta, { forceFullRefund })
  } catch (err) {
    console.error(err)
    return { success: false, msg: err.message || '退款失败' }
  }
}
