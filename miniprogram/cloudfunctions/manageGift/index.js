/**
 * 礼赠履约：领取、填址、催填、自提核销、过期扫描
 */
const cloud = require('wx-server-sdk')
// 来源判定统一真源（负向子串判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource } = require('./sourceOrigin')
const { dispatchInAppMessage } = require('./inAppMessage')
const { assertStaff } = require('./staffGuard')
const {
  isInviteAddressGift,
  isGiftOrder,
  needsAddressBeforeShip,
  maskPhone,
  maskAddress,
  buildProductSnapshot,
  createClaimCode,
  DEFAULT_ADDRESS_TIMEOUT_DAYS
} = require('./giftMeta')
const { notifyGiftSubscribe } = require('./giftSubscribe')
const {
  COLLECTION: GIFT_SETTINGS_COL,
  DOC_KEY: GIFT_SETTINGS_KEY,
  TIMEOUT_OPTIONS,
  DELIVERY_LABELS: SETTINGS_DELIVERY_LABELS,
  normalizeSettings,
  describeSettings,
  nudgeRuleSummary,
  loadSettingsDoc,
  loadGiftSettings,
  buildSubscribeStatus
} = require('./giftSettings')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const FLAGS_COLLECTION = 'content_display_flags'

/**
 * 礼赠领取/自提核销后的线上赠分 — 与 confirmOrderReceipt 同源
 * 复用 grantStorePoints.grantOnlineOrder（按订单幂等），计入下单人（付款方）的线上消费累计。
 * best-effort，失败不阻塞核销。
 */
async function grantGiftReceiptPoints(orderId) {
  try {
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: { action: 'grantOnlineOrder', orderId, __fromReceipt: true }
    })
    const result = (res && res.result) || {}
    if (!result.success) {
      console.warn('grantOnlineOrder skipped:', result.msg)
      return { pointsGranted: 0, msg: result.msg || '' }
    }
    return {
      pointsGranted: Number(result.pointsGranted) || 0,
      duplicated: !!result.duplicated,
      msg: result.msg || ''
    }
  } catch (e) {
    console.warn('grantOnlineOrder call failed:', e && e.message)
    return { pointsGranted: 0, msg: '' }
  }
}

/** 赠分成功后回写订单，便于详情页展示与审计；失败仅告警 */
async function markGiftOrderPointsGranted(orderId, points) {
  try {
    await db.collection('orders').doc(orderId).update({
      data: {
        pointsGranted: points,
        pointsGrantedAt: db.serverDate(),
        pointsGrantedSource: 'online_order'
      }
    })
  } catch (e) {
    console.warn('mark pointsGranted failed:', e && e.message)
  }
}

async function isGiftFeatureEnabled() {
  try {
    const res = await db.collection(FLAGS_COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    const doc = (res.data && res.data[0]) || null
    if (!doc) return false
    return doc.showGift === true
  } catch (e) {
    try {
      const res = await db.collection(FLAGS_COLLECTION).limit(20).get()
      const rows = (res.data || []).filter((d) => d.status !== 'inactive')
      rows.sort((a, b) => (b.priority || 0) - (a.priority || 0))
      return !!(rows[0] && rows[0].showGift === true)
    } catch (err) {
      return false
    }
  }
}

async function findOrderByToken(token) {
  const t = String(token || '').trim()
  if (!t) return null
  const res = await db.collection('orders').where({
    'giftMeta.shareToken': t
  }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function loadOrder(orderId) {
  if (!orderId) return null
  try {
    const res = await db.collection('orders').doc(orderId).get()
    return res.data || null
  } catch (e) {
    console.warn('loadOrder', orderId, e && e.message)
    return null
  }
}

function isExpired(order) {
  const meta = order.giftMeta || {}
  if (order.status === 'expired_refunding' || order.status === 'refunded' || order.status === 'cancelled') {
    return true
  }
  if (!meta.expireAt) return false
  return new Date(meta.expireAt).getTime() < Date.now()
}

function publicGiftView(order, { role = 'receiver', includeVoiceMeta = true } = {}) {
  const meta = order.giftMeta || {}
  const hidePrice = meta.hidePrice !== false
  const products = buildProductSnapshot(order.products || [], { hidePrice })
  const expired = isExpired(order)
  // 以 addressStatus / needsAddressBeforeShip 为准；勿仅凭 status 判定（填址后 status 偶发未翻转为 paid）
  const awaiting = needsAddressBeforeShip(order)
  const voiceDuration = Math.min(60, Math.max(0, parseInt(meta.voiceDuration, 10) || 0))
  const hasVoice = !!(meta.voiceFileID && voiceDuration > 0)

  const view = {
    orderId: order._id,
    orderNo: order.orderNo || '',
    status: order.status,
    expired,
    awaitingAddress: awaiting,
    deliveryType: meta.deliveryType || 'invite_address',
    acceptStatus: meta.acceptStatus || 'none',
    addressStatus: meta.addressStatus || 'none',
    cardBody: meta.cardBody || '',
    cardSignature: meta.cardSignature || '',
    recipientName: meta.recipientName || meta.salutation || '',
    salutation: meta.salutation || meta.recipientName || '',
    hidePrice,
    shareToken: meta.shareToken || '',
    expireAt: meta.expireAt || null,
    addressTimeoutDays: meta.addressTimeoutDays || DEFAULT_ADDRESS_TIMEOUT_DAYS,
    products,
    giverIsSelf: role === 'giver',
    /** sender=送礼人；receiver=收件人/持卡访客（与 PRD Two Audiences 对齐） */
    viewerRole: role === 'giver' ? 'sender' : 'receiver',
    receiverBound: !!meta.receiverOpenid,
    totalPrice: role === 'giver' ? order.totalPrice : undefined,
    paidTime: order.paidTime || null,
    storeId: meta.storeId || '',
    storeName: meta.storeName || '',
    claimCode: meta.claimCode || '',
    claimStatus: meta.claimStatus || 'none',
    claimQrPayload: meta.claimCode ? `GIFT:${meta.claimCode}` : '',
    claimedAt: meta.claimedAt || null,
    hasVoice: false,
    voiceDuration: 0,
    voiceTempUrl: '',
    receiverPhoneMasked: meta.receiverPhoneMasked || '',
    addressMasked: null,
    address: null
  }

  if (meta.addressStatus === 'submitted' && order.address) {
    // 收礼人展示层脱敏；送礼人履约可见完整（C11）
    view.addressMasked = maskAddress(order.address)
    if (!view.receiverPhoneMasked) {
      view.receiverPhoneMasked = maskPhone(order.address.phone)
    }
    if (role === 'giver') {
      view.address = {
        name: order.address.name || '',
        phone: order.address.phone || '',
        region: order.address.region || [],
        detail: order.address.detail || ''
      }
    }
  }

  // 默认不回传 fileID，防遍历；有权方由 enrichVoiceAccess 写入临时链
  if (includeVoiceMeta && hasVoice) {
    view.hasVoice = true
    view.voiceDuration = voiceDuration
  }

  return view
}

/** 礼笺语音：仅送礼人 / 有效 shareToken / 已绑定收礼人可听 */
function canAccessGiftVoice(order, openid, token) {
  const meta = (order && order.giftMeta) || {}
  if (!meta.voiceFileID) return false
  const isGiver = !!(openid && (openid === order._openid || openid === order.openid))
  if (isGiver) return true
  if (openid && meta.receiverOpenid && meta.receiverOpenid === openid) return true
  const shareToken = String(meta.shareToken || '').trim()
  const given = String(token || '').trim()
  if (shareToken && given && shareToken === given) return true
  return false
}

async function resolveVoiceTempUrl(fileID) {
  const id = String(fileID || '').trim()
  if (!id) return ''
  try {
    const res = await cloud.getTempFileURL({ fileList: [id] })
    const item = (res.fileList && res.fileList[0]) || null
    if (item && item.tempFileURL && (!item.status || item.status === 0)) {
      return item.tempFileURL
    }
  } catch (e) {
    console.warn('gift voice temp url', e)
  }
  return ''
}

async function enrichVoiceAccess(view, order, openid, token) {
  if (!view || !view.hasVoice) return view
  if (!canAccessGiftVoice(order, openid, token)) {
    view.hasVoice = false
    view.voiceDuration = 0
    view.voiceTempUrl = ''
    return view
  }
  const meta = order.giftMeta || {}
  view.voiceTempUrl = await resolveVoiceTempUrl(meta.voiceFileID)
  return view
}

function parseClaimCode(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const m = text.match(/^GIFT:([A-Za-z0-9]+)$/i)
  if (m) return m[1].toUpperCase()
  return text.replace(/^GIFT:/i, '').trim().toUpperCase()
}

async function findOrderByClaimCode(claimCode) {
  const code = parseClaimCode(claimCode)
  if (!code) return null
  const res = await db.collection('orders').where({
    'giftMeta.claimCode': code
  }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/**
 * 自提核销：店员扫 GIFT:{claimCode}（与预约票、COUPON: 分离）
 */
async function verifyPickup(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }

  const storeId = String((event && event.storeId) || '').trim()
  const guard = await assertStaff(db, openid, {
    permission: 'verifyGiftPickup',
    storeId: storeId || undefined
  })
  if (!guard.ok) {
    return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无操作权限' }
  }

  const code = parseClaimCode(event.claimCode || event.raw || '')
  if (!code) return { success: false, msg: '缺少领取码' }

  let order = await findOrderByClaimCode(code)
  if (!order && event.orderId) order = await loadOrder(event.orderId)
  if (!order || !isGiftOrder(order)) {
    return { success: false, msg: '未找到对应礼赠单' }
  }

  const meta = order.giftMeta || {}
  if (meta.deliveryType !== 'store_pickup') {
    return { success: false, msg: '该单不是门店自提礼赠' }
  }
  if (meta.claimCode && parseClaimCode(meta.claimCode) !== code) {
    return { success: false, msg: '领取码不匹配' }
  }

  if (storeId && meta.storeId && meta.storeId !== storeId) {
    return {
      success: false,
      msg: `请到「${meta.storeName || '指定门店'}」核销`
    }
  }

  if (meta.claimStatus === 'claimed' || order.status === 'received') {
    // 失败自愈：此前发起过赠分但未成功落库 → 本次补发（幂等，不会重复入账）
    let giftHealed = 0
    if (order.pointsGrantRequestedAt && !order.pointsGrantedAt) {
      const retry = await grantGiftReceiptPoints(order._id)
      giftHealed = retry.pointsGranted || 0
      if (giftHealed > 0) await markGiftOrderPointsGranted(order._id, giftHealed)
    }
    return {
      success: true,
      already: true,
      msg: '此前已核销领取',
      pointsGranted: giftHealed || Number(order.pointsGranted) || 0,
      orderId: order._id,
      orderNo: order.orderNo || '',
      claimCode: meta.claimCode || code,
      storeName: meta.storeName || '',
      products: buildProductSnapshot(order.products || [], { hidePrice: false })
    }
  }

  const okStatus = ['paid', 'shipped', 'ready_pickup'].includes(String(order.status || ''))
  if (!okStatus) {
    return { success: false, msg: `当前状态不可核销（${order.status || ''}）` }
  }

  let claimCode = meta.claimCode || code
  if (!meta.claimCode) {
    claimCode = createClaimCode()
  }

  const nextMeta = {
    ...meta,
    claimCode,
    claimStatus: 'claimed',
    claimedAt: db.serverDate(),
    claimedByStaff: openid
  }

  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'received',
      receiveTime: db.serverDate(),
      giftMeta: nextMeta,
      // 赠分意图：赠分失败时可在下次调用自愈补发
      pointsGrantRequestedAt: db.serverDate()
    }
  })

  // 领取/核销完成等同签收：按线上订单规则给下单人赠分（同一订单幂等）
  const giftGrant = await grantGiftReceiptPoints(order._id)
  if (giftGrant.pointsGranted > 0) await markGiftOrderPointsGranted(order._id, giftGrant.pointsGranted)

  const productNames = (order.products || []).map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、')
  const vars = {
    orderNo: order.orderNo || '',
    storeName: meta.storeName || '',
    productNames
  }
  const giver = order._openid || order.openid
  if (giver) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_received',
      openid: giver,
      relatedId: order._id,
      vars
    }).catch(() => {})
  }
  if (meta.receiverOpenid && meta.receiverOpenid !== giver) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_received',
      openid: meta.receiverOpenid,
      relatedId: order._id,
      vars
    }).catch(() => {})
  }

  return {
    success: true,
    msg: '已确认领取',
    orderId: order._id,
    orderNo: order.orderNo || '',
    claimCode,
    storeName: meta.storeName || '',
    products: buildProductSnapshot(order.products || [], { hidePrice: false })
  }
}

async function getShare(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }

  const token = String(event.token || '').trim()
  const orderId = String(event.orderId || '').trim()
  let order = null
  if (token) order = await findOrderByToken(token)
  if (!order && orderId) order = await loadOrder(orderId)

  if (!order || !isGiftOrder(order)) {
    return { success: false, msg: '礼赠不存在或链接无效' }
  }
  if (token && order.giftMeta && order.giftMeta.shareToken && order.giftMeta.shareToken !== token) {
    return { success: false, msg: '礼赠链接无效' }
  }

  await healSubmittedStillAwaiting([order])

  const isGiver = !!(openid && (openid === order._openid || openid === order.openid))
  const viewerRole = isGiver ? 'sender' : 'receiver'
  if (isExpired(order) && !isGiver) {
    const expiredView = await enrichVoiceAccess(
      publicGiftView(order, { role: 'receiver' }),
      order,
      openid,
      token
    )
    return {
      success: true,
      expired: true,
      gift: expiredView,
      isGiver: false,
      viewerRole: 'receiver',
      msg: '这份邀约已过期'
    }
  }

  const gift = await enrichVoiceAccess(
    publicGiftView(order, { role: isGiver ? 'giver' : 'receiver' }),
    order,
    openid,
    token
  )

  // 非送礼人：无有效 token 时不回传 shareToken / 领取码，防仅凭 orderId 冒领
  if (!isGiver) {
    const given = String(token || '').trim()
    const real = String((order.giftMeta && order.giftMeta.shareToken) || '').trim()
    const tokenOk = !!(given && real && given === real)
    const isBoundReceiver = !!(
      openid &&
      order.giftMeta &&
      order.giftMeta.receiverOpenid &&
      order.giftMeta.receiverOpenid === openid
    )
    if (!tokenOk && !isBoundReceiver) {
      gift.shareToken = ''
      gift.claimCode = ''
      gift.claimQrPayload = ''
      gift.hasVoice = false
      gift.voiceTempUrl = ''
      gift.voiceDuration = 0
    }
  }

  return {
    success: true,
    gift,
    isGiver,
    viewerRole,
    /** 送礼人也可看到过期态（回执），但不走收件人「邀约已过期」阻断页 */
    expired: !!(gift && gift.expired && !isGiver)
  }
}

async function acceptGift(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  const token = String(event.token || '').trim()
  let order = token ? await findOrderByToken(token) : null
  if (!order && event.orderId) order = await loadOrder(event.orderId)
  if (!order || !isGiftOrder(order) || !isInviteAddressGift(order)) {
    return { success: false, msg: '礼赠不存在' }
  }
  const meta = order.giftMeta || {}
  const shareToken = String(meta.shareToken || '').trim()
  // 首次收下须持有效 shareToken，防仅凭 orderId 冒领
  if (!token || !shareToken || token !== shareToken) {
    return { success: false, code: 'BAD_TOKEN', msg: '请从分享礼笺进入后再收下' }
  }
  if (openid === order._openid || openid === order.openid) {
    return { success: false, msg: '不能收下自己送出的礼赠' }
  }
  if (isExpired(order)) {
    return { success: false, code: 'EXPIRED', msg: '这份邀约已过期' }
  }
  if (order.status !== 'paid_awaiting_address' && order.status !== 'paid') {
    return { success: false, msg: '当前状态不可收下' }
  }

  if (meta.receiverOpenid && meta.receiverOpenid !== openid) {
    return { success: false, code: 'CLAIMED', msg: '这份山海已有去处' }
  }
  if (meta.acceptStatus === 'accepted' && meta.receiverOpenid === openid) {
    return { success: true, already: true, gift: publicGiftView(order, { role: 'receiver' }) }
  }

  const nextMetaPatch = {
    'giftMeta.acceptStatus': 'accepted',
    'giftMeta.acceptedAt': db.serverDate(),
    'giftMeta.receiverOpenid': openid
  }
  await db.collection('orders').doc(order._id).update({
    data: nextMetaPatch
  })

  const giver = order._openid || order.openid
  await dispatchInAppMessage(db, {
    eventType: 'gift_accepted',
    openid: giver,
    relatedId: order._id,
    vars: { orderNo: order.orderNo || '', products: order.products }
  }).catch(() => {})

  order.giftMeta = {
    ...meta,
    acceptStatus: 'accepted',
    acceptedAt: nextMetaPatch['giftMeta.acceptedAt'],
    receiverOpenid: openid
  }
  return { success: true, gift: publicGiftView(order, { role: 'receiver' }) }
}

/** 填址完成后必须离开 paid_awaiting_address，否则送礼人/店长仍看到「待填址」 */
async function ensureGiftAddressStatusPaid(orderId) {
  if (!orderId) return
  try {
    await db.collection('orders').doc(orderId).update({
      data: { status: 'paid' }
    })
  } catch (e) {
    console.error('ensureGiftAddressStatusPaid failed', orderId, e)
  }
}

/** 批量纠正：addressStatus=submitted 但仍停在 paid_awaiting_address 的脏单 */
async function healSubmittedStillAwaiting(orders) {
  const dirty = (orders || []).filter(
    (o) =>
      o &&
      o._id &&
      o.status === 'paid_awaiting_address' &&
      o.giftMeta &&
      o.giftMeta.addressStatus === 'submitted'
  )
  if (!dirty.length) return
  await Promise.all(
    dirty.map(async (o) => {
      await ensureGiftAddressStatusPaid(o._id)
      o.status = 'paid'
    })
  )
}

async function submitAddress(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  const token = String(event.token || '').trim()
  const orderIdRaw = String(event.orderId || '').trim()
  let order = token ? await findOrderByToken(token) : null
  if (!order && orderIdRaw) order = await loadOrder(orderIdRaw)
  if (!order || !isGiftOrder(order) || !isInviteAddressGift(order)) {
    return { success: false, msg: '礼赠不存在' }
  }
  if (!order._id) {
    return { success: false, msg: '礼赠单异常，请从礼笺页重新进入' }
  }
  if (isExpired(order)) {
    return { success: false, code: 'EXPIRED', msg: '这份邀约已过期' }
  }

  const meta = order.giftMeta || {}
  const shareToken = String(meta.shareToken || '').trim()
  const tokenOk = !!(token && shareToken && token === shareToken)
  // 已收下绑定的受赠人可从「我的礼赠」填址（不必再持分享 token）
  const isBoundReceiver = !!(meta.receiverOpenid && meta.receiverOpenid === openid)
  if (!tokenOk && !isBoundReceiver) {
    return { success: false, code: 'BAD_TOKEN', msg: '请从分享礼笺进入后再填写' }
  }
  if (meta.receiverOpenid && meta.receiverOpenid !== openid) {
    return { success: false, code: 'CLAIMED', msg: '这份山海已有去处' }
  }
  if (meta.addressStatus === 'submitted') {
    // 历史脏数据：地址已记但 status 未翻转 → 补齐后返回
    if (order.status === 'paid_awaiting_address') {
      await ensureGiftAddressStatusPaid(order._id)
    }
    return { success: true, already: true, msg: '地址已提交' }
  }

  const addr = event.address || {}
  const name = String(addr.name || '').trim().slice(0, 40)
  const phone = String(addr.phone || '').trim().slice(0, 20)
  const detail = String(addr.detail || '').trim().slice(0, 120)
  const region = Array.isArray(addr.region)
    ? addr.region.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  if (!name || !phone || !detail || region.length < 2) {
    return { success: false, msg: '请填写完整收件信息' }
  }

  const addressDoc = { name, phone, region, detail }
  const acceptedAt = meta.acceptedAt || db.serverDate()
  const phoneMasked = maskPhone(phone)

  // 下单时 invite_address 可能把 address 写成 null；直接整对象替换易触发 -502001。
  // 先清 null，再写普通对象 + 点路径 giftMeta，并强制 status→paid。
  const metaPatch = {
    status: 'paid',
    address: addressDoc,
    'giftMeta.acceptStatus': 'accepted',
    'giftMeta.acceptedAt': acceptedAt,
    'giftMeta.receiverOpenid': openid,
    'giftMeta.addressStatus': 'submitted',
    'giftMeta.addressSubmittedAt': db.serverDate(),
    'giftMeta.receiverPhoneMasked': phoneMasked
  }

  try {
    if (order.address == null) {
      try {
        await db.collection('orders').doc(order._id).update({
          data: { address: _.remove() }
        })
      } catch (e0) {
        /* 字段本就不存在时忽略 */
      }
    }
    await db.collection('orders').doc(order._id).update({ data: metaPatch })
  } catch (e) {
    const errMsg = String((e && (e.message || e.errMsg)) || '')
    console.error('submitAddress update failed', order._id, errMsg, e)
    try {
      await db.collection('orders').doc(order._id).update({
        data: { address: _.remove() }
      })
    } catch (eRemove) {
      /* ignore */
    }
    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'paid',
          address: _.set(addressDoc),
          'giftMeta.acceptStatus': 'accepted',
          'giftMeta.acceptedAt': acceptedAt,
          'giftMeta.receiverOpenid': openid,
          'giftMeta.addressStatus': 'submitted',
          'giftMeta.addressSubmittedAt': db.serverDate(),
          'giftMeta.receiverPhoneMasked': phoneMasked
        }
      })
    } catch (e2) {
      console.error('submitAddress fallback failed', order._id, e2)
      return {
        success: false,
        code: 'DB_UPDATE',
        msg: '此刻未能记下地址，请稍后再试'
      }
    }
  }

  // 二次确认：地址已提交则 status 必须离开 paid_awaiting_address
  const fresh = await loadOrder(order._id)
  if (
    fresh &&
    fresh.status === 'paid_awaiting_address' &&
    fresh.giftMeta &&
    fresh.giftMeta.addressStatus === 'submitted'
  ) {
    await ensureGiftAddressStatusPaid(order._id)
  }

  const giver = String(order._openid || order.openid || '').trim()
  const receiver = String(openid || '').trim()
  const addrVars = { orderNo: order.orderNo || '', products: order.products }

  // 赠予者：TA 已留下地址（dedupe: gift_address_submitted:orderId:openid）
  if (giver) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_address_submitted',
      openid: giver,
      relatedId: order._id,
      vars: addrVars
    }).catch(() => {})
    await notifyGiftSubscribe(cloud, 'fulfill', {
      openid: giver,
      orderId: order._id,
      orderNo: order.orderNo,
      tip: 'TA 已留下地址，即将启程'
    }).catch(() => {})
  }

  // 受赠人：已记下去处（与赠予者同 openid 时跳过，避免自送自收重复）
  if (receiver && receiver !== giver) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_address_submitted_receiver',
      openid: receiver,
      relatedId: order._id,
      vars: addrVars
    }).catch(() => {})
  }

  const masked = maskAddress(addressDoc)
  return {
    success: true,
    msg: '地址已确认，馆员将为你备妥启程',
    phoneMasked: masked.phone,
    addressMasked: masked
  }
}

async function nudge(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }
  const orderId = String(event.orderId || '').trim()
  const order = await loadOrder(orderId)
  if (!order || !isGiftOrder(order)) return { success: false, msg: '订单不存在' }
  if (openid !== order._openid && openid !== order.openid) {
    return { success: false, msg: '无权操作' }
  }
  if (!isInviteAddressGift(order) || !needsAddressBeforeShip(order)) {
    return { success: false, msg: '当前无需催填' }
  }
  if (isExpired(order)) return { success: false, msg: '邀约已过期' }

  const meta = order.giftMeta || {}
  const last = meta.lastNudgeAt ? new Date(meta.lastNudgeAt).getTime() : 0
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
    return { success: false, msg: '今日已提醒过，明日再试' }
  }

  const nextMeta = {
    ...meta,
    nudgeCount: (meta.nudgeCount || 0) + 1,
    lastNudgeAt: db.serverDate()
  }
  await db.collection('orders').doc(orderId).update({ data: { giftMeta: nextMeta } })

  await dispatchInAppMessage(db, {
    eventType: 'gift_nudge',
    openid,
    relatedId: orderId,
    vars: { orderNo: order.orderNo || '', products: order.products }
  }).catch(() => {})

  if (meta.receiverOpenid) {
    await dispatchInAppMessage(db, {
      eventType: 'gift_nudge_receiver',
      openid: meta.receiverOpenid,
      relatedId: orderId,
      vars: { token: meta.shareToken || '' }
    }).catch(() => {})
    await notifyGiftSubscribe(cloud, 'nudge', {
      openid: meta.receiverOpenid,
      orderId,
      orderNo: order.orderNo,
      tip: '还有一份山海等你留下去处'
    }).catch(() => {})
  }

  await notifyGiftSubscribe(cloud, 'nudge', {
    openid,
    orderId,
    orderNo: order.orderNo,
    tip: '不妨再提醒 TA 留下地址'
  }).catch(() => {})

  return { success: true, msg: '已记下提醒，请再分享礼笺给 TA' }
}

/**
 * 过期扫描：标记过期并调用 refundOrder.giftExpireRefund 全额退
 * 同时重试仍卡在 expired_refunding 的失败单（上次退款调用失败时不会被再次扫到）
 */
async function expireSweep(event, openid) {
  const internalKey = String(event.internalKey || '')
  const expected = process.env.GIFT_EXPIRE_INTERNAL_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''
  const viaInternal = expected && internalKey && internalKey === expected
  if (!expected) {
    // 不再静默：密钥缺失会让下游 refundOrder 的凭证链断掉，运维需要看得见
    console.warn('[manageGift] 未配置 GIFT_EXPIRE_INTERNAL_KEY / PAY_CALLBACK_INTERNAL_KEY；将依赖「非客户端来源」判定，请确认云函数环境变量')
  }

  // 定时/服务端互调（非客户端来源）或持正确内部密钥方可执行；
  // C 端任意登录用户此前仅凭 openid 就能触发全站礼赠过期退款，属严重越权。
  if (!viaInternal && !isNonClientSource()) {
    return { success: false, msg: '无权' }
  }

  const now = new Date()
  let scanned = 0
  let marked = 0
  let refunded = 0
  let retried = 0
  const errors = []

  async function runGiftExpireRefund(order, { notifyOnFail = true } = {}) {
    const meta = order.giftMeta || {}
    const refundPayload = {
      action: 'giftExpireRefund',
      orderId: order._id
    }
    if (viaInternal) refundPayload.internalKey = internalKey
    else if (event.adminOpsKey) refundPayload.adminOpsKey = event.adminOpsKey

    try {
      const refundRes = await cloud.callFunction({
        name: 'refundOrder',
        data: refundPayload
      })
      const rr = (refundRes && refundRes.result) || {}
      if (rr.success) {
        refunded += 1
        const giver = order._openid || order.openid
        // 站内信由 refundOrder.giftExpireRefund 写入；此处仅补订阅消息
        if (giver) {
          await notifyGiftSubscribe(cloud, 'expire', {
            openid: giver,
            orderId: order._id,
            orderNo: order.orderNo,
            tip: '邀约已过期，款项将退回',
            expireLabel: meta.expireAt
              ? new Date(meta.expireAt).toLocaleDateString('zh-CN')
              : ''
          }).catch(() => {})
        }
        return true
      }
      errors.push({ orderId: order._id, msg: rr.msg || '退款失败' })
      if (notifyOnFail) {
        const giver = order._openid || order.openid
        if (giver) {
          await dispatchInAppMessage(db, {
            eventType: 'gift_expired_refund',
            openid: giver,
            relatedId: order._id,
            vars: { orderNo: order.orderNo || '', products: order.products }
          }).catch(() => {})
          await notifyGiftSubscribe(cloud, 'expire', {
            openid: giver,
            orderId: order._id,
            orderNo: order.orderNo,
            tip: '邀约已过期，款项处理中',
            expireLabel: meta.expireAt
              ? new Date(meta.expireAt).toLocaleDateString('zh-CN')
              : ''
          }).catch(() => {})
        }
      }
      return false
    } catch (re) {
      errors.push({ orderId: order._id, msg: (re && re.message) || '退款调用异常' })
      return false
    }
  }

  try {
    const [freshRes, stuckRes] = await Promise.all([
      db.collection('orders')
        .where({
          status: 'paid_awaiting_address',
          'giftMeta.expireAt': _.lte(now)
        })
        .limit(30)
        .get(),
      db.collection('orders')
        .where({ status: 'expired_refunding' })
        .limit(20)
        .get()
    ])
    const freshRows = freshRes.data || []
    const stuckRows = stuckRes.data || []
    scanned = freshRows.length + stuckRows.length

    for (const order of freshRows) {
      const meta = order.giftMeta || {}
      if (meta.addressStatus === 'submitted') continue

      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'expired_refunding',
          giftMeta: {
            ...meta,
            shareToken: '',
            expiredAt: db.serverDate()
          },
          cancelReason: 'gift_address_timeout'
        }
      })
      marked += 1
      await runGiftExpireRefund(order, { notifyOnFail: true })
    }

    for (const order of stuckRows) {
      retried += 1
      // 重试失败不再重复催信（首轮已通知「款项处理中」）
      await runGiftExpireRefund(order, { notifyOnFail: false })
    }
  } catch (e) {
    console.warn('expireSweep', e)
    return {
      success: false,
      msg: e.message || '扫描失败',
      scanned,
      marked,
      retried,
      refunded,
      errors
    }
  }

  return {
    success: true,
    scanned,
    marked,
    retried,
    refunded,
    errors,
    note: errors.length === 0
      ? '过期单已全额退款'
      : '部分过期单已标记/重试，退款失败项见 errors'
  }
}

function daysSince(dateLike) {
  if (!dateLike) return -1
  const t = new Date(dateLike).getTime()
  if (!Number.isFinite(t)) return -1
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
}

/**
 * 自动催填：支付后 D+3 / D+6 各 1 次（不占用手动日频控）
 */
async function nudgeSweep(event, openid) {
  const internalKey = String(event.internalKey || '')
  const expected = process.env.GIFT_EXPIRE_INTERNAL_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''
  const viaInternal = expected && internalKey && internalKey === expected
  // 同 expireSweep：以「非客户端来源」替代「有 openid 即放行」
  if (!viaInternal && !isNonClientSource()) {
    return { success: false, msg: '无权' }
  }

  let scanned = 0
  let nudged3 = 0
  let nudged6 = 0

  try {
    const res = await db.collection('orders')
      .where({ status: 'paid_awaiting_address' })
      .orderBy('paidTime', 'asc')
      .limit(80)
      .get()
    const rows = res.data || []
    scanned = rows.length

    for (const order of rows) {
      if (!isInviteAddressGift(order)) continue
      const meta = order.giftMeta || {}
      if (meta.addressStatus === 'submitted') continue
      if (isExpired(order)) continue

      const day = daysSince(order.paidTime)
      if (day < 0) continue

      let patch = null
      let dayIndex = 0
      if (day >= 6 && !meta.nudgeAutoDay6) {
        patch = { ...meta, nudgeAutoDay6: true, lastAutoNudgeAt: db.serverDate() }
        dayIndex = 6
      } else if (day >= 3 && !meta.nudgeAutoDay3) {
        patch = { ...meta, nudgeAutoDay3: true, lastAutoNudgeAt: db.serverDate() }
        dayIndex = 3
      }
      if (!patch) continue

      await db.collection('orders').doc(order._id).update({ data: { giftMeta: patch } })

      const giver = order._openid || order.openid
      if (giver) {
        await dispatchInAppMessage(db, {
          eventType: 'gift_nudge',
          openid: giver,
          relatedId: order._id,
          vars: { orderNo: order.orderNo || '', products: order.products }
        }).catch(() => {})
        const tip =
          dayIndex === 6
            ? '填址期限将近，请再提醒 TA'
            : '不妨再提醒 TA 留下地址'
        await notifyGiftSubscribe(cloud, dayIndex === 6 ? 'expire' : 'nudge', {
          openid: giver,
          orderId: order._id,
          orderNo: order.orderNo,
          tip,
          expireLabel: meta.expireAt
            ? new Date(meta.expireAt).toLocaleDateString('zh-CN')
            : ''
        }).catch(() => {})
      }
      if (meta.receiverOpenid) {
        await dispatchInAppMessage(db, {
          eventType: 'gift_nudge_receiver',
          openid: meta.receiverOpenid,
          relatedId: order._id,
          vars: { token: meta.shareToken || '' }
        }).catch(() => {})
        await notifyGiftSubscribe(cloud, 'nudge', {
          openid: meta.receiverOpenid,
          orderId: order._id,
          orderNo: order.orderNo,
          tip: '还有一份山海等你留下去处'
        }).catch(() => {})
      }

      if (dayIndex === 6) nudged6 += 1
      else nudged3 += 1
    }
  } catch (e) {
    // 无 paidTime 索引时降级：不 orderBy
    console.warn('nudgeSweep primary failed, fallback', e && e.message)
    try {
      const res = await db.collection('orders')
        .where({ status: 'paid_awaiting_address' })
        .limit(80)
        .get()
      scanned = (res.data || []).length
      for (const order of res.data || []) {
        if (!isInviteAddressGift(order)) continue
        const meta = order.giftMeta || {}
        if (meta.addressStatus === 'submitted' || isExpired(order)) continue
        const day = daysSince(order.paidTime)
        let patch = null
        let dayIndex = 0
        if (day >= 6 && !meta.nudgeAutoDay6) {
          patch = { ...meta, nudgeAutoDay6: true, lastAutoNudgeAt: db.serverDate() }
          dayIndex = 6
        } else if (day >= 3 && !meta.nudgeAutoDay3) {
          patch = { ...meta, nudgeAutoDay3: true, lastAutoNudgeAt: db.serverDate() }
          dayIndex = 3
        }
        if (!patch) continue
        await db.collection('orders').doc(order._id).update({ data: { giftMeta: patch } })
        const giver = order._openid || order.openid
        if (giver) {
          await dispatchInAppMessage(db, {
            eventType: 'gift_nudge',
            openid: giver,
            relatedId: order._id,
            vars: { orderNo: order.orderNo || '', products: order.products }
          }).catch(() => {})
          await notifyGiftSubscribe(cloud, dayIndex === 6 ? 'expire' : 'nudge', {
            openid: giver,
            orderId: order._id,
            orderNo: order.orderNo,
            tip: dayIndex === 6 ? '填址期限将近，请再提醒 TA' : '不妨再提醒 TA 留下地址',
            expireLabel: meta.expireAt
              ? new Date(meta.expireAt).toLocaleDateString('zh-CN')
              : ''
          }).catch(() => {})
        }
        if (dayIndex === 6) nudged6 += 1
        else nudged3 += 1
      }
    } catch (e2) {
      return { success: false, msg: e2.message || '催填扫描失败', scanned, nudged3, nudged6 }
    }
  }

  return { success: true, scanned, nudged3, nudged6 }
}

async function dailySweep(event, openid) {
  const nudge = await nudgeSweep(event, openid)
  const expire = await expireSweep(event, openid)
  return {
    success: !!(nudge.success && expire.success),
    nudge,
    expire
  }
}

async function getGiftVoice(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }

  const token = String(event.token || '').trim()
  const orderId = String(event.orderId || '').trim()
  let order = null
  if (token) order = await findOrderByToken(token)
  if (!order && orderId) order = await loadOrder(orderId)
  if (!order || !isGiftOrder(order)) {
    return { success: false, msg: '礼赠不存在或链接无效' }
  }
  if (token && order.giftMeta && order.giftMeta.shareToken && order.giftMeta.shareToken !== token) {
    return { success: false, msg: '礼赠链接无效' }
  }
  if (!canAccessGiftVoice(order, openid, token)) {
    return { success: false, code: 'FORBIDDEN', msg: '无权听取此礼笺语音' }
  }

  const meta = order.giftMeta || {}
  const voiceDuration = Math.min(60, Math.max(0, parseInt(meta.voiceDuration, 10) || 0))
  if (!meta.voiceFileID || voiceDuration <= 0) {
    return { success: false, msg: '暂无语音礼笺' }
  }

  const voiceTempUrl = await resolveVoiceTempUrl(meta.voiceFileID)
  if (!voiceTempUrl) {
    return { success: false, msg: '语音暂不可用，请稍后再试' }
  }

  return {
    success: true,
    voiceDuration,
    voiceTempUrl
  }
}

const BOARD_BUCKETS = {
  awaiting_address: true,
  awaiting_ship: true,
  pickup_verify: true,
  done: true
}

const DELIVERY_LABELS = {
  invite_address: '先付后填址',
  ship_to_receiver: '快递给 TA',
  ship_to_self: '寄给我',
  store_pickup: '门店自提'
}

function classifyGiftBoardBucket(order) {
  if (!isGiftOrder(order)) return ''
  const status = String(order.status || '')
  const meta = order.giftMeta || {}
  const delivery = meta.deliveryType || 'invite_address'

  if (
    status === 'received' ||
    status === 'refunded' ||
    status === 'expired_refunding' ||
    status === 'cancelled'
  ) {
    return 'done'
  }

  if (delivery === 'store_pickup') {
    if (meta.claimStatus === 'claimed' || status === 'received') return 'done'
    if (['paid', 'shipped', 'ready_pickup'].indexOf(status) !== -1) {
      return 'pickup_verify'
    }
  }

  if (needsAddressBeforeShip(order)) {
    return 'awaiting_address'
  }

  if (status === 'paid' || status === 'shipped') {
    if (status === 'shipped') return 'done'
    return 'awaiting_ship'
  }

  return ''
}

function formatBoardTime(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${m}-${day} ${hh}:${mm}`
  } catch (e) {
    return ''
  }
}

function mapBoardItem(order, { includeFullAddress = true } = {}) {
  const meta = order.giftMeta || {}
  const deliveryType = meta.deliveryType || 'invite_address'
  const bucket = classifyGiftBoardBucket(order)
  const products = buildProductSnapshot(order.products || [], { hidePrice: false })
  const title = (products[0] && products[0].title) || '礼赠标本'
  const addr = order.address || null
  const item = {
    orderId: order._id,
    orderNo: order.orderNo || '',
    status: order.status,
    bucket,
    bucketLabel: {
      awaiting_address: '待填址',
      awaiting_ship: '待发货',
      pickup_verify: '自提待核销',
      done: '已完成'
    }[bucket] || bucket,
    deliveryType,
    deliveryLabel: DELIVERY_LABELS[deliveryType] || deliveryType,
    acceptStatus: meta.acceptStatus || 'none',
    addressStatus: meta.addressStatus || 'none',
    claimCode: meta.claimCode || '',
    claimStatus: meta.claimStatus || 'none',
    storeName: meta.storeName || '',
    expireAt: meta.expireAt || null,
    expireText: formatBoardTime(meta.expireAt),
    paidTime: order.paidTime || null,
    paidText: formatBoardTime(order.paidTime),
    totalPrice: order.totalPrice,
    productTitle: title,
    productImage: (products[0] && products[0].image) || '',
    recipientName: meta.recipientName || meta.salutation || '',
    canShip: bucket === 'awaiting_ship',
    shipBlockReason:
      bucket === 'awaiting_address'
        ? '待 TA 留下地址，暂不可发货'
        : bucket === 'pickup_verify'
          ? '自提单请到核销页扫码妥投'
          : ''
  }

  if (includeFullAddress && addr) {
    item.address = {
      name: addr.name || '',
      phone: addr.phone || '',
      region: addr.region || [],
      detail: addr.detail || '',
      line: [((addr.region || []).join(' ')), addr.detail || ''].filter(Boolean).join(' ')
    }
    item.phone = addr.phone || ''
  } else if (addr) {
    item.addressMasked = maskAddress(addr)
    item.phoneMasked = maskPhone(addr.phone)
  } else if (meta.receiverPhoneMasked) {
    item.phoneMasked = meta.receiverPhoneMasked
  }

  return item
}

/**
 * 店长履约看板：待填址 / 待发货 / 自提待核销 / 已完成
 * 管理端返回完整收件信息；C 端请走 getShare 脱敏视图
 */
async function listBoard(event, openid) {
  if (!openid && !(event && event.adminOpsKey)) {
    return { success: false, msg: '请先登录' }
  }
  const guard = await assertStaff(db, openid, {
    role: 'manager',
    permission: 'giftOps',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无操作权限' }
  }

  const bucket = BOARD_BUCKETS[event.bucket] ? event.bucket : 'awaiting_address'
  const pageSize = Math.min(40, Math.max(1, parseInt(event.pageSize, 10) || 20))
  const page = Math.max(1, parseInt(event.page, 10) || 1)

  const counts = {
    awaiting_address: 0,
    awaiting_ship: 0,
    pickup_verify: 0,
    done: 0
  }

  // 采样近期礼赠单做分桶计数（避免全表扫描）
  let sample = []
  try {
    const res = await db.collection('orders')
      .where({ source: 'gift' })
      .orderBy('paidTime', 'desc')
      .limit(200)
      .get()
    sample = res.data || []
  } catch (e) {
    try {
      const res = await db.collection('orders')
        .where({ status: _.in(['paid_awaiting_address', 'paid', 'shipped', 'ready_pickup', 'received', 'refunded', 'expired_refunding']) })
        .limit(200)
        .get()
      sample = (res.data || []).filter((o) => isGiftOrder(o))
    } catch (e2) {
      console.warn('listBoard sample', e2)
      sample = []
    }
  }

  sample.forEach((o) => {
    const b = classifyGiftBoardBucket(o)
    if (b && counts[b] != null) counts[b] += 1
  })

  const filtered = sample.filter((o) => classifyGiftBoardBucket(o) === bucket)
  const total = filtered.length
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)
  const list = slice.map((o) => mapBoardItem(o, { includeFullAddress: true }))

  return {
    success: true,
    bucket,
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
    counts,
    list,
    note: sample.length >= 200 ? '仅统计最近约 200 笔礼赠单' : ''
  }
}

async function getBoardDetail(event, openid) {
  if (!openid && !(event && event.adminOpsKey)) {
    return { success: false, msg: '请先登录' }
  }
  const guard = await assertStaff(db, openid, {
    role: 'manager',
    permission: 'giftOps',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无操作权限' }
  }
  const orderId = String(event.orderId || '').trim()
  const order = await loadOrder(orderId)
  if (!order || !isGiftOrder(order)) {
    return { success: false, msg: '礼赠单不存在' }
  }
  return {
    success: true,
    item: mapBoardItem(order, { includeFullAddress: true }),
    cardBody: (order.giftMeta && order.giftMeta.cardBody) || '',
    cardSignature: (order.giftMeta && order.giftMeta.cardSignature) || ''
  }
}

async function getGiverShare(event, openid) {
  const orderId = String(event.orderId || '').trim()
  const order = await loadOrder(orderId)
  if (!order || !isGiftOrder(order)) return { success: false, msg: '订单不存在' }
  if (!openid || (openid !== order._openid && openid !== order.openid)) {
    return { success: false, msg: '无权查看' }
  }

  let meta = order.giftMeta || {}
  if (meta.deliveryType === 'store_pickup' && !meta.claimCode && order.status !== 'received') {
    meta = {
      ...meta,
      claimCode: createClaimCode(),
      claimStatus: meta.claimStatus === 'claimed' ? 'claimed' : 'ready'
    }
    await db.collection('orders').doc(order._id).update({ data: { giftMeta: meta } })
    order.giftMeta = meta
  }

  return {
    success: true,
    gift: await enrichVoiceAccess(
      publicGiftView(order, { role: 'giver' }),
      order,
      openid,
      (order.giftMeta && order.giftMeta.shareToken) || ''
    ),
    sharePath: `/subpackages/feature/gift/receive/index?orderId=${order._id}&token=${(order.giftMeta && order.giftMeta.shareToken) || ''}`,
    shareTitle: '请拆开这封山海礼笺'
  }
}

/**
 * C 端「我的礼赠」列表进度态（对齐 giftMeta + 订单 status）
 * role: giver | receiver
 * segment（送出）: awaiting_open | awaiting_address | fulfillment | done
 * segment（收到）: awaiting_open | awaiting_address | shipping | done
 */
function classifyMineProgress(order, role) {
  const status = String(order.status || '')
  const meta = order.giftMeta || {}
  const delivery = meta.deliveryType || 'invite_address'
  const isGiver = role === 'giver'

  if (status === 'pending_pay') {
    return {
      key: 'pending_pay',
      label: '待付款',
      todo: isGiver,
      todoKind: 'pay',
      segment: isGiver ? 'fulfillment' : 'shipping',
      attention: isGiver
    }
  }
  if (status === 'refunded' || status === 'expired_refunding') {
    return {
      key: 'refunded',
      label: status === 'expired_refunding' ? '过期退款中' : '已退款',
      todo: false,
      todoKind: '',
      segment: 'done',
      attention: false
    }
  }
  if (status === 'cancelled' || status === 'void') {
    return {
      key: 'cancelled',
      label: '已取消',
      todo: false,
      todoKind: '',
      segment: 'done',
      attention: false
    }
  }
  if (status === 'received' || meta.claimStatus === 'claimed') {
    return {
      key: 'done',
      label: '已完成',
      todo: false,
      todoKind: '',
      segment: 'done',
      attention: false
    }
  }

  if (delivery === 'store_pickup') {
    if (['paid', 'shipped', 'ready_pickup'].indexOf(status) !== -1) {
      return {
        key: 'pickup_verify',
        label: isGiver ? '自提待核销' : '待到店领取',
        todo: !isGiver,
        todoKind: isGiver ? 'share' : 'pickup',
        segment: isGiver ? 'fulfillment' : 'shipping',
        attention: true
      }
    }
  }

  if (delivery === 'invite_address') {
    const awaitingAddr = needsAddressBeforeShip(order)
    if (awaitingAddr) {
      const accepted = meta.acceptStatus === 'accepted'
      if (!accepted) {
        return {
          key: 'awaiting_open',
          label: isGiver ? '待 TA 启封' : '待启封',
          todo: !isGiver,
          todoKind: isGiver ? 'share' : 'open',
          segment: 'awaiting_open',
          attention: true
        }
      }
      return {
        key: 'awaiting_address',
        label: isGiver ? '待 TA 填址' : '待留下地址',
        todo: !isGiver,
        todoKind: isGiver ? 'nudge' : 'address',
        segment: 'awaiting_address',
        attention: true
      }
    }
  }

  if (status === 'shipped') {
    return {
      key: 'shipping',
      label: '运输中',
      todo: false,
      todoKind: 'logistics',
      segment: isGiver ? 'fulfillment' : 'shipping',
      attention: !isGiver
    }
  }
  if (status === 'paid') {
    // 「待发货」对送礼人就是待办：label 一直写作待发货，却曾把 todo 置为 false，
    // 导致送出方在收礼人已填址后角标不增加（需求 30：有礼赠订单却显示 0）。
    // giftMeta.claimStatus === 'ready' 表示收礼人已填址、只差发货；
    // 'none'（无需填址）或未设置时也由送礼人负责推进，故 giver 一律计入待办。
    const needsShipByGiver = isGiver && (
      meta.claimStatus === 'ready' ||
      meta.claimStatus === 'none' ||
      !meta.claimStatus
    )
    return {
      key: 'awaiting_ship',
      label: '待发货',
      todo: needsShipByGiver,
      todoKind: needsShipByGiver ? 'ship' : '',
      segment: isGiver ? 'fulfillment' : 'shipping',
      attention: false
    }
  }

  return {
    key: status || 'unknown',
    label: '进行中',
    todo: false,
    todoKind: '',
    segment: isGiver ? 'fulfillment' : 'shipping',
    attention: false
  }
}

function snippetCardBody(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 36 ? `${text.slice(0, 36)}…` : text
}

function buildExpireHint(meta, progress) {
  if (!meta || !meta.expireAt) return { expireHint: '', expireUrgent: false, expireDaysLeft: null }
  if (
    progress.segment !== 'awaiting_open' &&
    progress.segment !== 'awaiting_address'
  ) {
    return { expireHint: '', expireUrgent: false, expireDaysLeft: null }
  }
  const t = new Date(meta.expireAt).getTime()
  if (!Number.isFinite(t)) return { expireHint: '', expireUrgent: false, expireDaysLeft: null }
  const daysLeft = Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
  const d = new Date(t)
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日`
  if (daysLeft < 0) {
    return { expireHint: '填址已逾期', expireUrgent: true, expireDaysLeft: daysLeft }
  }
  if (daysLeft <= 1) {
    return { expireHint: `今日截止 · ${dateLabel}`, expireUrgent: true, expireDaysLeft: daysLeft }
  }
  if (daysLeft <= 3) {
    return {
      expireHint: `还剩 ${daysLeft} 日 · ${dateLabel}`,
      expireUrgent: true,
      expireDaysLeft: daysLeft
    }
  }
  return {
    expireHint: `填址截止 ${dateLabel}`,
    expireUrgent: false,
    expireDaysLeft: daysLeft
  }
}

function buildMineActions(order, role, progress) {
  const orderId = order._id
  const meta = order.giftMeta || {}
  const shareToken = meta.shareToken || ''
  const receivePath = `/subpackages/feature/gift/receive/index?orderId=${orderId}&token=${encodeURIComponent(shareToken)}`
  const addressPath = `/subpackages/feature/gift/address/index?orderId=${orderId}&token=${encodeURIComponent(shareToken)}`
  const successPath = `/subpackages/feature/gift/success/index?orderId=${orderId}`
  const orderPath = `/subpackages/business/order-detail/index?id=${orderId}`

  const actions = []
  if (role === 'giver') {
    if (progress.key === 'awaiting_open' || progress.key === 'awaiting_address') {
      actions.push({ key: 'share', label: '再送出', type: 'nav', path: successPath })
      if (progress.key === 'awaiting_address' || progress.key === 'awaiting_open') {
        actions.push({ key: 'nudge', label: '再提醒', type: 'nudge' })
      }
    } else if (progress.key === 'pickup_verify') {
      actions.push({ key: 'share', label: '查看妥投码', type: 'nav', path: successPath })
    } else if (progress.key === 'pending_pay') {
      actions.push({ key: 'pay', label: '去支付', type: 'nav', path: orderPath })
    } else if (progress.key === 'shipping' || progress.key === 'awaiting_ship') {
      actions.push({ key: 'logistics', label: '查看订单', type: 'nav', path: orderPath })
    } else if (progress.key === 'done') {
      actions.push({ key: 'order', label: '订单详情', type: 'nav', path: orderPath })
    }
  } else {
    if (progress.key === 'awaiting_open') {
      actions.push({ key: 'open', label: '去开盒', type: 'nav', path: receivePath })
    } else if (progress.key === 'awaiting_address') {
      actions.push({ key: 'address', label: '去填址', type: 'nav', path: addressPath })
    } else if (progress.key === 'pickup_verify') {
      actions.push({ key: 'pickup', label: '查看领取码', type: 'nav', path: receivePath })
    } else if (progress.key === 'shipping' || progress.key === 'awaiting_ship') {
      actions.push({ key: 'logistics', label: '查看物流', type: 'nav', path: orderPath })
    } else if (progress.key === 'done') {
      actions.push({ key: 'order', label: '订单详情', type: 'nav', path: orderPath })
    }
  }
  return actions.slice(0, 2)
}

function lampForProgress(progress, expireUrgent) {
  if (expireUrgent) return 'warn'
  if (progress.todo || progress.attention) return 'brass'
  if (progress.segment === 'done') return 'muted'
  return 'idle'
}

/** 履约微轨：供「我的礼赠」卡片展示进度 hierarchy */
function buildMineProgressSteps(deliveryType, progressKey) {
  const key = String(progressKey || '')
  if (key === 'refunded' || key === 'cancelled') {
    return { mode: 'terminal', current: -1, steps: [] }
  }
  let labels = ['备妥', '启封', '填址', '启程', '送达']
  let current = 0
  if (deliveryType === 'store_pickup') {
    labels = ['备妥', '领取', '完成']
    if (key === 'pending_pay') current = 0
    else if (key === 'pickup_verify' || key === 'awaiting_open') current = 1
    else if (key === 'done') current = 2
    else current = 1
  } else if (deliveryType === 'invite_address') {
    labels = ['备妥', '启封', '填址', '启程', '送达']
    if (key === 'pending_pay') current = 0
    else if (key === 'awaiting_open') current = 1
    else if (key === 'awaiting_address') current = 2
    else if (key === 'awaiting_ship') current = 3
    else if (key === 'shipping') current = 3
    else if (key === 'done') current = 4
    else current = 2
  } else {
    labels = ['备妥', '启程', '送达']
    if (key === 'pending_pay') current = 0
    else if (key === 'awaiting_ship') current = 1
    else if (key === 'shipping') current = 1
    else if (key === 'done') current = 2
    else current = 1
  }
  return {
    mode: 'rail',
    current,
    steps: labels.map((label, i) => ({
      label,
      state: i < current ? 'done' : i === current ? 'current' : 'todo'
    }))
  }
}

function mapMineItem(order, role) {
  const meta = order.giftMeta || {}
  const deliveryType = meta.deliveryType || 'invite_address'
  const progress = classifyMineProgress(order, role)
  const hidePrice = role === 'receiver' ? meta.hidePrice !== false : false
  const products = buildProductSnapshot(order.products || [], { hidePrice })
  const title = (products[0] && products[0].title) || '礼赠标本'
  const shareToken = meta.shareToken || ''
  const expire = buildExpireHint(meta, progress)
  const actions = buildMineActions(order, role, progress)
  const voiceDuration = Math.min(60, Math.max(0, parseInt(meta.voiceDuration, 10) || 0))
  const hasVoice = !!(meta.voiceFileID && voiceDuration > 0)

  let deepLink = `/subpackages/business/order-detail/index?id=${order._id}`
  if (role === 'giver') {
    if (
      progress.key === 'awaiting_open' ||
      progress.key === 'awaiting_address' ||
      (deliveryType === 'store_pickup' && progress.key === 'pickup_verify')
    ) {
      deepLink = `/subpackages/feature/gift/success/index?orderId=${order._id}`
    }
  } else if (role === 'receiver') {
    if (progress.key === 'awaiting_open') {
      deepLink = `/subpackages/feature/gift/receive/index?orderId=${order._id}&token=${encodeURIComponent(shareToken)}`
    } else if (progress.key === 'awaiting_address') {
      deepLink = `/subpackages/feature/gift/address/index?orderId=${order._id}&token=${encodeURIComponent(shareToken)}`
    } else if (progress.key === 'pickup_verify' && shareToken) {
      deepLink = `/subpackages/feature/gift/receive/index?orderId=${order._id}&token=${encodeURIComponent(shareToken)}`
    } else if (shareToken && (progress.key === 'awaiting_ship' || progress.segment === 'shipping')) {
      // 收礼侧履约中：优先订单物流
      deepLink = `/subpackages/business/order-detail/index?id=${order._id}`
    }
  }

  const primary = actions[0] || null
  const secondary = actions[1] || null

  const roleLabel = role === 'receiver' ? '收到' : '送出'
  const progressSteps = buildMineProgressSteps(deliveryType, progress.key)

  return {
    orderId: order._id,
    orderNo: order.orderNo || '',
    status: order.status,
    role,
    roleLabel,
    progressKey: progress.key,
    progressLabel: progress.label,
    progressSteps,
    segment: progress.segment || 'fulfillment',
    todo: !!progress.todo,
    attention: !!progress.attention,
    todoKind: progress.todoKind || '',
    lamp: lampForProgress(progress, expire.expireUrgent),
    deliveryType,
    deliveryLabel: DELIVERY_LABELS[deliveryType] || deliveryType,
    productTitle: title,
    productImage: (products[0] && products[0].image) || '',
    cardSnippet: snippetCardBody(meta.cardBody),
    hasVoice,
    voiceDuration,
    recipientName: meta.recipientName || meta.salutation || '',
    storeName: meta.storeName || '',
    shareToken,
    expireAt: meta.expireAt || null,
    expireText: formatBoardTime(meta.expireAt),
    expireHint: expire.expireHint,
    expireUrgent: !!expire.expireUrgent,
    expireDaysLeft: expire.expireDaysLeft,
    paidTime: order.paidTime || null,
    paidText: formatBoardTime(order.paidTime || order.createTime),
    totalPrice: role === 'giver' ? order.totalPrice : undefined,
    deepLink,
    primaryAction: primary,
    secondaryAction: secondary,
    actions
  }
}

function isMineTodo(order, role) {
  const p = classifyMineProgress(order, role)
  return !!p.todo
}

function isMineAttention(order, role) {
  const p = classifyMineProgress(order, role)
  return !!p.attention
}

function mineSortWeight(order, role) {
  const p = classifyMineProgress(order, role)
  // 本人待办 > 需关注（待 TA）> 履约中 > 已完成
  if (p.todo) return 0
  if (p.attention) return 1
  if (p.segment === 'done') return 3
  return 2
}

function sortMineOrders(rows, role) {
  return (rows || []).slice().sort((a, b) => {
    const wa = mineSortWeight(a, role)
    const wb = mineSortWeight(b, role)
    if (wa !== wb) return wa - wb
    const ta = new Date(a.paidTime || a.createTime || 0).getTime()
    const tb = new Date(b.paidTime || b.createTime || 0).getTime()
    return tb - ta
  })
}

async function queryGiftOrdersByWhere(where, limit) {
  const size = Math.min(80, Math.max(1, limit || 40))
  try {
    const res = await db.collection('orders')
      .where(where)
      .orderBy('paidTime', 'desc')
      .limit(size)
      .get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db.collection('orders').where(where).limit(size).get()
      const rows = res.data || []
      rows.sort((a, b) => {
        const ta = new Date(a.paidTime || a.createTime || 0).getTime()
        const tb = new Date(b.paidTime || b.createTime || 0).getTime()
        return tb - ta
      })
      return rows
    } catch (e2) {
      console.warn('queryGiftOrdersByWhere', e2 && e2.message)
      return []
    }
  }
}

function emptySegmentCounts(tab) {
  if (tab === 'received') {
    return {
      all: 0,
      awaiting_open: 0,
      awaiting_address: 0,
      shipping: 0,
      done: 0
    }
  }
  return {
    all: 0,
    awaiting_open: 0,
    awaiting_address: 0,
    fulfillment: 0,
    done: 0
  }
}

/**
 * C 端「我的订单」合并用：当前用户作为礼赠受礼人已绑定的订单（完整文档）
 * 仅返回 giftMeta.receiverOpenid === openid，且排除本人送出
 */
/**
 * 绑定受赠人（receiverOpenid）
 *
 * 背景：acceptGift 只对 `invite_address`（填址礼赠）放行，因此门店自提 / 直接寄送
 * 的礼赠**永远不会写入 receiverOpenid** → 受赠人「我收到的」永远为空，
 * 受赠人侧的自提分支与通知也不可达。
 *
 * 这里对所有礼赠交付方式开放绑定，凭证仍为分享令牌（shareToken），
 * 且幂等（已绑定给本人则直接成功；已绑定他人则拒绝）。
 */
async function bindReceiver(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  const token = String(event.token || '').trim()
  let order = token ? await findOrderByToken(token) : null
  if (!order && event.orderId) order = await loadOrder(event.orderId)
  if (!order || !isGiftOrder(order)) return { success: false, msg: '礼赠不存在' }

  const meta = order.giftMeta || {}
  const giver = order._openid || order.openid
  if (openid === giver) return { success: false, msg: '不能把自己送出的礼赠记为自己收到的' }

  // 已绑定
  if (meta.receiverOpenid) {
    if (meta.receiverOpenid === openid) return { success: true, already: true, orderId: order._id }
    return { success: false, code: 'ALREADY_BOUND', msg: '这份礼赠已由其他人领取' }
  }

  // 凭证：必须持有分享令牌（自提请从分享礼笺进入）
  const shareToken = String(meta.shareToken || '').trim()
  if (!shareToken || token !== shareToken) {
    return { success: false, code: 'BAD_TOKEN', msg: '请从分享礼笺进入后再领取' }
  }
  if (["refunded", "void", "cancelled"].includes(String(order.status || ""))) {
    return { success: false, code: 'CLOSED', msg: '该礼赠已关闭' }
  }

  try {
    await db.collection("orders").doc(order._id).update({
      data: {
        "giftMeta.receiverOpenid": openid,
        "giftMeta.receiverBoundAt": db.serverDate(),
        "giftMeta.receiverBoundSource": String(event.source || "share_link").slice(0, 32)
      }
    })
  } catch (e) {
    console.error("bindReceiver update", e)
    return { success: false, msg: "绑定失败，请稍后重试" }
  }
  return { success: true, orderId: order._id, bound: true }
}

async function listReceivedOrders(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }

  const receivedRaw = await queryGiftOrdersByWhere(
    { 'giftMeta.receiverOpenid': openid },
    80
  )
  const list = (receivedRaw || []).filter((o) => {
    if (!o || !o._id || !isGiftOrder(o)) return false
    const giver = o._openid || o.openid
    return giver !== openid
  })
  await healSubmittedStillAwaiting(list)
  return { success: true, list }
}

/**
 * C 端「我的礼赠」：我送出的 / 我收到的 + 分段筛选 + 待办置顶
 */
async function listMine(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  const tab = event.tab === 'received' ? 'received' : 'sent'
  const pageSize = Math.min(40, Math.max(1, parseInt(event.pageSize, 10) || 20))
  const page = Math.max(1, parseInt(event.page, 10) || 1)
  const allowedSegments =
    tab === 'received'
      ? { all: 1, awaiting_open: 1, awaiting_address: 1, shipping: 1, done: 1 }
      : { all: 1, awaiting_open: 1, awaiting_address: 1, fulfillment: 1, done: 1 }
  const segment = allowedSegments[event.segment] ? event.segment : 'all'

  const sentRaw = await queryGiftOrdersByWhere(
    _.or([
      { _openid: openid, source: 'gift' },
      { openid, source: 'gift' }
    ]),
    80
  )
  const receivedRaw = await queryGiftOrdersByWhere(
    { 'giftMeta.receiverOpenid': openid },
    80
  )

  const sentMap = {}
  sentRaw.forEach((o) => {
    if (!o || !o._id || !isGiftOrder(o)) return
    sentMap[o._id] = o
  })
  const sentList = Object.keys(sentMap).map((id) => sentMap[id])

  const receivedList = (receivedRaw || []).filter((o) => {
    if (!o || !isGiftOrder(o)) return false
    const giver = o._openid || o.openid
    return giver !== openid
  })

  await healSubmittedStillAwaiting(sentList.concat(receivedList))

  let todoCount = 0
  let attentionCount = 0
  sentList.forEach((o) => {
    if (isMineTodo(o, 'giver')) todoCount += 1
    else if (isMineAttention(o, 'giver')) attentionCount += 1
  })
  receivedList.forEach((o) => {
    if (isMineTodo(o, 'receiver')) todoCount += 1
    else if (isMineAttention(o, 'receiver')) attentionCount += 1
  })

  const role = tab === 'received' ? 'receiver' : 'giver'
  const sourceAll = sortMineOrders(tab === 'received' ? receivedList : sentList, role)

  /** 对象页「查看往来」：按收礼称呼筛选（仅送出侧） */
  const recipientFilter = sanitizeName(event.recipientName || event.contactName || '')
  let scopedAll = sourceAll
  if (recipientFilter && tab === 'sent') {
    scopedAll = sourceAll.filter((o) => {
      const meta = (o && o.giftMeta) || {}
      const n = sanitizeName(meta.recipientName || meta.salutation || '')
      if (!n) return false
      return n === recipientFilter || n.indexOf(recipientFilter) !== -1 || recipientFilter.indexOf(n) !== -1
    })
  }

  const segmentCounts = emptySegmentCounts(tab)
  segmentCounts.all = scopedAll.length
  scopedAll.forEach((o) => {
    const seg = classifyMineProgress(o, role).segment
    if (segmentCounts[seg] != null) segmentCounts[seg] += 1
  })

  const filtered =
    segment === 'all'
      ? scopedAll
      : scopedAll.filter((o) => classifyMineProgress(o, role).segment === segment)

  const total = filtered.length
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)
  const list = slice.map((o) => mapMineItem(o, role))

  let upcomingDateCount = 0
  try {
    const datesRes = await db.collection(GIFT_DATES_COL)
      .where({ _openid: openid })
      .limit(100)
      .get()
    upcomingDateCount = (datesRes.data || []).filter((d) => {
      const next = computeNextOccurrence(d.month, d.day)
      return next && next.daysUntil >= 0 && next.daysUntil <= 7
    }).length
  } catch (e) {
    upcomingDateCount = 0
  }

  return {
    success: true,
    tab,
    segment,
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
    todoCount,
    attentionCount,
    upcomingDateCount,
    badgeCount: todoCount + attentionCount + upcomingDateCount,
    recipientFilter: recipientFilter || '',
    counts: {
      sent: sentList.length,
      received: receivedList.length
    },
    segmentCounts,
    list
  }
}

const GIFT_CONTACTS_COL = 'gift_contacts'
const GIFT_DATES_COL = 'gift_dates'

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist|集合不存在|Db or Table not exist/i.test(
    errorText(err)
  )
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureGiftCollection(name) {
  try {
    await db.createCollection(name)
    console.log('created collection', name)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function withGiftCollectionRetry(collectionName, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureGiftCollection(collectionName)
    return await fn()
  }
}

const RELATION_OPTIONS = {
  lover: { label: '爱人', sceneKey: 'anniversary' },
  parent: { label: '父母', sceneKey: 'gratitude' },
  child: { label: '子女', sceneKey: 'birthday' },
  friend: { label: '友人', sceneKey: 'birthday' },
  colleague: { label: '同事', sceneKey: 'gratitude' },
  mentor: { label: '师长', sceneKey: 'gratitude' },
  other: { label: '其他', sceneKey: 'gratitude' }
}

/** 人情账本日子类型（8–12 项；sceneKey 对齐礼赠场景枚举） */
const DATE_TYPES = {
  birthday: { label: '生日', sceneKey: 'birthday', requireYear: false },
  anniversary: { label: '纪念日', sceneKey: 'anniversary', requireYear: true },
  wedding: { label: '结婚纪念', sceneKey: 'wedding', requireYear: true },
  housewarming: { label: '乔迁', sceneKey: 'housewarming', requireYear: false },
  enrollment: { label: '升学', sceneKey: 'enrollment', requireYear: false },
  graduation: { label: '毕业', sceneKey: 'graduation', requireYear: false },
  new_job: { label: '入职', sceneKey: 'new_job', requireYear: false },
  newborn: { label: '新生儿', sceneKey: 'gratitude', requireYear: false },
  festival: { label: '节日', sceneKey: 'gratitude', requireYear: false },
  custom: { label: '自定义', sceneKey: 'gratitude', requireYear: false }
}

function sanitizeDateType(raw) {
  const key = String(raw || '').trim()
  return DATE_TYPES[key] ? key : 'birthday'
}

function dateTypeRequiresYear(type) {
  const meta = DATE_TYPES[sanitizeDateType(type)]
  return !!(meta && meta.requireYear)
}

function defaultDateTitle(type, contactName) {
  const key = sanitizeDateType(type)
  const label = DATE_TYPES[key].label
  const name = sanitizeName(contactName)
  if (key === 'birthday') return name ? `${name}的生日` : '生日'
  if (key === 'custom') return name ? `${name}的日子` : '自定义日子'
  if (key === 'festival') return name ? `${name}·节日` : '节日'
  return name ? `${name}·${label}` : label
}

function sanitizeName(raw, max = 40) {
  return String(raw || '').trim().slice(0, max)
}

function sanitizeRelation(raw) {
  const key = String(raw || '').trim()
  return RELATION_OPTIONS[key] ? key : 'other'
}

function sanitizeSceneKey(raw) {
  const key = String(raw || '').trim().toLowerCase()
  const allowed = {
    housewarming: 1,
    wedding: 1,
    birthday: 1,
    anniversary: 1,
    enrollment: 1,
    graduation: 1,
    new_job: 1,
    gratitude: 1
  }
  return allowed[key] ? key : ''
}

function parseMonthDay(month, day) {
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  if (!Number.isFinite(m) || m < 1 || m > 12) return null
  if (!Number.isFinite(d) || d < 1 || d > 31) return null
  // 粗校验：2 月最多 29
  if (m === 2 && d > 29) return null
  if ([4, 6, 9, 11].indexOf(m) !== -1 && d > 30) return null
  return { month: m, day: d }
}

function computeNextOccurrence(month, day, fromDate) {
  const parsed = parseMonthDay(month, day)
  if (!parsed) return null
  const base = fromDate instanceof Date ? fromDate : new Date()
  const y = base.getFullYear()
  const candidate = new Date(y, parsed.month - 1, parsed.day, 0, 0, 0, 0)
  const today = new Date(y, base.getMonth(), base.getDate(), 0, 0, 0, 0)
  let next = candidate
  if (candidate.getTime() < today.getTime()) {
    next = new Date(y + 1, parsed.month - 1, parsed.day, 0, 0, 0, 0)
  }
  const daysUntil = Math.round((next.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  return {
    nextAt: next.toISOString(),
    nextLabel: `${next.getMonth() + 1}月${next.getDate()}日`,
    daysUntil
  }
}

function mapContactDoc(doc, giftCountMap) {
  const relation = sanitizeRelation(doc.relation)
  const rel = RELATION_OPTIONS[relation]
  const sceneKey = sanitizeSceneKey(doc.sceneKey) || rel.sceneKey
  const name = sanitizeName(doc.name)
  return {
    id: doc._id,
    name,
    relation,
    relationLabel: rel.label,
    note: String(doc.note || '').trim().slice(0, 120),
    sceneKey,
    giftCount: (giftCountMap && giftCountMap[name]) || Number(doc.giftCount) || 0,
    updatedAt: doc.updatedAt || null
  }
}

function mapDateDoc(doc, contactNameMap) {
  const type = sanitizeDateType(doc.type)
  const typeMeta = DATE_TYPES[type]
  const md = parseMonthDay(doc.month, doc.day)
  const next = md ? computeNextOccurrence(md.month, md.day) : null
  const contactId = String(doc.contactId || '').trim()
  const contactName =
    sanitizeName(doc.contactName) ||
    (contactId && contactNameMap && contactNameMap[contactId]) ||
    ''
  const title = sanitizeName(doc.title, 40) || defaultDateTitle(type, contactName)
  const yearRaw = parseInt(doc.year, 10)
  const year = Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? yearRaw : null
  const daysUntil = next ? next.daysUntil : null
  let urgency = 'idle'
  if (daysUntil != null && daysUntil >= 0) {
    if (daysUntil <= 7) urgency = 'hot'
    else if (daysUntil <= 30) urgency = 'near'
  }
  let dateLabel = ''
  if (md) {
    dateLabel = year
      ? `${year}年${md.month}月${md.day}日`
      : `${md.month}月${md.day}日`
  }
  return {
    id: doc._id,
    type,
    typeLabel: typeMeta.label,
    requireYear: !!typeMeta.requireYear,
    title,
    contactId,
    contactName,
    month: md ? md.month : 0,
    day: md ? md.day : 0,
    year,
    dateLabel,
    nextAt: next && next.nextAt,
    nextLabel: next && next.nextLabel,
    daysUntil,
    urgency,
    sceneKey: sanitizeSceneKey(doc.sceneKey) || typeMeta.sceneKey,
    remindDays: Math.min(30, Math.max(1, parseInt(doc.remindDays, 10) || 7))
  }
}

async function countGiftsByRecipient(openid, names) {
  const map = {}
  ;(names || []).forEach((n) => {
    if (n) map[n] = 0
  })
  if (!openid || !names || !names.length) return map
  try {
    const res = await db.collection('orders')
      .where({
        _openid: openid,
        source: 'gift'
      })
      .limit(80)
      .get()
    ;(res.data || []).forEach((o) => {
      if (!isGiftOrder(o)) return
      const n = sanitizeName((o.giftMeta && (o.giftMeta.recipientName || o.giftMeta.salutation)) || '')
      if (n && map[n] != null) map[n] += 1
    })
  } catch (e) {
    console.warn('countGiftsByRecipient', e && e.message)
  }
  return map
}

async function listContacts(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  let rows = []
  try {
    const res = await db.collection(GIFT_CONTACTS_COL)
      .where({ _openid: openid })
      .orderBy('updatedAt', 'desc')
      .limit(80)
      .get()
    rows = res.data || []
  } catch (e) {
    try {
      const res = await db.collection(GIFT_CONTACTS_COL).where({ _openid: openid }).limit(80).get()
      rows = res.data || []
      rows.sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return tb - ta
      })
    } catch (e2) {
      console.warn('listContacts', e2 && e2.message)
      rows = []
    }
  }

  const names = rows.map((r) => sanitizeName(r.name)).filter(Boolean)
  const giftCountMap = await countGiftsByRecipient(openid, names)
  const list = rows.map((r) => mapContactDoc(r, giftCountMap))

  return {
    success: true,
    list,
    relations: Object.keys(RELATION_OPTIONS).map((k) => ({
      key: k,
      label: RELATION_OPTIONS[k].label,
      sceneKey: RELATION_OPTIONS[k].sceneKey
    })),
    total: list.length
  }
}

async function saveContact(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  const id = String((event && event.id) || '').trim()
  const name = sanitizeName(event && event.name)
  if (!name) return { success: false, msg: '请填写称呼' }

  const relation = sanitizeRelation(event && event.relation)
  const rel = RELATION_OPTIONS[relation]
  const sceneKey = sanitizeSceneKey(event && event.sceneKey) || rel.sceneKey
  const note = String((event && event.note) || '').trim().slice(0, 120)
  const now = db.serverDate()
  const payload = {
    name,
    relation,
    sceneKey,
    note,
    updatedAt: now
  }

  try {
    if (id) {
      return await withGiftCollectionRetry(GIFT_CONTACTS_COL, async () => {
        const doc = await db.collection(GIFT_CONTACTS_COL).doc(id).get()
        const row = doc.data
        if (!row || row._openid !== openid) {
          return { success: false, code: 'FORBIDDEN', msg: '无权修改' }
        }
        await db.collection(GIFT_CONTACTS_COL).doc(id).update({ data: payload })
        return { success: true, id, msg: '已记下这位友人' }
      })
    }

    const addRes = await withGiftCollectionRetry(GIFT_CONTACTS_COL, () =>
      db.collection(GIFT_CONTACTS_COL).add({
        data: {
          ...payload,
          _openid: openid,
          giftCount: 0,
          createdAt: now
        }
      })
    )
    return { success: true, id: addRes._id, msg: '已加入馈赠名单' }
  } catch (e) {
    console.error('saveContact', e)
    if (isMissingCollectionError(e)) {
      return { success: false, code: 'DB_SETUP', msg: '名册尚未备妥，请稍后再试' }
    }
    return { success: false, code: 'DB_ERROR', msg: '此刻未能保存，请稍后再试' }
  }
}

async function deleteContact(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }
  const id = String((event && event.id) || '').trim()
  if (!id) return { success: false, msg: '缺少对象' }
  try {
    const doc = await db.collection(GIFT_CONTACTS_COL).doc(id).get()
    const row = doc.data
    if (!row || row._openid !== openid) {
      return { success: false, code: 'FORBIDDEN', msg: '无权删除' }
    }
    await db.collection(GIFT_CONTACTS_COL).doc(id).remove()
    // 解绑日子上的 contactId（保留日子本身）
    try {
      const dates = await db.collection(GIFT_DATES_COL)
        .where({ _openid: openid, contactId: id })
        .limit(40)
        .get()
      for (const d of dates.data || []) {
        await db.collection(GIFT_DATES_COL).doc(d._id).update({
          data: { contactId: '', updatedAt: db.serverDate() }
        })
      }
    } catch (e2) {
      console.warn('unlink dates', e2 && e2.message)
    }
    return { success: true, msg: '已从名单移出' }
  } catch (e) {
    return { success: false, msg: '此刻未能删除' }
  }
}

async function listDates(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, msg: '请先登录' }

  let rows = []
  try {
    const res = await db.collection(GIFT_DATES_COL)
      .where({ _openid: openid })
      .limit(100)
      .get()
    rows = res.data || []
  } catch (e) {
    console.warn('listDates', e && e.message)
    rows = []
  }

  let contacts = []
  try {
    const cres = await db.collection(GIFT_CONTACTS_COL).where({ _openid: openid }).limit(80).get()
    contacts = cres.data || []
  } catch (e) {
    contacts = []
  }
  const contactNameMap = {}
  contacts.forEach((c) => {
    contactNameMap[c._id] = sanitizeName(c.name)
  })

  const list = rows
    .map((r) => mapDateDoc(r, contactNameMap))
    .filter((d) => d.month && d.day)
    .sort((a, b) => {
      const ua = a.urgency === 'hot' ? 0 : a.urgency === 'near' ? 1 : 2
      const ub = b.urgency === 'hot' ? 0 : b.urgency === 'near' ? 1 : 2
      if (ua !== ub) return ua - ub
      const da = a.daysUntil == null ? 999 : a.daysUntil
      const dbv = b.daysUntil == null ? 999 : b.daysUntil
      return da - dbv
    })

  const upcoming = list.filter((d) => d.daysUntil != null && d.daysUntil >= 0 && d.daysUntil <= 30)
  const upcomingHot = list.filter((d) => d.daysUntil != null && d.daysUntil >= 0 && d.daysUntil <= 7)

  return {
    success: true,
    list,
    upcoming,
    upcomingHotCount: upcomingHot.length,
    upcomingCount: upcoming.length,
    total: list.length,
    dateTypes: Object.keys(DATE_TYPES).map((k) => ({
      key: k,
      label: DATE_TYPES[k].label,
      sceneKey: DATE_TYPES[k].sceneKey,
      requireYear: !!DATE_TYPES[k].requireYear
    })),
    contacts: contacts.map((c) => ({
      id: c._id,
      name: sanitizeName(c.name),
      relation: sanitizeRelation(c.relation)
    }))
  }
}

async function saveDate(event, openid) {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  if (!openid) return { success: false, code: 'NEED_LOGIN', msg: '请先登录' }

  const id = String((event && event.id) || '').trim()
  const type = sanitizeDateType(event && event.type)
  const md = parseMonthDay(event && event.month, event && event.day)
  if (!md) return { success: false, code: 'NEED_DATE', msg: '请选择日期' }

  const yearRaw = parseInt(event && event.year, 10)
  const year = Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? yearRaw : null
  // 纪念日 / 结婚纪念：完整年月日；其余可仅月日循环，年份可选
  if (dateTypeRequiresYear(type) && !year) {
    return {
      success: false,
      code: 'NEED_YEAR',
      msg: `${DATE_TYPES[type].label}请选择完整年月日`
    }
  }

  let contactId = String((event && event.contactId) || '').trim()
  let contactName = sanitizeName(event && event.contactName)
  if (contactId) {
    try {
      const cdoc = await db.collection(GIFT_CONTACTS_COL).doc(contactId).get()
      const crow = cdoc.data
      if (!crow || crow._openid !== openid) {
        contactId = ''
      } else {
        contactName = sanitizeName(crow.name) || contactName
      }
    } catch (e) {
      contactId = ''
    }
  }

  const title = sanitizeName(event && event.title, 40)
  const sceneKey = sanitizeSceneKey(event && event.sceneKey) || DATE_TYPES[type].sceneKey
  const remindDays = Math.min(30, Math.max(1, parseInt(event && event.remindDays, 10) || 7))
  const now = db.serverDate()
  const payload = {
    type,
    title,
    contactId,
    contactName,
    month: md.month,
    day: md.day,
    sceneKey,
    remindDays,
    updatedAt: now
  }
  // 勿写 null：部分云库对 null 字段敏感；清空用 remove
  if (year != null) payload.year = year
  else if (id) payload.year = _.remove()

  try {
    if (id) {
      return await withGiftCollectionRetry(GIFT_DATES_COL, async () => {
        const doc = await db.collection(GIFT_DATES_COL).doc(id).get()
        const row = doc.data
        if (!row || row._openid !== openid) {
          return { success: false, code: 'FORBIDDEN', msg: '无权修改' }
        }
        await db.collection(GIFT_DATES_COL).doc(id).update({ data: payload })
        return { success: true, id, msg: '日子已更新' }
      })
    }
    const addRes = await withGiftCollectionRetry(GIFT_DATES_COL, () =>
      db.collection(GIFT_DATES_COL).add({
        data: {
          ...payload,
          _openid: openid,
          createdAt: now
        }
      })
    )
    return { success: true, id: addRes._id, msg: '日子已记下' }
  } catch (e) {
    console.error('saveDate', e)
    const raw = errorText(e)
    if (isMissingCollectionError(e)) {
      return { success: false, code: 'DB_SETUP', msg: '日子账本尚未备妥，请稍后再试' }
    }
    if (/permission|权限|SECURITY|access denied/i.test(raw)) {
      return { success: false, code: 'DB_PERM', msg: '日子账本权限未就绪' }
    }
    return { success: false, code: 'DB_ERROR', msg: '此刻未能保存，请稍后再试' }
  }
}

async function deleteDate(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }
  const id = String((event && event.id) || '').trim()
  if (!id) return { success: false, msg: '缺少日子' }
  try {
    const doc = await db.collection(GIFT_DATES_COL).doc(id).get()
    const row = doc.data
    if (!row || row._openid !== openid) {
      return { success: false, code: 'FORBIDDEN', msg: '无权删除' }
    }
    await db.collection(GIFT_DATES_COL).doc(id).remove()
    return { success: true, msg: '已移除' }
  } catch (e) {
    return { success: false, msg: '此刻未能删除' }
  }
}

function startOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function toMs(v) {
  if (!v) return 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

async function sampleRecentGiftOrders(limit) {
  const n = Math.min(200, Math.max(20, parseInt(limit, 10) || 200))
  try {
    const res = await db.collection('orders')
      .where({ source: 'gift' })
      .orderBy('paidTime', 'desc')
      .limit(n)
      .get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db.collection('orders')
        .where({
          status: _.in([
            'paid_awaiting_address',
            'paid',
            'shipped',
            'ready_pickup',
            'received',
            'refunded',
            'expired_refunding'
          ])
        })
        .limit(n)
        .get()
      return (res.data || []).filter((o) => isGiftOrder(o))
    } catch (e2) {
      console.warn('sampleRecentGiftOrders', e2)
      return []
    }
  }
}

function buildGiftStatsFromSample(sample) {
  const counts = {
    awaiting_address: 0,
    awaiting_ship: 0,
    pickup_verify: 0,
    done: 0
  }
  ;(sample || []).forEach((o) => {
    const b = classifyGiftBoardBucket(o)
    if (b && counts[b] != null) counts[b] += 1
  })
  const todoTotal =
    counts.awaiting_address + counts.awaiting_ship + counts.pickup_verify

  const todayStart = startOfLocalDay(new Date()).getTime()
  const last7Start = todayStart - 6 * 24 * 60 * 60 * 1000
  let todayCount = 0
  let last7Count = 0
  ;(sample || []).forEach((o) => {
    const t = toMs(o.paidTime) || toMs(o.createTime) || toMs(o._createTime)
    if (!t) return
    if (t >= todayStart) todayCount += 1
    if (t >= last7Start) last7Count += 1
  })

  let todoLamp = 'success'
  if (todoTotal >= 10) todoLamp = 'warn'
  else if (todoTotal > 0) todoLamp = 'brass'

  return {
    todayCount,
    last7Count,
    todos: {
      awaiting_address: counts.awaiting_address,
      awaiting_ship: counts.awaiting_ship,
      pickup_verify: counts.pickup_verify
    },
    done: counts.done,
    todoTotal,
    todoLamp,
    note: (sample || []).length >= 200 ? '统计基于最近约 200 笔礼赠单' : ''
  }
}

/**
 * 店长/超管：礼赠管理总览（配置 + 简易数据 + 订阅状态）
 */
async function getSettings(event, openid) {
  if (!openid && !(event && event.adminOpsKey)) {
    return {
      success: false,
      code: 'NEED_LOGIN',
      msg: '请先登录（小程序）或通过 Admin 云函数代理配置 ADMIN_OPS_KEY'
    }
  }
  const guard = await assertStaff(db, openid, {
    role: 'manager',
    permission: 'giftOps',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无操作权限' }
  }

  const loaded = await loadGiftSettings(db)
  const settings = loaded.settings
  const showGift = await isGiftFeatureEnabled()
  const subscribe = buildSubscribeStatus()
  const sample = await sampleRecentGiftOrders(200)
  const stats = buildGiftStatsFromSample(sample)
  const actor = guard.actor || {}
  const canEdit = !!(
    actor.superAdmin ||
    actor.workspaceRole === 'super_admin' ||
    (actor.roles || []).indexOf('super_admin') !== -1 ||
    (actor.permissions || []).indexOf('manageGift') !== -1
  )

  return {
    success: true,
    settings,
    docId: loaded.docId,
    fromDefault: loaded.fromDefault,
    ruleText: describeSettings(settings),
    nudgeRuleSummary: nudgeRuleSummary(settings),
    timeoutOptions: TIMEOUT_OPTIONS.slice(),
    deliveryOptions: Object.keys(SETTINGS_DELIVERY_LABELS).map((key) => ({
      key,
      label: SETTINGS_DELIVERY_LABELS[key]
    })),
    showGift,
    contentFlagsHint: showGift
      ? '礼赠入口已对顾客展示；关闭后相关入口会隐藏'
      : '礼赠入口当前隐藏；请到超管工作台「内容开关」开启后再面向顾客',
    subscribe,
    stats,
    canEdit
  }
}

/**
 * 仅超管：保存礼赠运营配置
 */
async function saveSettings(event, openid) {
  if (!openid && !(event && event.adminOpsKey)) {
    return {
      success: false,
      code: 'NEED_LOGIN',
      msg: '请先登录（小程序）或通过 Admin 云函数代理配置 ADMIN_OPS_KEY'
    }
  }
  const guard = await assertStaff(db, openid, {
    role: 'manager',
    permission: 'manageGift',
    requireSuperAdmin: true,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '仅超管可改配置' }
  }

  const incoming = (event && event.settings) || (event && event.config) || {}
  const settings = normalizeSettings(incoming)
  const nowMs = Date.now()
  const payload = {
    key: GIFT_SETTINGS_KEY,
    ...settings,
    updatedAt: db.serverDate(),
    updatedAtMs: nowMs,
    updatedBy: openid
  }

  let docId = String((event && event.docId) || '').trim()
  try {
    if (!docId) {
      const existing = await loadSettingsDoc(db)
      if (existing && existing._id) docId = existing._id
    }
    if (docId) {
      await db.collection(GIFT_SETTINGS_COL).doc(docId).update({ data: payload })
    } else {
      const addRes = await db.collection(GIFT_SETTINGS_COL).add({
        data: {
          ...payload,
          createdAt: db.serverDate(),
          createdAtMs: nowMs
        }
      })
      docId = addRes._id
    }
  } catch (e) {
    console.error('saveSettings', e)
    const raw = String((e && (e.message || e.errMsg)) || '')
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(raw)) {
      return {
        success: false,
        code: 'COLLECTION_MISSING',
        msg: '请先在云开发创建集合 gift_settings'
      }
    }
    return { success: false, msg: '保存失败，请稍后再试' }
  }

  return {
    success: true,
    docId,
    settings,
    fromDefault: false,
    ruleText: describeSettings(settings),
    nudgeRuleSummary: nudgeRuleSummary(settings),
    msg: '已保存'
  }
}

/**
 * C 端公开默认（编排页 / 下单前）；无礼赠开关则拒绝
 */
async function getPublicDefaults() {
  const enabled = await isGiftFeatureEnabled()
  if (!enabled) {
    return { success: false, code: 'GIFT_CLOSED', msg: '礼赠暂未开放' }
  }
  const loaded = await loadGiftSettings(db)
  return {
    success: true,
    addressFillTimeoutDays: loaded.settings.addressFillTimeoutDays,
    defaultDeliveryType: loaded.settings.defaultDeliveryType,
    allowHidePriceToggle: loaded.settings.allowHidePriceToggle
  }
}

/**
 * 来源判定统一真源（见 sourceOrigin.js 顶部事故说明）。
 *
 * 历史教训：此处原为负向子串判定 `!/wx_client|wx_devtools/i.test(SOURCE)`，
 * 对云函数互调继承而来的合并串（如 "wx_client,scf"）会判反 —— 与同仓
 * `isInternalSource` 的分段判定互相矛盾。
 *
 * 注意：绝不能再用 `event.Type === 'Timer'` 或 `event.TriggerName` 作为授权依据
 * —— 这些字段由调用方完全控制。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  // 定时触发器：Type === TimerTrigger / timer（仅用于决定默认 action，不用于鉴权）
  const triggerType = String((event && (event.Type || event.type)) || '')
  const isTimer = /timer/i.test(triggerType) || !!(event && event.TriggerName)
  const trustedInternal = isNonClientSource()

  let action = (event && event.action) || 'getShare'
  if (isTimer) {
    action = 'dailySweep'
    // 安全：不再把真实内部密钥回填进 event —— 否则调用方只要伪造 Type='Timer'
    // 就能拿到密钥，进而绕过所有内部鉴权（曾可触发全站礼赠过期退款）
  }

  try {
    if (action === 'getShare') return await getShare(event, openid)
    if (action === 'getGiverShare') return await getGiverShare(event, openid)
    if (action === 'getGiftVoice') return await getGiftVoice(event, openid)
    if (action === 'accept') return await acceptGift(event, openid)
    if (action === 'bindReceiver') return await bindReceiver(event, openid)
    if (action === 'submitAddress') return await submitAddress(event, openid)
    if (action === 'nudge') return await nudge(event, openid)
    if (action === 'verifyPickup') return await verifyPickup(event, openid)
    if (action === 'listBoard') return await listBoard(event, openid)
    if (action === 'getBoardDetail') return await getBoardDetail(event, openid)
    if (action === 'getSettings') return await getSettings(event, openid)
    if (action === 'saveSettings') return await saveSettings(event, openid)
    if (action === 'getPublicDefaults') return await getPublicDefaults()
    if (action === 'listMine') return await listMine(event, openid)
    if (action === 'listReceivedOrders') return await listReceivedOrders(event, openid)
    if (action === 'listContacts') return await listContacts(event, openid)
    if (action === 'saveContact') return await saveContact(event, openid)
    if (action === 'deleteContact') return await deleteContact(event, openid)
    if (action === 'listDates') return await listDates(event, openid)
    if (action === 'saveDate') return await saveDate(event, openid)
    if (action === 'deleteDate') return await deleteDate(event, openid)
    if (action === 'expireSweep') return await expireSweep(event, openid)
    if (action === 'nudgeSweep') return await nudgeSweep(event, openid)
    if (action === 'dailySweep') return await dailySweep(event, openid)
    return { success: false, msg: '未知操作' }
  } catch (e) {
    console.error('manageGift', e)
    const raw = String((e && (e.message || e.errMsg)) || '')
    // 勿把云库原文抛给 C 端
    if (/502001|database request|permission|DOCUMENT/i.test(raw)) {
      return { success: false, code: 'DB_ERROR', msg: '此刻未能完成，请稍后再试' }
    }
    return { success: false, msg: '礼赠操作失败，请稍后再试' }
  }
}

