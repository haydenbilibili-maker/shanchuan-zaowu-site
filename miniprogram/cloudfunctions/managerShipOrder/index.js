const cloud = require('wx-server-sdk')
const { dispatchInAppMessage, normalizeOrderNote, renderMiniMessage, NOTE_MAX } = require('./messageWrite')
const {
  resolveDeliveryId,
  looksLikePlaceholderTracking,
  syncWxExpress,
  logisticsPatchFromSync,
  probeAccessToken,
  queryWaybillTrace,
  isWaybillDelivered,
  waybillStatusLabel
} = require('./wxExpress')
const {
  assertStaff,
  ROLE_MANAGER,
  ROLE_STAFF,
  hasRole,
  canOperateStore,
  STORED_ROLE_SUPER,
  STORED_ROLE_SPECIMEN_ARTISAN
} = require('./staffGuard')
const { isUserAdmin } = require('./payConfig')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const {
  ACTION,
  resolveApproverRole,
  actorWorkspaceRole,
  isSensitiveShip
} = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
const { needsAddressBeforeShip, isGiftOrder } = require('./giftMeta')
const { isNonClientSource, isClientSource, isInternalSource, sourceSegments, describeSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()


async function grantPickupPoints(orderId) {
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
async function markPickupOrderPointsGranted(orderId, points) {
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

function firstProductTitle(order) {
  const products = (order && order.products) || []
  const first = products.find((p) => p && (p.title || p.name))
  return (first && (first.title || first.name)) || '标本'
}

function giverOpenidOf(order) {
  return String((order && (order._openid || order.openid)) || '').trim()
}

/**
 * 门店自取码归一化：兼容扫码 payload（PICKUP:ABC123）、纯码与大小写/空白。
 * 与 makeOrder.createPickupCode 生成的短 hex 大写码对齐。
 */
function normalizePickupCode(input) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return ''
  const matched = raw.match(/(?:^|[:#\s])PICKUP:?\s*([A-Za-z0-9-]{4,32})/i)
  const body = matched ? matched[1] : raw.replace(/^PICKUP:?/i, '')
  return body.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 32)
}

function maskBuyerPhone(phone) {
  const value = String(phone || '').trim()
  if (value.length < 7) return value ? '****' : ''
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

/** 自取单状态中文标签（用户/店员共用口径） */
function pickupStatusLabel(order) {
  const o = order || {}
  if (o.pickupStatus === 'claimed') return '已交付'
  const s = String(o.status || '')
  if (s === 'paid') return '待备妥'
  if (s === 'ready_pickup') return '可领取'
  if (s === 'received' || s === 'signed') return '已交付'
  return s || '未知'
}

/**
 * 自取单摘要（预查 / 核销回执 / 待自取列表共用）
 * @param {object} order
 * @param {object} [buyer] attachBuyerBriefs 产出的买家摘要
 */
function pickupOrderSummary(order, buyer) {
  const o = order || {}
  const products = Array.isArray(o.products) ? o.products : []
  const titles = products.map((p) => p && (p.title || p.name)).filter(Boolean)
  const phone = String(o.buyerPhone || o.phone || (buyer && buyer.phone) || '')
  const claimedAt = o.pickupClaimedAt || o.receiveTime || null
  return {
    orderId: o._id,
    orderNo: o.orderNo || '',
    storeId: o.storeId || '',
    storeName: o.storeName || '',
    pickupCode: o.pickupCode || '',
    title: titles.slice(0, 2).join('、') || '藏品',
    titleMore: titles.length > 2 ? titles.length : 0,
    productCount: products.reduce((n, p) => n + (Number(p && (p.count || p.quantity)) || 1), 0),
    amount: Number(o.amount || o.payAmount || o.totalPrice || 0) || 0,
    payTime: o.payTime || o.paidTime || o.createTime || null,
    createTime: o.createTime || null,
    buyerPhoneMasked: maskBuyerPhone(phone),
    buyerNick: String((buyer && buyer.nickName) || '').trim(),
    claimedAt,
    statusLabel: pickupStatusLabel(o)
  }
}

/** 待发货等列表：下单会员摘要（昵称/头像/手机） */
function buyerBriefFromUser(user, openid) {
  const oid = String(openid || (user && user._openid) || '').trim()
  const nick = String((user && (user.nickName || user.name)) || '').trim() || '未授权昵称'
  const avatar = String((user && user.avatarUrl) || '').trim()
  const phone = String(
    (user && (user.phone || user.mobile || user.phoneNumber)) || ''
  ).trim()
  return {
    openid: oid,
    nickName: nick,
    avatarUrl: avatar,
    phone,
    phoneMasked: maskBuyerPhone(phone),
    hasAvatar: !!avatar,
    hasPhone: !!phone,
    avatarInitial: nick.slice(0, 1) || '藏'
  }
}

async function attachBuyerBriefs(list) {
  const rows = Array.isArray(list) ? list : []
  if (!rows.length) return rows
  const openids = []
  const seen = {}
  rows.forEach((o) => {
    const oid = String((o && (o._openid || o.openid)) || '').trim()
    if (!oid || seen[oid]) return
    seen[oid] = true
    openids.push(oid)
  })
  if (!openids.length) {
    return rows.map((o) => Object.assign({}, o, { buyer: null }))
  }

  const userMap = {}
  const _ = db.command
  const CHUNK = 20
  for (let i = 0; i < openids.length; i += CHUNK) {
    const chunk = openids.slice(i, i + CHUNK)
    try {
      const res = await db
        .collection('users')
        .where({ _openid: _.in(chunk) })
        .limit(Math.max(chunk.length, 50))
        .get()
      ;(res.data || []).forEach((u) => {
        if (u && u._openid) userMap[u._openid] = u
      })
    } catch (e) {
      console.warn('attachBuyerBriefs', e && e.message)
    }
  }

  return rows.map((o) => {
    const oid = String((o && (o._openid || o.openid)) || '').trim()
    const buyer = oid ? buyerBriefFromUser(userMap[oid] || null, oid) : null
    return Object.assign({}, o, { buyer })
  })
}

function getCheckedAtMs(logistics) {
  const t = logistics && logistics.wxTraceCheckedAt
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function isStorePickupGift(order) {
  return !!(order && order.giftMeta && order.giftMeta.deliveryType === 'store_pickup')
}

/** 普通买单门店自取（非礼赠） */
function isRegularStorePickup(order) {
  if (!order || isGiftOrder(order)) return false
  return !!(order.storePickup || order.fulfillmentType === 'store_pickup')
}

function isStorePickupOrder(order) {
  if (!order) return false
  if (order.storePickup) return true
  if (order.fulfillmentType === 'store_pickup') return true
  return isStorePickupGift(order)
}

/**
 * 礼赠物流妥投 → 通知送礼人（gift_delivered，dispatchMessage 去重）
 * @param {object} order
 * @param {{ force?: boolean, simulateStatus?: number|null }} opts
 */
async function checkAndNotifyGiftDelivered(order, { force = false, simulateStatus = null } = {}) {
  if (!order || !order._id) return { skipped: true, reason: 'no_order' }
  if (!isGiftOrder(order)) return { skipped: true, reason: 'not_gift' }
  if (isStorePickupGift(order)) return { skipped: true, reason: 'store_pickup' }
  if (order.status !== 'shipped' && order.status !== 'received') {
    return { skipped: true, reason: 'bad_status' }
  }

  const logistics = order.logistics || {}
  if (logistics.giftDeliveredNotified && !force) {
    return { skipped: true, reason: 'already_notified' }
  }

  let status = simulateStatus
  let statusLabel = waybillStatusLabel(status)
  let api = simulateStatus != null ? 'simulate' : ''
  let waybillId = String(logistics.trackingNumber || '')

  if (simulateStatus == null) {
    const token = String(logistics.followWaybillToken || logistics.waybillToken || '').trim()
    if (!token) return { skipped: true, reason: 'no_token' }

    if (!force) {
      const age = Date.now() - getCheckedAtMs(logistics)
      const known = logistics.wxTraceStatus
      if (
        age >= 0 &&
        age < GIFT_TRACE_CHECK_COOLDOWN_MS &&
        known !== undefined &&
        known !== null &&
        known !== '' &&
        !isWaybillDelivered(known)
      ) {
        return { skipped: true, reason: 'cooldown', wxTraceStatus: Number(known) }
      }
      // 已查到签收但通知标记未写上：跳过冷却，继续补发
    }

    const giver = giverOpenidOf(order)
    const trace = await queryWaybillTrace(cloud, { waybillToken: token, openid: giver })
    status = trace.status
    statusLabel = trace.statusLabel || waybillStatusLabel(status)
    api = trace.api || ''
    waybillId = trace.waybillId || waybillId

    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          'logistics.wxTraceStatus': status != null ? status : null,
          'logistics.wxTraceStatusLabel': statusLabel || '',
          'logistics.wxTraceApi': api || '',
          'logistics.wxTraceCheckedAt': db.serverDate(),
          'logistics.wxTraceError': trace.ok ? '' : String(trace.errmsg || trace.error || '')
        }
      })
    } catch (e) {
      console.warn('persist wxTrace', order._id, e.message || e)
    }

    if (!trace.ok || status == null) {
      return {
        skipped: true,
        reason: 'query_failed',
        error: trace.errmsg || trace.error || '',
        errcode: trace.errcode
      }
    }
  } else {
    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          'logistics.wxTraceStatus': Number(simulateStatus),
          'logistics.wxTraceStatusLabel': statusLabel || '已签收',
          'logistics.wxTraceApi': 'simulate',
          'logistics.wxTraceCheckedAt': db.serverDate(),
          'logistics.wxTraceError': ''
        }
      })
    } catch (e) {
      console.warn('persist simulate wxTrace', order._id, e.message || e)
    }
  }

  if (!isWaybillDelivered(status)) {
    return { skipped: true, reason: 'not_delivered', wxTraceStatus: status, statusLabel }
  }

  const giver = giverOpenidOf(order)
  if (!giver) return { skipped: true, reason: 'no_giver' }

  const orderNo = order.orderNo || ''
  const productTitle = firstProductTitle(order)
  const msgRes = await dispatchInAppMessage(db, {
    eventType: 'gift_delivered',
    openid: giver,
    relatedId: order._id,
    vars: { orderNo, productTitle }
  }).catch((err) => {
    console.warn('gift_delivered message failed:', err)
    return { success: false, msg: (err && err.message) || 'send_failed' }
  })

  try {
    await db.collection('orders').doc(order._id).update({
      data: {
        'logistics.giftDeliveredNotified': true,
        'logistics.giftDeliveredAt': db.serverDate(),
        'logistics.wxTraceStatus': Number(status),
        'logistics.wxTraceStatusLabel': statusLabel || waybillStatusLabel(status)
      }
    })
  } catch (e) {
    console.warn('persist giftDeliveredNotified', order._id, e.message || e)
  }

  return {
    success: true,
    notified: !(msgRes && msgRes.skipped),
    skippedMsg: !!(msgRes && msgRes.skipped),
    wxTraceStatus: Number(status),
    statusLabel: statusLabel || waybillStatusLabel(status),
    waybillId,
    api,
    giver,
    message: msgRes
  }
}

/**
 * 定时/手动：轮询已发货礼赠单的物流签收状态，妥投则通知送礼人
 */
async function pollGiftLogisticsDelivery({ limit = GIFT_DELIVERY_POLL_LIMIT, force = false } = {}) {
  const _ = db.command
  const cap = Math.min(80, Math.max(1, parseInt(limit, 10) || GIFT_DELIVERY_POLL_LIMIT))
  let list = []
  try {
    const res = await db
      .collection('orders')
      .where({
        status: 'shipped',
        source: 'gift'
      })
      .orderBy('shipTime', 'desc')
      .limit(cap)
      .get()
    list = res.data || []
  } catch (e1) {
    // shipTime 索引可能缺失：降级 createTime
    try {
      const res = await db
        .collection('orders')
        .where({ status: 'shipped', source: 'gift' })
        .orderBy('createTime', 'desc')
        .limit(cap)
        .get()
      list = res.data || []
    } catch (e2) {
      console.error('pollGiftLogisticsDelivery query', e2)
      return { success: false, msg: e2.message || '查询失败' }
    }
  }

  // 补充：source 未标但有 giftMeta 的旧单（小批量）
  if (list.length < cap) {
    try {
      const extra = await db
        .collection('orders')
        .where({
          status: 'shipped',
          giftMeta: _.exists(true)
        })
        .limit(Math.min(20, cap - list.length))
        .get()
      const seen = {}
      list.forEach((o) => {
        seen[o._id] = true
      })
      ;(extra.data || []).forEach((o) => {
        if (!seen[o._id] && isGiftOrder(o)) list.push(o)
      })
    } catch (e) {
      /* ignore */
    }
  }

  const summary = {
    success: true,
    scanned: list.length,
    notified: 0,
    skipped: 0,
    failed: 0,
    details: []
  }

  for (const order of list) {
    if (!isGiftOrder(order) || isStorePickupGift(order)) {
      summary.skipped += 1
      continue
    }
    const logistics = order.logistics || {}
    if (logistics.giftDeliveredNotified && !force) {
      summary.skipped += 1
      continue
    }
    if (!logistics.followWaybillToken && !logistics.waybillToken) {
      summary.skipped += 1
      continue
    }
    try {
      const r = await checkAndNotifyGiftDelivered(order, { force })
      if (r.success && r.notified) summary.notified += 1
      else if (r.success && r.skippedMsg) summary.skipped += 1
      else if (r.skipped) summary.skipped += 1
      else summary.failed += 1
      if (summary.details.length < 20) {
        summary.details.push({
          orderId: order._id,
          orderNo: order.orderNo || '',
          result: r.reason || (r.notified ? 'notified' : r.skippedMsg ? 'dedupe' : 'ok'),
          wxTraceStatus: r.wxTraceStatus
        })
      }
    } catch (err) {
      summary.failed += 1
      console.warn('poll gift delivery', order._id, err.message || err)
    }
  }

  return summary
}

/**
 * 发货鉴权：店长/管理员，或 Admin Web 传入与环境变量一致的 adminOpsKey。
 * ensureWxExpress：买家本人或店长/管理员均可（店长查件补 token）。
 */
async function assertShipAccess(openid, adminOpsKey) {
  const admin = await isUserAdmin(db, openid, { adminOpsKey })
  if (admin) return { ok: true, via: 'admin' }
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER })
  if (guard.ok) return { ok: true, via: 'staff', actor: guard.actor }
  return { ok: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无发货权限' }
}

/**
 * 店长录入订单备注（随发货私信发给会员）
 * - 写在 orders.managerNote（与买家下单备注 order.remark 区分）
 * - 发货时可再覆盖一次；发货私信优先用发货时传入的备注
 */
async function saveOrderNote(orderId, rawNote, access = {}) {
  const id = String(orderId || '').trim()
  if (!id) return { success: false, msg: '缺少订单 ID' }
  const note = normalizeOrderNote(rawNote)
  let order = null
  try {
    const res = await db.collection('orders').doc(id).get()
    order = res && res.data
  } catch (e) {
    return { success: false, msg: '订单不存在' }
  }
  if (!order) return { success: false, msg: '订单不存在' }
  if (order.status !== 'paid' && order.status !== 'paid_awaiting_address' && order.status !== 'shipped') {
    return { success: false, msg: '当前订单状态不可编辑备注' }
  }
  const actor = access.actor || {}
  await db.collection('orders').doc(id).update({
    data: {
      managerNote: note,
      managerNoteAt: db.serverDate(),
      managerNoteBy: String(actor.name || (access.via === 'admin' ? 'Admin' : '')).slice(0, 40)
    }
  })
  return { success: true, orderId: id, note, noteMax: NOTE_MAX }
}

/**
 * 补履约（超管）：用户微信已实扣、但支付回调缺失时的补救入口。
 *
 * 背景：2026-09-15 回调被误判为伪造并返回 SUCCESS（微信不再重试），订单停在 pending_pay。
 * 实现：复用 confirmPayment 的 adminFulfill（同一套幂等履约：扣库存 / 核销券 / 发通知），
 *       同时把本函数环境里的 ADMIN_OPS_KEY 作为内部凭据转发（小程序超管不持有该密钥）。
 */
async function fulfillPaidOrderAction(event) {
  const orderId = String((event && event.orderId) || '').trim()
  if (!orderId) return { success: false, msg: '缺少订单 ID' }

  const opsKey = String(process.env.ADMIN_OPS_KEY || '').trim()
  if (!opsKey) {
    return {
      success: false,
      code: 'ADMIN_OPS_KEY_MISSING',
      msg: '云函数未配置 ADMIN_OPS_KEY，无法补履约'
    }
  }

  const res = await cloud.callFunction({
    name: 'confirmPayment',
    data: {
      action: 'adminFulfill',
      orderId,
      transactionId: String(
        (event && (event.transactionId || event.transaction_id)) || ''
      ).trim(),
      note: String((event && event.note) || '').slice(0, 120),
      adminOpsKey: opsKey
    }
  })
  const result = (res && res.result) || {}
  if (!result.success) {
    return { success: false, code: result.code, msg: result.msg || '补履约失败' }
  }
  return {
    success: true,
    orderId,
    alreadyPaid: !!result.alreadyPaid,
    fulfill: result.fulfill || null,
    msg: result.msg || '补履约已执行'
  }
}

function isBuyer(order, openid) {
  if (!openid || !order) return false
  if (openid === order._openid || openid === order.openid) return true
  // 礼赠受赠人可查物流轨迹 / 补 waybill token
  const receiver = order.giftMeta && order.giftMeta.receiverOpenid
  return !!(receiver && receiver === openid)
}

const LIST_TAB_STATUS = {
  pending: ['paid', 'paid_awaiting_address', 'ready_pickup'],
  shipped: ['shipped'],
  completed: ['received'],
  refund: ['refunding', 'aftersales', 'expired_refunding'],
  // 待支付 / 履约中：支付回调异常（2026-09-15 事故）时人工补履约的入口
  pendingPay: ['pending_pay', 'fulfilling']
}
const LIST_PAGE_DEFAULT = 30
const LIST_SCAN_CAP = 300

/**
 * 店长订单列表：分页 + 可选时间窗 + 单号/手机/姓名/运单搜索（内存过滤，避免脆弱复合索引）
 */
async function listManagerOrders(openid, adminOpsKey, params = {}) {
  const access = await assertShipAccess(openid, adminOpsKey)
  if (!access.ok) {
    return { success: false, code: access.code, msg: access.msg }
  }

  const tab = String(params.tab || 'pending')
  const statuses = LIST_TAB_STATUS[tab] || LIST_TAB_STATUS.pending
  const query = String(params.query || '').trim().toLowerCase()
  const daysRaw = Number(params.days)
  const days = daysRaw === 7 || daysRaw === 30 ? daysRaw : 0
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || LIST_PAGE_DEFAULT))
  const skip = Math.max(0, parseInt(params.skip, 10) || 0)
  const _ = db.command

  const where = { status: _.in(statuses) }
  if (days > 0) {
    where.createTime = _.gte(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
  }

  if (!query) {
    const res = await db
      .collection('orders')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    let list = res.data || []
    // 售后 Tab：附带「微信已退、钱包入账待核对」已退款单，便于运营抽查
    if (tab === 'refund' && skip === 0) {
      try {
        const pendingWallet = await db
          .collection('orders')
          .where({
            status: 'refunded',
            walletRefundPendingReconcile: true
          })
          .orderBy('refundTime', 'desc')
          .limit(20)
          .get()
        const extra = pendingWallet.data || []
        if (extra.length) {
          const seen = new Set(list.map((o) => o._id))
          list = extra.filter((o) => !seen.has(o._id)).concat(list)
        }
      } catch (e) {
        console.warn('listManagerOrders wallet pending', e && e.message)
      }
    }
    list = await attachBuyerBriefs(list)
    return {
      success: true,
      list,
      hasMore: (res.data || []).length >= limit,
      skip,
      limit,
      mode: 'page',
      days,
      tab
    }
  }

  const scanned = []
  let cursor = 0
  const batch = 100
  while (scanned.length < LIST_SCAN_CAP) {
    const res = await db
      .collection('orders')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip(cursor)
      .limit(batch)
      .get()
    const chunk = res.data || []
    if (!chunk.length) break
    scanned.push(...chunk)
    cursor += chunk.length
    if (chunk.length < batch) break
  }

  const matched = scanned.filter((o) => {
    const hay = [
      o.orderNo,
      o.address && o.address.name,
      o.address && o.address.phone,
      o.logistics && o.logistics.trackingNumber
    ]
      .map((v) => String(v || '').toLowerCase())
      .join(' ')
    return hay.indexOf(query) !== -1
  })
  const list = await attachBuyerBriefs(matched.slice(skip, skip + limit))
  return {
    success: true,
    list,
    hasMore: skip + limit < matched.length,
    skip,
    limit,
    mode: 'search',
    matched: matched.length,
    scanned: scanned.length,
    truncated: scanned.length >= LIST_SCAN_CAP,
    days,
    tab
  }
}

function getSyncedAtMs(logistics) {
  const t = logistics && logistics.wxExpressSyncedAt
  if (!t) return 0
  if (typeof t === 'number') return t
  if (t instanceof Date) return t.getTime()
  if (typeof t === 'object' && t.$date) return new Date(t.$date).getTime()
  const parsed = Date.parse(t)
  return Number.isFinite(parsed) ? parsed : 0
}

function readTransId(order) {
  return String((order && (order.wxTransactionId || order.transactionId || order.transaction_id)) || '').trim()
}

async function persistExpressSync(orderId, logisticsBase, syncRes) {
  const patch = logisticsPatchFromSync(syncRes)
  // 失败/跳过时勿清空已有 token（否则店长查件会误丢轨迹凭证）
  const nextWaybill =
    patch.waybillToken || (logisticsBase && logisticsBase.waybillToken) || ''
  const nextFollow =
    patch.followWaybillToken || (logisticsBase && logisticsBase.followWaybillToken) || ''
  await db.collection('orders').doc(orderId).update({
    data: {
      'logistics.deliveryId': patch.deliveryId || (logisticsBase && logisticsBase.deliveryId) || '',
      'logistics.waybillToken': nextWaybill,
      'logistics.followWaybillToken': nextFollow,
      'logistics.wxExpressStatus': patch.wxExpressStatus || '',
      'logistics.wxExpressSkipReason': patch.wxExpressSkipReason || '',
      'logistics.wxExpressError': patch.wxExpressError || '',
      'logistics.wxExpressSyncedAt': db.serverDate()
    }
  })
  return Object.assign({}, patch, {
    waybillToken: nextWaybill,
    followWaybillToken: nextFollow
  })
}

/** 买家或店长补同步：已发货但缺 waybill_token 时重试微信物流接口（不改订单状态、不重发站内信） */
async function ensureWxExpress(orderId, openid, { force = false, adminOpsKey } = {}) {
  if (!orderId) return { success: false, msg: '缺少订单 ID' }
  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }

  if (!isBuyer(order, openid)) {
    const access = await assertShipAccess(openid, adminOpsKey)
    if (!access.ok) return { success: false, msg: '无权操作' }
  }

  const logistics = order.logistics || {}
  const tracking = String(logistics.trackingNumber || '').trim()
  if (order.status !== 'shipped' && order.status !== 'received') {
    return { success: false, msg: '订单尚未发货' }
  }
  if (!tracking || tracking.length < 6) {
    return { success: false, msg: '缺少运单号' }
  }

  if (logistics.waybillToken || logistics.followWaybillToken) {
    let giftDelivery = null
    if (isGiftOrder(order) && !isStorePickupGift(order)) {
      try {
        giftDelivery = await checkAndNotifyGiftDelivered(order, { force: !!force })
      } catch (e) {
        console.warn('gift delivery check on ensure', e.message || e)
      }
    }
    return {
      success: true,
      alreadySynced: true,
      waybillToken: logistics.waybillToken || logistics.followWaybillToken,
      wxExpressStatus: logistics.wxExpressStatus || 'ok',
      wxExpressSkipReason: logistics.wxExpressSkipReason || '',
      deliveryId: logistics.deliveryId || resolveDeliveryId(logistics.carrier),
      giftDelivery
    }
  }

  // 占位单号：不打微信接口，明确告知前端降级原因
  if (looksLikePlaceholderTracking(tracking)) {
    const patch = {
      status: 'skipped',
      waybillToken: '',
      followWaybillToken: '',
      deliveryId: resolveDeliveryId(logistics.carrier),
      skipReason: 'placeholder_waybill',
      error: '运单号疑似占位/测试单号，无法查询官方轨迹'
    }
    try {
      await persistExpressSync(orderId, logistics, patch)
    } catch (e) {
      /* ignore persist */
    }
    return {
      success: true,
      waybillToken: '',
      wxExpressStatus: 'skipped',
      wxExpressSkipReason: 'placeholder_waybill',
      wxExpressError: patch.error
    }
  }

  const skipReason = String(logistics.wxExpressSkipReason || '')
  const transId = readTransId(order)

  // 仍缺微信支付交易号：条件未变，不必刷接口（旧逻辑把任意 wxExpressStatus 当成终态会永久锁死）
  if (!force && (skipReason === 'missing_trans_id' || skipReason.includes('missing_trans_id')) && !transId) {
    return {
      success: true,
      alreadySynced: true,
      waybillToken: '',
      wxExpressStatus: logistics.wxExpressStatus || 'skipped',
      wxExpressSkipReason: 'missing_trans_id',
      wxExpressError:
        logistics.wxExpressError ||
        '缺少 wxTransactionId。需真实微信支付回写交易单号后才能开通物流消息/查询组件'
    }
  }

  // 冷却期内且上次已明确失败/跳过：暂不重试（force 可绕过）
  if (!force && logistics.wxExpressStatus && !logistics.waybillToken) {
    const age = Date.now() - getSyncedAtMs(logistics)
    if (age >= 0 && age < ENSURE_RETRY_COOLDOWN_MS) {
      return {
        success: true,
        alreadySynced: true,
        waybillToken: '',
        wxExpressStatus: logistics.wxExpressStatus,
        wxExpressSkipReason: logistics.wxExpressSkipReason || '',
        wxExpressError: logistics.wxExpressError || ''
      }
    }
  }

  const syncRes = await syncWxExpress(cloud, order, {
    carrier: logistics.carrier,
    trackingNumber: tracking
  })
  const saved = await persistExpressSync(orderId, logistics, syncRes)
  let giftDelivery = null
  if (
    isGiftOrder(order) &&
    !isStorePickupGift(order) &&
    (saved.waybillToken || saved.followWaybillToken || syncRes.waybillToken)
  ) {
    try {
      const refreshed = Object.assign({}, order, {
        logistics: Object.assign({}, logistics, saved, {
          waybillToken: saved.waybillToken || syncRes.waybillToken || logistics.waybillToken,
          followWaybillToken:
            saved.followWaybillToken || syncRes.followWaybillToken || logistics.followWaybillToken
        })
      })
      giftDelivery = await checkAndNotifyGiftDelivered(refreshed, { force: !!force })
    } catch (e) {
      console.warn('gift delivery check after sync', e.message || e)
    }
  }
  return {
    success: true,
    waybillToken: saved.waybillToken || saved.followWaybillToken || '',
    wxExpressStatus: syncRes.status,
    wxExpressSkipReason: syncRes.skipReason || '',
    wxExpressError: syncRes.error || '',
    deliveryId: syncRes.deliveryId || saved.deliveryId || '',
    giftDelivery
  }
}

const PRODUCTION_MSG = {
  framing: 'custom_production_framing',
  packing: 'custom_production_packing',
  shipped: 'custom_production_shipped'
}

const ALLOWED_PRODUCTION = ['framing', 'packing', 'shipped']

const PRODUCTION_LABELS = {
  pending_make: '待制作',
  framing: '装裱中',
  packing: '待发货',
  shipped: '已发出'
}

const PRODUCTION_NEXT = {
  pending_make: { next: 'framing', label: '开始装裱' },
  framing: { next: 'packing', label: '进入包装' },
  packing: { next: 'shipped', label: '确认发出' }
}

function normalizeProductionStatus(raw) {
  const v = String(raw || '').trim()
  if (!v || v === 'pending') return 'pending_make'
  return v
}

function actorCanUseArtisanStudio(actor) {
  if (!actor) return false
  if (hasRole(actor, STORED_ROLE_SUPER)) return true
  if (hasRole(actor, STORED_ROLE_SPECIMEN_ARTISAN)) return true
  const perms = Array.isArray(actor.permissions) ? actor.permissions : []
  return perms.indexOf('manageArtisanWorks') !== -1 || perms.indexOf('manageProducts') !== -1
}

async function assertArtisanStudioAccess(openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, adminOpsKey })
  if (!guard.ok) return guard
  if (!actorCanUseArtisanStudio(guard.actor)) {
    return { ok: false, code: 'FORBIDDEN', msg: '无标本师工单权限' }
  }
  return { ok: true, actor: guard.actor }
}

async function findFramerByStaffOpenid(staffOpenid) {
  if (!staffOpenid) return null
  try {
    const res = await db.collection('framers').where({ staffOpenid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('findFramerByStaffOpenid', e && e.message)
    return null
  }
}

const GENERIC_FRAMER_NAMES = {
  门店标本师: true,
  门店: true,
  店内装裱: true,
  NATURE: true,
  nature: true,
  Nature: true
}

function normalizeFramerToken(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function isGenericFramerName(name) {
  const n = normalizeFramerToken(name)
  if (!n || n.length < 2) return true
  return !!GENERIC_FRAMER_NAMES[n] || !!GENERIC_FRAMER_NAMES[n.toUpperCase()]
}

function uniqueNonEmpty(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((raw) => {
    const v = String(raw || '').trim()
    if (!v || seen[v]) return
    seen[v] = true
    out.push(v)
  })
  return out
}

function collectOrderFramerIds(order) {
  const meta = (order && order.customMeta) || {}
  const f = meta.framer || {}
  const fromProducts = []
  const products = Array.isArray(order && order.products) ? order.products : []
  products.forEach((p) => {
    if (!p) return
    if (p.framerId) fromProducts.push(p.framerId)
  })
  return uniqueNonEmpty([
    f.framerId,
    f.id,
    f._id,
    meta.framerId,
    order && order.framerId,
    ...fromProducts
  ])
}

function collectOrderFramerNames(order) {
  const meta = (order && order.customMeta) || {}
  const f = meta.framer || {}
  return uniqueNonEmpty([
    f.name,
    meta.framerName,
    order && order.framerName
  ])
}

function collectOrderProductIds(order) {
  const meta = (order && order.customMeta) || {}
  const specimen = meta.specimen || {}
  const fromProducts = []
  const products = Array.isArray(order && order.products) ? order.products : []
  products.forEach((p) => {
    if (!p) return
    fromProducts.push(p.productId, p.id, p._id)
  })
  return uniqueNonEmpty([
    specimen.productId,
    specimen.id,
    specimen._id,
    ...fromProducts
  ])
}

function collectOrderCreatorOpenids(order) {
  const products = Array.isArray(order && order.products) ? order.products : []
  return uniqueNonEmpty(products.map((p) => p && p.createdByOpenid))
}

/**
 * 工单归属：先认明确的标本师 id；id 指向别人则不领。
 * 无 id 时：精确姓名（排除通用「门店标本师」）或订单标本属于本人工藏品。
 */
function matchOrderToArtisan(order, framer, ctx) {
  const mineId = framer && framer._id ? String(framer._id) : ''
  const ids = collectOrderFramerIds(order)
  if (mineId && ids.indexOf(mineId) !== -1) {
    return { ok: true, via: 'framer_id' }
  }
  if (ids.length) {
    return { ok: false, via: '' }
  }

  const myName = framer && !isGenericFramerName(framer.name)
    ? normalizeFramerToken(framer.name)
    : ''
  if (myName) {
    const names = collectOrderFramerNames(order).map(normalizeFramerToken)
    if (names.indexOf(myName) !== -1) {
      return { ok: true, via: 'framer_name' }
    }
  }

  const productIds = (ctx && ctx.productIds) || {}
  const orderPids = collectOrderProductIds(order)
  if (orderPids.some((id) => productIds[id])) {
    return { ok: true, via: 'own_product' }
  }

  const openid = ctx && ctx.openid ? String(ctx.openid) : ''
  if (openid && collectOrderCreatorOpenids(order).indexOf(openid) !== -1) {
    return { ok: true, via: 'created_by' }
  }
  return { ok: false, via: '' }
}

function orderAssignedToFramer(order, framer, ctx) {
  return matchOrderToArtisan(order, framer, ctx).ok
}

async function loadArtisanProductIdSet(openid, framerId) {
  const set = {}
  const queries = []
  if (openid) queries.push({ createdByOpenid: openid })
  if (framerId) queries.push({ framerId: String(framerId) })
  for (let q = 0; q < queries.length; q += 1) {
    let cursor = 0
    while (cursor < 600) {
      const res = await db.collection('products').where(queries[q]).skip(cursor).limit(100).get()
      const rows = res.data || []
      if (!rows.length) break
      rows.forEach((row) => {
        if (row && row._id) set[String(row._id)] = true
      })
      cursor += rows.length
      if (rows.length < 100) break
    }
  }
  return set
}

function formatArtisanWorkOrder(order) {
  const productionStatus = normalizeProductionStatus(order.productionStatus)
  const meta = order.customMeta || {}
  const specimen = meta.specimen || {}
  const next = PRODUCTION_NEXT[productionStatus] || null
  const createTime = order.createTime
  let formatTime = ''
  try {
    const d = createTime ? new Date(createTime) : null
    if (d && !Number.isNaN(d.getTime())) formatTime = d.toLocaleString()
  } catch (e) {
    formatTime = ''
  }
  return {
    _id: order._id,
    orderNo: order.orderNo || '',
    status: order.status || '',
    productionStatus,
    productionLabel: PRODUCTION_LABELS[productionStatus] || '待制作',
    specimenTitle:
      specimen.title ||
      (Array.isArray(order.products) && order.products[0] && order.products[0].title) ||
      '',
    latinName: specimen.latinName || '',
    frameName: (meta.frame && meta.frame.name) || '',
    skuLabel: specimen.skuLabel || '',
    framerName: (meta.framer && meta.framer.name) || '',
    framerId: (meta.framer && (meta.framer.framerId || meta.framer.id || meta.framer._id)) || '',
    matchVia: order._artisanMatchVia || '',
    matchViaLabel: ({
      framer_id: '指定本人',
      framer_name: '姓名匹配',
      own_product: '本人藏品',
      created_by: '本人录入'
    }[order._artisanMatchVia] || ''),
    nextAction: next ? next.next : '',
    nextLabel: next ? next.label : '',
    formatTime
  }
}

async function listArtisanWorkOrders(openid, adminOpsKey) {
  const access = await assertArtisanStudioAccess(openid, adminOpsKey)
  if (!access.ok) return { success: false, code: access.code, msg: access.msg }

  const framer = await findFramerByStaffOpenid(openid)
  const productIds = await loadArtisanProductIdSet(openid, framer && framer._id)
  const ctx = { openid, productIds }
  const hasIdentity = !!(framer && framer._id) || Object.keys(productIds).length > 0
  if (!hasIdentity) {
    return {
      success: true,
      list: [],
      counts: { pendingMake: 0, inProgress: 0, pendingShip: 0, shipped: 0, total: 0 },
      framerId: (framer && framer._id) || '',
      matchHint: 'no_identity'
    }
  }

  const _ = db.command
  const PAGE = 100
  const MAX = 400
  const matched = []
  let cursor = 0
  while (cursor < MAX) {
    const res = await db
      .collection('orders')
      .where({ source: 'custom', status: _.in(['paid', 'shipped']) })
      .orderBy('createTime', 'desc')
      .skip(cursor)
      .limit(PAGE)
      .get()
    const rows = res.data || []
    if (!rows.length) break
    rows.forEach((row) => {
      const hit = matchOrderToArtisan(row, framer, ctx)
      if (hit.ok) matched.push({ ...row, _artisanMatchVia: hit.via })
    })
    cursor += rows.length
    if (rows.length < PAGE) break
  }

  const list = matched.map(formatArtisanWorkOrder)
  const counts = { pendingMake: 0, inProgress: 0, pendingShip: 0, shipped: 0, total: list.length }
  list.forEach((item) => {
    if (item.productionStatus === 'pending_make') counts.pendingMake += 1
    else if (item.productionStatus === 'framing') counts.inProgress += 1
    else if (item.productionStatus === 'packing') counts.pendingShip += 1
    else if (item.productionStatus === 'shipped') counts.shipped += 1
  })
  return {
    success: true,
    list,
    counts,
    framerId: (framer && framer._id) || '',
    productLinked: Object.keys(productIds).length
  }
}

/** 定制工单生产态推进（装裱/包装/发出） */
async function advanceProduction(orderId, productionStatus, access, openid, options = {}) {
  const next = String(productionStatus || '').trim()
  if (!orderId) return { success: false, msg: '缺少订单 ID' }
  if (ALLOWED_PRODUCTION.indexOf(next) === -1) {
    return { success: false, msg: '无效的生产状态' }
  }

  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return { success: false, msg: '订单不存在' }
  if (order.status !== 'paid' && order.status !== 'shipped') {
    return { success: false, msg: '当前订单状态不可推进生产' }
  }
  if (options.requireAssignedFramer) {
    const framer = await findFramerByStaffOpenid(openid)
    const productIds = await loadArtisanProductIdSet(openid, framer && framer._id)
    if (!orderAssignedToFramer(order, framer, { openid, productIds })) {
      return { success: false, code: 'FORBIDDEN', msg: '只能推进本人工单' }
    }
  }

  const updateData = { productionStatus: next }
  if (next === 'shipped') {
    updateData.status = 'shipped'
  }

  await db.collection('orders').doc(orderId).update({ data: updateData })

  const buyerOpenid = order._openid || order.openid
  const eventType = PRODUCTION_MSG[next]
  if (eventType && buyerOpenid) {
    await dispatchInAppMessage(db, {
      eventType,
      openid: buyerOpenid,
      relatedId: orderId,
      vars: { orderNo: order.orderNo || '' }
    }).catch((err) => console.warn('advanceProduction message', err))
  }

  const actor = access.actor || {
    openid: openid || 'admin_web',
    workspaceRole: access.via === 'admin' ? 'super_admin' : '',
    role: 'manager',
    superAdmin: access.via === 'admin'
  }
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'order_advance_production',
    relatedId: orderId,
    relatedType: 'orders',
    detail: { productionStatus: next },
    source: 'managerShipOrder'
  }))

  return { success: true, msg: '已更新', productionStatus: next }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  let openid = wxContext.OPENID || ''
  if (!openid && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }

  const triggerType = String((event && (event.Type || event.type)) || '')
  const isTimer = (/timer/i.test(triggerType) || !!(event && event.TriggerName)) && isNonClientSource()
  if (isTimer) {
    try {
      return await pollGiftLogisticsDelivery({ force: false })
    } catch (err) {
      console.error('pollGiftLogisticsDelivery timer', err)
      return { success: false, msg: err.message || '礼赠物流轮询失败' }
    }
  }

  const {
    action,
    orderId,
    carrier = '顺丰速运',
    trackingNumber = '',
    note = '',
    adminOpsKey,
    force = false,
    productionStatus = '',
    tab = 'pending',
    query = '',
    days = 0,
    skip = 0,
    limit = 30
  } = event || {}

  if (action === 'pollGiftDelivery') {
    const access = await assertShipAccess(openid || wxContext.OPENID, adminOpsKey)
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    try {
      return await pollGiftLogisticsDelivery({
        limit: event.limit || GIFT_DELIVERY_POLL_LIMIT,
        force: !!force
      })
    } catch (err) {
      console.error('pollGiftDelivery', err)
      return { success: false, msg: err.message || '轮询失败' }
    }
  }

  if (action === 'simulateGiftDelivered' || action === 'checkGiftDelivery') {
    const access = await assertShipAccess(openid || wxContext.OPENID, adminOpsKey)
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    const oid = String(orderId || '').trim()
    if (!oid) return { success: false, msg: '缺少订单 ID' }
    try {
      const orderRes = await db.collection('orders').doc(oid).get()
      const order = orderRes.data
      if (!order) return { success: false, msg: '订单不存在' }
      if (!isGiftOrder(order)) return { success: false, msg: '非礼赠订单' }
      const simulate =
        action === 'simulateGiftDelivered'
          ? Number(event.simulateStatus != null ? event.simulateStatus : 4)
          : null
      const result = await checkAndNotifyGiftDelivered(order, {
        force: !!force || action === 'simulateGiftDelivered',
        simulateStatus: simulate
      })
      return { success: true, ...result }
    } catch (err) {
      console.error('checkGiftDelivery', err)
      return { success: false, msg: err.message || '检查失败' }
    }
  }

  if (action === 'listManagerOrders') {
    try {
      return await listManagerOrders(openid || wxContext.OPENID, adminOpsKey, {
        tab,
        query,
        days,
        skip,
        limit
      })
    } catch (err) {
      console.error('listManagerOrders error:', err)
      return { success: false, msg: err.message || '加载订单失败' }
    }
  }

  if (action === 'saveNote') {
    try {
      const access = await assertShipAccess(openid || wxContext.OPENID, adminOpsKey)
      if (!access.ok) {
        return { success: false, code: access.code, msg: access.msg }
      }
      return await saveOrderNote(orderId, note, access)
    } catch (err) {
      console.error('saveNote error:', err)
      return { success: false, msg: err.message || '保存备注失败' }
    }
  }

  if (action === 'fulfillPaidOrder') {
    try {
      const access = await assertShipAccess(openid || wxContext.OPENID, adminOpsKey)
      if (!access.ok) {
        return { success: false, code: access.code, msg: access.msg }
      }
      const actor = access.actor || {}
      const isSuper = access.via === 'admin' || hasRole(actor, STORED_ROLE_SUPER)
      if (!isSuper) {
        return { success: false, code: 'FORBIDDEN', msg: '仅超管可补履约' }
      }
      return await fulfillPaidOrderAction(event)
    } catch (err) {
      console.error('fulfillPaidOrder error:', err)
      return { success: false, msg: err.message || '补履约失败' }
    }
  }

  // 门店自取核销：店员确认顾客已到店取件 → received（不走快递发货）
  if (action === 'completeStorePickup') {
    const access = await assertShipAccess(openid || wxContext.OPENID, adminOpsKey)
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    const oid = String(orderId || '').trim()
    if (!oid) return { success: false, msg: '缺少订单 ID' }
    try {
      const orderRes = await db.collection('orders').doc(oid).get()
      const order = orderRes.data
      if (!order) return { success: false, msg: '订单不存在' }
      if (!isStorePickupOrder(order)) {
        return { success: false, msg: '该单不是门店自取订单' }
      }
      // 礼赠自提仍走 manageGift.verifyPickup（领取码）
      if (isStorePickupGift(order)) {
        return {
          success: false,
          code: 'GIFT_PICKUP',
          msg: '礼赠自提请扫领取码核销'
        }
      }
      if (order.status === 'received') {
        // 失败自愈：此前发起过赠分但未成功落库 → 本次补发（幂等，不会重复入账）
        let healed = 0
        let healMsg = ''
        if (order.pointsGrantRequestedAt && !order.pointsGrantedAt) {
          const retry = await grantPickupPoints(oid)
          healed = retry.pointsGranted || 0
          healMsg = retry.msg || ''
          if (healed > 0) await markPickupOrderPointsGranted(oid, healed)
        }
        return {
          success: true,
          already: true,
          msg: '此前已确认自取',
          orderId: oid,
          pointsGranted: healed || Number(order.pointsGranted) || 0,
          pointsMsg: healMsg
        }
      }
      const okStatus = ['paid', 'ready_pickup'].includes(String(order.status || ''))
      if (!okStatus) {
        return { success: false, msg: `当前状态不可确认自取（${order.status || ''}）` }
      }
      await db.collection('orders').doc(oid).update({
        data: {
          status: 'received',
          receiveTime: db.serverDate(),
          pickupStatus: 'claimed',
          pickupClaimedAt: db.serverDate(),
          pickupClaimedByStaff: openid || wxContext.OPENID || '',
          pickupCompletedAt: db.serverDate(),
          pickupCompletedBy: openid || wxContext.OPENID || '',
          // 赠分意图：赠分失败时可在下次调用自愈补发
          pointsGrantRequestedAt: db.serverDate()
        }
      })
      // 自取完成等同签收：按线上订单规则赠分（同一订单幂等）
      const pickupGrant = await grantPickupPoints(oid)
      if (pickupGrant.pointsGranted > 0) await markPickupOrderPointsGranted(oid, pickupGrant.pointsGranted)
      const productNames = (order.products || [])
        .map((p) => p.title || p.name)
        .filter(Boolean)
        .slice(0, 2)
        .join('、')
      const buyer = order._openid || order.openid
      if (buyer) {
        await dispatchInAppMessage(db, {
          eventType: 'order_received',
          openid: buyer,
          relatedId: oid,
          vars: {
            orderNo: order.orderNo || '',
            productNames: productNames || '藏品',
            tip: '门店自取已完成'
          }
        }).catch(() => {})
      }
      try {
        await writeAuditLog(db, auditFromActor(access.actor || { openid: openid || wxContext.OPENID }, {
          action: 'complete_store_pickup',
          relatedId: oid,
          relatedType: 'order',
          detail: { orderNo: order.orderNo || '', storeId: order.storeId || '' },
          source: 'managerShipOrder'
        }))
      } catch (e) { /* ignore */ }
      const pickupMsg = pickupGrant.pointsGranted > 0
        ? `已确认门店自取，顾客获赠 ${pickupGrant.pointsGranted} 积分`
        : '已确认门店自取'
      return {
        success: true,
        msg: pickupMsg,
        orderId: oid,
        status: 'received',
        pointsGranted: pickupGrant.pointsGranted || 0,
        pointsMsg: pickupGrant.msg || ''
      }
    } catch (err) {
      console.error('completeStorePickup error:', err)
      return { success: false, msg: err.message || '确认自取失败' }
    }
  }

  /**
   * 门店自取核销（扫码 / 手输码）：店员与店长均可，限本店；超管可跨店。
   * - 入参：code（PICKUP:xxx / 纯码）、channel（scan|manual）、preview（true=只预查不落库）
   * - 预查：返回订单摘要 + canVerify / already / blockReason，供店员二次确认
   * - 幂等：已核销直接返回 already=true（不二次推送、不二次记账）
   * - 副作用：订单 → received、写核销字段、买家私信、审计日志、pickup_verify_logs
   */
  if (action === 'verifyPickup') {
    const actorOpenid = openid || wxContext.OPENID
    // 优先按能力点授权；尚未给店员开权限时，至少允许店长核销
    let access = await assertStaff(db, actorOpenid, { permission: 'verifyOrderPickup' })
    if (!access.ok) access = await assertStaff(db, actorOpenid, { role: ROLE_MANAGER })
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    const code = normalizePickupCode(event.code)
    if (!code) return { success: false, msg: '缺少自取码' }
    const channelRaw = String(event.channel || 'scan')
    const channel = channelRaw === 'manual' || channelRaw === 'list' ? channelRaw : 'scan'
    /** 预查模式：只回订单摘要，供店员确认后再真正核销 */
    const preview = !!(event && (event.preview === true || event.preview === 'true'))

    let order = null
    try {
      const res = await db.collection('orders').where({ pickupCode: code }).limit(1).get()
      order = (res.data && res.data[0]) || null
    } catch (e) {
      console.error('verifyPickup query', e)
      return { success: false, msg: '查询订单失败，请重试' }
    }
    if (!order) {
      return { success: false, code: 'NOT_FOUND', msg: '没有找到这个自取码对应的订单，请核对后重试' }
    }
    if (!isStorePickupOrder(order)) {
      return { success: false, msg: '该订单不是门店自取订单' }
    }
    if (isStorePickupGift(order)) {
      return { success: false, code: 'GIFT_PICKUP', msg: '礼赠自提请扫顾客的领取码（GIFT）核销' }
    }
    const actor = access.actor || {}
    if (!canOperateStore(actor, order.storeId)) {
      return { success: false, code: 'STORE_FORBIDDEN', msg: '该订单不属于你所在门店' }
    }

    let buyerBrief = null
    try {
      const briefed = await attachBuyerBriefs([order])
      buyerBrief = (briefed[0] && briefed[0].buyer) || null
    } catch (e) { /* 买家摘要失败不阻塞核销 */ }
    const summary = pickupOrderSummary(order, buyerBrief)

    if (order.status === 'received' || order.status === 'signed' || order.pickupStatus === 'claimed') {
      // 失败自愈：此前发起过赠分但未成功落库 → 本次补发（幂等，不会重复入账）
      let healedPickup = 0
      let healedPickupMsg = ''
      if (order.pointsGrantRequestedAt && !order.pointsGrantedAt) {
        const retry = await grantPickupPoints(order._id)
        healedPickup = retry.pointsGranted || 0
        healedPickupMsg = retry.msg || ''
        if (healedPickup > 0) await markPickupOrderPointsGranted(order._id, healedPickup)
      }
      return {
        success: true,
        already: true,
        msg: '这单此前已核销，请勿重复交付',
        pointsGranted: healedPickup || Number(order.pointsGranted) || 0,
        pointsMsg: healedPickupMsg,
        order: { ...summary, claimedAt: order.pickupClaimedAt || order.receiveTime || null }
      }
    }
    if (order.status !== 'paid' && order.status !== 'ready_pickup') {
      const reason = `当前订单状态不可核销（${order.status || '未知'}）`
      if (preview) {
        return { success: true, preview: true, canVerify: false, blockReason: reason, order: summary }
      }
      return { success: false, msg: reason }
    }
    if (preview) {
      return { success: true, preview: true, canVerify: true, order: summary, channel }
    }

    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'received',
          receiveTime: db.serverDate(),
          pickupStatus: 'claimed',
          pickupClaimedAt: db.serverDate(),
          pickupClaimedByStaff: actorOpenid || '',
          pickupClaimedChannel: channel,
          pickupCompletedAt: db.serverDate(),
          pickupCompletedBy: actorOpenid || '',
          // 赠分意图：赠分失败时可在下次调用自愈补发
          pointsGrantRequestedAt: db.serverDate()
        }
      })
    } catch (e) {
      console.error('verifyPickup update', e)
      return { success: false, msg: '核销写入失败，请重试' }
    }

    // 核销完成等同签收：按线上订单规则赠分（同一订单幂等）
    const verifyGrant = await grantPickupPoints(order._id)
    if (verifyGrant.pointsGranted > 0) await markPickupOrderPointsGranted(order._id, verifyGrant.pointsGranted)

    const buyer = order._openid || order.openid
    if (buyer) {
      await dispatchInAppMessage(db, {
        eventType: 'order_received',
        openid: buyer,
        relatedId: order._id,
        vars: {
          orderNo: order.orderNo || '',
          productNames: summary.title,
          tip: '门店自取已完成'
        }
      }).catch(() => {})
    }
    try {
      await writeAuditLog(db, auditFromActor(actor, {
        action: 'verify_store_pickup',
        relatedId: order._id,
        relatedType: 'order',
        detail: { orderNo: order.orderNo || '', code, channel, storeId: order.storeId || '' },
        source: 'managerShipOrder'
      }))
    } catch (e) { /* ignore */ }
    try {
      await db.collection('pickup_verify_logs').add({
        data: {
          orderId: order._id,
          orderNo: order.orderNo || '',
          storeId: order.storeId || '',
          code,
          staffOpenid: actorOpenid || '',
          channel,
          result: 'ok',
          createTime: db.serverDate()
        }
      })
    } catch (e) { /* 日志集合缺失不阻塞核销 */ }

    return {
      success: true,
      msg: verifyGrant.pointsGranted > 0
        ? `已核销，请把藏品交给顾客（顾客获赠 ${verifyGrant.pointsGranted} 积分）`
        : '已核销，请把藏品交给顾客',
      pointsGranted: verifyGrant.pointsGranted || 0,
      pointsMsg: verifyGrant.msg || '',
      order: { ...summary, claimedAt: new Date(), statusLabel: '已交付' }
    }
  }

  /**
   * 待自取订单列表（门店现场）：店员无需顾客出示即可核对并交付。
   * - 入参：storeId、limit（默认 20，最多 50）
   * - 权限：verifyOrderPickup 能力点，或店长/超管；门店须在可操作范围内
   * - 只读；礼赠自提单不在此列（仍走 GIFT 核销）
   */
  if (action === 'listPendingPickups') {
    const actorOpenid = openid || wxContext.OPENID
    let access = await assertStaff(db, actorOpenid, { permission: 'verifyOrderPickup' })
    if (!access.ok) access = await assertStaff(db, actorOpenid, { role: ROLE_MANAGER })
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    const storeId = String((event && event.storeId) || '').trim()
    if (!storeId) return { success: false, msg: '缺少门店' }
    const actor = access.actor || {}
    if (!canOperateStore(actor, storeId)) {
      return { success: false, code: 'STORE_FORBIDDEN', msg: '该门店不在你的可操作范围' }
    }
    const limit = Math.min(50, Math.max(1, parseInt(event.limit, 10) || 20))
    const _ = db.command
    let rows = []
    try {
      const res = await db
        .collection('orders')
        .where({ storeId, status: _.in(['paid', 'ready_pickup']) })
        .orderBy('createTime', 'desc')
        .limit(limit * 2)
        .get()
      rows = res.data || []
    } catch (e) {
      console.warn('listPendingPickups indexed query failed, fallback', e && e.message)
      try {
        const res = await db
          .collection('orders')
          .where({ storeId })
          .orderBy('createTime', 'desc')
          .limit(50)
          .get()
        rows = res.data || []
      } catch (e2) {
        console.error('listPendingPickups', e2)
        return { success: false, msg: '加载待自取订单失败，请重试' }
      }
    }
    const pending = rows
      .filter((o) => isRegularStorePickup(o) && (o.status === 'paid' || o.status === 'ready_pickup'))
      .slice(0, limit)
    const buyerMap = {}
    try {
      const briefed = await attachBuyerBriefs(pending)
      briefed.forEach((o) => { buyerMap[o._id] = o.buyer || null })
    } catch (e) { /* 买家摘要失败不影响列表 */ }
    const list = pending.map((o) => pickupOrderSummary(o, buyerMap[o._id]))
    return { success: true, list, count: list.length, storeId }
  }

  if (action === 'ensureWxExpress' || action === 'retryExpressTrace') {
    try {
      return await ensureWxExpress(orderId, openid || wxContext.OPENID, {
        force: !!force || action === 'retryExpressTrace',
        adminOpsKey
      })
    } catch (err) {
      console.error('ensureWxExpress error:', err)
      return { success: false, msg: err.message || '同步物流失败' }
    }
  }

  if (action === 'diagAccessToken') {
    const access = await assertShipAccess(openid, adminOpsKey)
    if (!access.ok) {
      return { success: false, code: access.code, msg: access.msg }
    }
    try {
      const probe = await probeAccessToken(cloud)
      return { success: true, probe }
    } catch (err) {
      return { success: false, msg: (err && err.message) || '探测失败' }
    }
  }

  if (action === 'listArtisanWorkOrders') {
    try {
      return await listArtisanWorkOrders(openid, adminOpsKey)
    } catch (err) {
      console.error('listArtisanWorkOrders error:', err)
      return { success: false, msg: err.message || '加载工单失败' }
    }
  }

  if (action === 'advanceProduction') {
    const shipAccess = await assertShipAccess(openid, adminOpsKey)
    if (shipAccess.ok) {
      try {
        return await advanceProduction(orderId, productionStatus, shipAccess, openid)
      } catch (err) {
        console.error('advanceProduction error:', err)
        return { success: false, msg: err.message || '更新失败' }
      }
    }
    const artisanAccess = await assertArtisanStudioAccess(openid, adminOpsKey)
    if (!artisanAccess.ok) {
      return { success: false, code: shipAccess.code, msg: shipAccess.msg }
    }
    try {
      return await advanceProduction(orderId, productionStatus, artisanAccess, openid, {
        requireAssignedFramer: true
      })
    } catch (err) {
      console.error('advanceProduction artisan error:', err)
      return { success: false, msg: err.message || '更新失败' }
    }
  }

  const access = await assertShipAccess(openid, adminOpsKey)
  if (!access.ok) {
    return { success: false, code: access.code, msg: access.msg }
  }

  const tracking = String(trackingNumber || '').trim().replace(/\s/g, '')

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }
  if (!tracking || tracking.length < 6) {
    return { success: false, msg: '请填写有效快递单号' }
  }
  if (looksLikePlaceholderTracking(tracking)) {
    return {
      success: false,
      code: 'PLACEHOLDER_WAYBILL',
      msg: '请填写真实快递单号（不能使用 11111… 等占位/测试单号）'
    }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    if (!order) {
      return { success: false, msg: '订单不存在' }
    }
    if (order.status !== 'paid' && order.status !== 'shipped') {
      // 脏数据：地址已交但仍停在 paid_awaiting_address → 允许发货并纠正状态
      const addrOk =
        order.status === 'paid_awaiting_address' &&
        order.giftMeta &&
        order.giftMeta.addressStatus === 'submitted'
      if (!addrOk) {
        return { success: false, msg: '当前订单状态不可发货' }
      }
      try {
        await db.collection('orders').doc(orderId).update({ data: { status: 'paid' } })
        order.status = 'paid'
      } catch (eHeal) {
        console.warn('ship heal paid_awaiting_address', orderId, eHeal)
        return { success: false, msg: '当前订单状态不可发货' }
      }
    }
    if (isStorePickupOrder(order)) {
      return {
        success: false,
        code: 'STORE_PICKUP',
        msg: '门店自取订单请使用「确认自取」，不可录入快递单号'
      }
    }
    if (needsAddressBeforeShip(order)) {
      return {
        success: false,
        code: 'GIFT_AWAITING_ADDRESS',
        msg: '礼赠待填址，收礼人提交地址后方可发货'
      }
    }

    const buyerOpenid = order._openid || order.openid
    if (!buyerOpenid) {
      return { success: false, msg: '订单缺少买家信息，无法通知' }
    }

    const fromApproval = !!(event && event._fromApproval)
    const actor = access.actor || {
      openid: openid || 'admin_web',
      workspaceRole: access.via === 'admin' ? 'super_admin' : '',
      role: 'manager',
      superAdmin: access.via === 'admin'
    }
    const ws = actorWorkspaceRole(actor)
    const sensitive = isSensitiveShip(order, { isReship: order.status === 'shipped' })
    const approverRole = (!fromApproval && sensitive)
      ? resolveApproverRole(ACTION.ORDER_SHIP_SENSITIVE, ws)
      : null

    if (approverRole) {
      const carrierName = String(carrier || '快递').trim()
      const enqueued = await enqueueApproval(db, {
        actionType: ACTION.ORDER_SHIP_SENSITIVE,
        applicantOpenid: openid,
        applicantName: actor.name || '',
        applicantRole: actor.role || '',
        applicantWorkspaceRole: ws,
        relatedId: orderId,
        storeId: order.storeId || '',
        title: `敏感发货 ${order.orderNo || orderId}`,
        summary: `${carrierName} ${tracking} · ¥${Number(order.totalPrice || 0)}${order.status === 'shipped' ? ' · 改运单' : ''}`,
        payload: {
          orderId,
          orderNo: order.orderNo || '',
          carrier: carrierName,
          trackingNumber: tracking,
          note: normalizeOrderNote(note) || normalizeOrderNote(order.managerNote),
          totalPrice: order.totalPrice,
          isReship: order.status === 'shipped'
        },
        source: 'managerShipOrder',
        approverRole
      })
      if (!enqueued.ok) {
        return { success: false, msg: enqueued.msg || '提交发货审批失败' }
      }
      return {
        success: true,
        pendingApproval: true,
        approvalId: enqueued.approvalId,
        msg: '该发货需超管审核（改运单/高额/孤品），已提交待审'
      }
    }

    const carrierName = String(carrier || '快递').trim()
    const logisticsBase = {
      carrier: carrierName,
      trackingNumber: tracking,
      deliveryId: resolveDeliveryId(carrierName),
      shipTime: db.serverDate()
    }

    // 店长订单备注：发货时以本次传入为准，未传则沿用已保存的备注
    const shipNote = normalizeOrderNote(note) || normalizeOrderNote(order.managerNote)
    const shipPatch = {
      status: 'shipped',
      logistics: logisticsBase
    }
    if (shipNote && shipNote !== normalizeOrderNote(order.managerNote)) {
      shipPatch.managerNote = shipNote
      shipPatch.managerNoteAt = db.serverDate()
    }

    await db.collection('orders').doc(orderId).update({ data: shipPatch })

    const shipVars = {
      orderNo: order.orderNo || '',
      products: order.products,
      carrier: carrierName,
      trackingNo: tracking,
      note: shipNote
    }

    // 礼赠订单只发一条「标本已启程」：历史上这里同时发 order_shipped
    // 与 gift_shipped，会员会在山海有信收到两条相似私信（2026-09-14 修复）
    const giftOrder = isGiftOrder(order)
    const shipEventType = giftOrder ? 'gift_shipped' : 'order_shipped'
    const shipRendered = renderMiniMessage(shipEventType, orderId, shipVars) || {}

    const msgRes = await dispatchInAppMessage(db, {
      eventType: shipEventType,
      openid: buyerOpenid,
      relatedId: orderId,
      vars: shipVars,
      title: shipRendered.title,
      content: shipRendered.content
    })

    if (giftOrder) {
      const receiverOpenid = order.giftMeta && order.giftMeta.receiverOpenid
      if (receiverOpenid && receiverOpenid !== buyerOpenid) {
        await dispatchInAppMessage(db, {
          eventType: 'gift_shipped',
          openid: receiverOpenid,
          relatedId: orderId,
          vars: shipVars,
          title: shipRendered.title,
          content: shipRendered.content
        }).catch(() => {})
      }
    }

    let expressSync = null
    try {
      const snapshot = Object.assign({}, order, {
        _id: orderId,
        status: 'shipped',
        logistics: logisticsBase
      })
      expressSync = await syncWxExpress(cloud, snapshot, {
        carrier: carrierName,
        trackingNumber: tracking
      })
      await persistExpressSync(orderId, logisticsBase, expressSync)
    } catch (expressErr) {
      console.warn('wxExpress sync skipped:', expressErr)
      expressSync = {
        status: 'failed',
        error: (expressErr && expressErr.message) || String(expressErr)
      }
      try {
        await persistExpressSync(orderId, logisticsBase, expressSync)
      } catch (patchErr) {
        console.warn('wxExpress persist failed:', patchErr)
      }
    }

    await writeAuditLog(db, auditFromActor(actor, {
      action: 'order_ship',
      relatedId: orderId,
      relatedType: 'orders',
      detail: { carrier: carrierName, trackingNumber: tracking, via: access.via || '', sensitive: !!sensitive },
      source: 'managerShipOrder'
    }))

    if (fromApproval || sensitive) {
      await markApprovalDecided(db, {
        relatedId: orderId,
        actionType: ACTION.ORDER_SHIP_SENSITIVE,
        status: 'approved',
        decidedBy: openid || '',
        decidedByName: actor.name || '',
        source: 'managerShipOrder'
      })
    }

    return {
      success: true,
      orderId,
      messageSent: !!(msgRes && msgRes.success && !msgRes.skipped),
      messageDetail: msgRes,
      expressSync: {
        status: expressSync && expressSync.status,
        waybillToken: !!(expressSync && expressSync.waybillToken),
        skipReason: (expressSync && expressSync.skipReason) || '',
        error: (expressSync && expressSync.error) || '',
        deliveryId: (expressSync && expressSync.deliveryId) || logisticsBase.deliveryId || ''
      }
    }
  } catch (err) {
    console.error('managerShipOrder error:', err)
    return { success: false, msg: err.message || '发货失败' }
  }
}
