/**
 * 签收后养护提醒 — 调度 + 定时发送
 * action:
 *   schedule — 签收时写入队列（默认 3 日后）；客户端仅可为本人调度
 *   process  — 处理到期队列（仅定时触发 / 店员）
 *   cancel   — 取消某订单待发送提醒；客户端仅可取消本人队列
 *
 * 礼赠单（2026-09-28 产品负责人点名，蓝图 miniprogram/docs/礼赠_证书与养护闭环_2026-09-28.md）：
 *   养护提醒只发**持有人**（已绑定的受礼人），送礼人不再收养护类提醒；持有人判据见 giftHolder.js（读时推导）。
 *   非礼赠单：客户端签收后调度逻辑不变；自动收货 / 门店自取核销由 process 附带的签收补扫排给下单人（2026-09-28 N2）。
 */
const cloud = require('wx-server-sdk')
// 来源判定统一真源（负向子串/全等判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource, isClientSource } = require('./sourceOrigin')
const { isGiftOrder, isGiverOf, resolveHolderOpenid, isVoidGift, giftCertInfo } = require('./giftHolder')
const { resolveCareCategory, getCategoryMeta, getGuideByCategory, getCareSummary, isVoucherLikeProduct } = require('./defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CARE_TIP_DELAY_DAYS = 3
const MS_PER_DAY = 24 * 60 * 60 * 1000
const BATCH_LIMIT = 40
/** 签收补扫窗口：只补近 N 日签收的订单，防止给很久以前签收的人补发「签收已 3 天」 */
const RECEIVED_SWEEP_DAYS = 14
const SWEEP_PAGE_SIZE = 100
const SWEEP_MAX_PAGES = 5

const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

function isTimerEvent(event) {
  const triggerType = (event && (event.Type || event.triggerType || event.triggerSource)) || ''
  return /timer/i.test(String(triggerType)) || !!(event && event.TriggerName)
}

async function isActiveStaff(openid) {
  if (!openid) return false
  let superList = SUPER_ADMIN_OPENIDS.slice()
  try {
    const acl = await db.collection('workspace_acl').doc('super_admins').get()
    const fromDb = Array.isArray((acl.data || {}).openids) ? acl.data.openids : []
    fromDb.forEach((id) => {
      const v = String(id || '').trim()
      if (v && superList.indexOf(v) === -1) superList.push(v)
    })
  } catch (e) { /* ignore */ }
  if (superList.indexOf(openid) !== -1) return true
  try {
    const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
    if (res.data && res.data[0]) return true
  } catch (e) { /* ignore */ }
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = userRes.data && userRes.data[0]
    if (user && (user.isAdmin === true || user.staffRole === 'manager' || user.staffRole === 'staff')) {
      return true
    }
  } catch (e) { /* ignore */ }
  const admins = (process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return admins.includes(openid)
}

function buildGuidePath(category, orderId, productId) {
  const q = [`category=${encodeURIComponent(category || 'GENERAL')}`]
  if (orderId) q.push(`orderId=${encodeURIComponent(orderId)}`)
  if (productId) q.push(`productId=${encodeURIComponent(productId)}`)
  q.push('from=care_tip')
  return `subpackages/feature/care/guide/index?${q.join('&')}`
}

function isMissingCollectionError(err) {
  const msg = [err && err.message, err && err.errMsg, String(err)].filter(Boolean).join(' ')
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist/i.test(msg)
}

async function dispatchCareTip(payload) {
  const res = await cloud.callFunction({
    name: 'dispatchMessage',
    data: {
      action: 'dispatch',
      eventType: 'care_tip',
      openid: payload.openid,
      relatedId: payload.orderId,
      vars: {
        relatedId: payload.orderId,
        orderNo: payload.orderNo || '',
        productTitle: payload.productTitle || '您的藏品',
        productId: payload.productId || '',
        category: payload.category || 'GENERAL',
        categoryLabel: payload.categoryLabel || '',
        careSummary: payload.careSummary || '',
        daysAfter: String(CARE_TIP_DELAY_DAYS)
      },
      actionUrl: buildGuidePath(payload.category, payload.orderId, payload.productId),
      category: 'activity'
    }
  })
  return (res.result && res.result.success) ? res.result : { success: false }
}

async function scheduleReminder(event) {
  const {
    orderId,
    openid,
    category = 'GENERAL',
    productId = '',
    productTitle = '您的藏品',
    orderNo = '',
    careSummary = '',
    categoryLabel = '',
    delayDays = CARE_TIP_DELAY_DAYS
  } = event

  if (!orderId || !openid) {
    return { success: false, msg: '缺少 orderId 或 openid' }
  }

  const days = Math.max(1, Math.min(14, Number(delayDays) || CARE_TIP_DELAY_DAYS))
  const scheduledAt = Date.now() + days * MS_PER_DAY

  try {
    const existing = await db.collection('care_reminder_queue')
      .where({ orderId, openid, type: 'care_tip', status: _.in(['pending', 'sent']) })
      .limit(1)
      .get()

    if (existing.data && existing.data.length) {
      const doc = existing.data[0]
      if (doc.status === 'sent') {
        return { success: true, skipped: true, reason: 'already_sent' }
      }
      await db.collection('care_reminder_queue').doc(doc._id).update({
        data: {
          category,
          productId,
          productTitle,
          orderNo,
          careSummary,
          categoryLabel,
          scheduledAt,
          updateTime: Date.now()
        }
      })
      return { success: true, rescheduled: true, scheduledAt, queueId: doc._id }
    }

    const addRes = await db.collection('care_reminder_queue').add({
      data: {
        type: 'care_tip',
        orderId,
        openid,
        category,
        productId,
        productTitle,
        orderNo,
        careSummary,
        categoryLabel,
        scheduledAt,
        status: 'pending',
        createTime: db.serverDate(),
        _createTime: Date.now()
      }
    })
    return { success: true, scheduledAt, queueId: addRes._id, delayDays: days }
  } catch (err) {
    if (isMissingCollectionError(err)) {
      const addRes = await db.collection('care_reminder_queue').add({
        data: {
          type: 'care_tip',
          orderId,
          openid,
          category,
          productId,
          productTitle,
          orderNo,
          careSummary,
          categoryLabel,
          scheduledAt,
          status: 'pending',
          createTime: db.serverDate(),
          _createTime: Date.now()
        }
      })
      return { success: true, scheduledAt, queueId: addRes._id, delayDays: days }
    }
    throw err
  }
}

async function loadOrder(orderId) {
  if (!orderId) return null
  try {
    const res = await db.collection('orders').doc(orderId).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

/**
 * 持有人信：复用 order_received 类型 + 覆盖标题正文（不新增消息类型，不动 messageHelper）。
 * 去重键 order_received:orderId:持有人 —— 受礼人自己点签收时已收过「藏品已入柜」，这里自然跳过。
 */
async function notifyGiftHolder(order, holder) {
  const info = giftCertInfo(order)
  const products = order.products || []
  const first = products.find((p) => p && (p.title || p.name)) || {}
  const title = first.title || first.name || '这件藏品'
  const from = info.fromName ? `由「${info.fromName}」赠予你的` : '一份赠予你的'
  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'order_received',
        openid: holder,
        relatedId: order._id,
        vars: { orderNo: order.orderNo || '', products },
        title: '这份山海已归你珍藏',
        content: `${from}「${title}」已签收入柜。\n收藏证书已以你为持有人签发；签收 ${CARE_TIP_DELAY_DAYS} 天后会寄来养护要点。`,
        actionUrl: `subpackages/business/certificate/index?id=${order._id}`,
        category: 'order'
      }
    })
    return (res && res.result) || {}
  } catch (e) {
    console.warn('notifyGiftHolder failed', order._id, e && e.message)
    return { success: false }
  }
}

/**
 * 客户端 schedule 的礼赠分支：返回 null = 非礼赠单（走原逻辑）
 * 调用者须为送礼人或受礼人；已绑定 → 排给持有人；未绑定 / 已结束 → 不排
 */
async function resolveGiftSchedule(orderId, caller) {
  const order = await loadOrder(orderId)
  if (!order || !isGiftOrder(order)) return null
  const holder = resolveHolderOpenid(order)
  if (!isGiverOf(order, caller) && holder !== caller) return { deny: true }
  if (isVoidGift(order)) return { skip: 'gift_closed' }
  if (!holder) return { skip: 'gift_holder_pending' }
  return { order, holder, notify: holder !== caller }
}

/** 发送前重新推导收件人：非礼赠原样；礼赠已结束作废；持有人变更（历史上排给送礼人的）改投持有人 */
async function resolveDispatchTarget(item) {
  const order = await loadOrder(item.orderId)
  if (!order || !isGiftOrder(order)) return { openid: item.openid }
  if (isVoidGift(order)) return { cancel: 'gift_closed' }
  const holder = resolveHolderOpenid(order)
  if (!holder) return { skip: 'gift_holder_pending' }
  return { openid: holder }
}

function careFieldsOf(order) {
  const specimens = (order.products || []).filter((p) => !isVoucherLikeProduct(p))
  const product = specimens[0] || (order.products || [])[0] || {}
  const category = resolveCareCategory(product)
  const framingName = (order.customMeta && order.customMeta.frame && order.customMeta.frame.name) || ''
  return {
    category,
    productId: product.id || product.productId || '',
    productTitle: product.title || '您的藏品',
    categoryLabel: getCategoryMeta(category).label,
    careSummary: getCareSummary(getGuideByCategory(category), framingName)
  }
}

/** 与客户端签收后 careHelper.resolveCareContext 的 showCare 同口径：有藏品、非兑换单、至少一件非券类藏品 */
function isCareEligible(order) {
  const products = (order && order.products) || []
  if (!products.length || order.source === 'exchange') return false
  return products.some((p) => !isVoucherLikeProduct(p))
}

/** 补扫对象：礼赠 → 已绑定的持有人（未结束）；普通单 → 下单人（需有养护对象）；'' = 不补 */
function sweepTargetOf(order) {
  if (isGiftOrder(order)) return isVoidGift(order) ? '' : resolveHolderOpenid(order)
  if (!isCareEligible(order)) return ''
  return String(order._openid || order.openid || '')
}

async function querySweepOrders(since) {
  const rows = []
  for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
    const res = await db.collection('orders')
      .where({ status: 'received', receiveTime: _.gte(since) })
      .orderBy('receiveTime', 'desc')
      .skip(page * SWEEP_PAGE_SIZE)
      .limit(SWEEP_PAGE_SIZE)
      .get()
    const batch = res.data || []
    rows.push(...batch)
    if (batch.length < SWEEP_PAGE_SIZE) break
  }
  return rows
}

/**
 * 签收补扫（随 process 同批）：近 RECEIVED_SWEEP_DAYS 日签收、尚无该收件人养护队列的订单 → 补排提醒。
 *   礼赠（2026-09-28）：兜住自动收货 / 自提核销 / 送礼人代点签收 → 排给持有人，并补发「已归你珍藏」信；
 *   普通单（2026-09-28 N2 点名）：兜住自动收货（sweepExpiredOrders）/ 门店自取核销（managerShipOrder）/ 客户端签收后调度失败 → 排给下单人。
 * 幂等：同 (orderId, 收件人) 任一状态的队列已存在即跳过 —— 手动签收排过的、已发的、已取消的都不会重排。
 */
async function sweepReceivedOrders() {
  const since = new Date(Date.now() - RECEIVED_SWEEP_DAYS * MS_PER_DAY)
  let orders = []
  try {
    orders = await querySweepOrders(since)
  } catch (e) {
    console.warn('sweepReceivedOrders query failed', e && e.message)
    return { scanned: 0, scheduled: 0, gift: 0, plain: 0 }
  }

  const tally = { scanned: orders.length, scheduled: 0, gift: 0, plain: 0 }
  for (const order of orders) {
    const target = sweepTargetOf(order)
    if (!target) continue
    try {
      const existing = await db.collection('care_reminder_queue')
        .where({ orderId: order._id, openid: target, type: 'care_tip' })
        .limit(1)
        .get()
      if (existing.data && existing.data.length) continue
      const receivedMs = new Date(order.receiveTime).getTime() || Date.now()
      const elapsedDays = Math.floor((Date.now() - receivedMs) / MS_PER_DAY)
      await scheduleReminder({
        ...careFieldsOf(order),
        orderId: order._id,
        openid: target,
        orderNo: order.orderNo || '',
        delayDays: Math.max(1, CARE_TIP_DELAY_DAYS - elapsedDays)
      })
      if (isGiftOrder(order)) {
        await notifyGiftHolder(order, target)
        tally.gift += 1
      } else {
        tally.plain += 1
      }
      tally.scheduled += 1
    } catch (e) {
      console.warn('sweepReceivedOrders one failed', order._id, e && e.message)
    }
  }
  return tally
}

async function processDueReminders() {
  const now = Date.now()
  let list = []

  try {
    const res = await db.collection('care_reminder_queue')
      .where({ status: 'pending', scheduledAt: _.lte(now) })
      .orderBy('scheduledAt', 'asc')
      .limit(BATCH_LIMIT)
      .get()
    list = res.data || []
  } catch (err) {
    if (isMissingCollectionError(err)) {
      return { success: true, processed: 0, sent: 0, msg: '队列集合尚未创建' }
    }
    throw err
  }

  let sent = 0
  let failed = 0

  for (const item of list) {
    try {
      const target = await resolveDispatchTarget(item)
      if (target.cancel || target.skip) {
        await db.collection('care_reminder_queue').doc(item._id).update({
          data: target.cancel
            ? { status: 'cancelled', cancelTime: Date.now(), note: target.cancel }
            : { status: 'skipped', skippedAt: db.serverDate(), note: target.skip }
        })
        continue
      }
      const redirected = target.openid !== item.openid
      const result = await dispatchCareTip(redirected ? { ...item, openid: target.openid } : item)
      if (result.success && !result.skipped) {
        await db.collection('care_reminder_queue').doc(item._id).update({
          data: {
            status: 'sent',
            sentAt: db.serverDate(),
            messageId: result.messageId || '',
            ...(redirected ? { redirectedTo: target.openid, note: 'gift_holder' } : {})
          }
        })
        sent += 1
      } else if (result.skipped) {
        await db.collection('care_reminder_queue').doc(item._id).update({
          data: { status: 'sent', sentAt: db.serverDate(), note: 'dedupe_skip' }
        })
        sent += 1
      } else {
        failed += 1
      }
    } catch (e) {
      console.error('process care reminder failed', item._id, e)
      failed += 1
    }
  }

  const receivedSweep = await sweepReceivedOrders()

  return {
    success: true,
    processed: list.length,
    sent,
    failed,
    receivedSweep
  }
}

async function cancelReminder(event) {
  const { orderId, openid } = event
  if (!orderId) return { success: false, msg: '缺少 orderId' }

  const where = { orderId, status: 'pending', type: 'care_tip' }
  if (openid) where.openid = openid

  const res = await db.collection('care_reminder_queue').where(where).get()
  const docs = res.data || []
  for (const doc of docs) {
    await db.collection('care_reminder_queue').doc(doc._id).update({
      data: { status: 'cancelled', cancelTime: Date.now() }
    })
  }
  return { success: true, cancelled: docs.length }
}

exports.main = async (event) => {
  const payload = event || {}
  const wxContext = cloud.getWXContext()
  const fromClient = isClientSource()
  const timer = isTimerEvent(payload) && isNonClientSource()
  let action = payload.action

  // 定时触发未带 action 时默认 process；客户端必须显式传 action
  if (timer && !action) action = 'process'
  if (!action) {
    return { success: false, msg: '缺少 action，请使用 schedule / process / cancel' }
  }

  try {
    if (action === 'schedule') {
      const next = { ...payload }
      if (fromClient) {
        const caller = wxContext.OPENID || ''
        if (!caller) return { success: false, code: 'UNAUTHORIZED', msg: '未登录' }
        next.openid = caller
        const gift = await resolveGiftSchedule(next.orderId, caller)
        if (gift && gift.deny) return { success: false, code: 'FORBIDDEN', msg: '无权操作此订单' }
        if (gift && gift.skip) return { success: true, skipped: true, reason: gift.skip }
        if (gift) {
          next.openid = gift.holder
          const res = await scheduleReminder(next)
          if (gift.notify) await notifyGiftHolder(gift.order, gift.holder)
          return res
        }
      }
      return await scheduleReminder(next)
    }

    if (action === 'process') {
      if (timer) {
        return await processDueReminders()
      }
      if (fromClient) {
        const caller = wxContext.OPENID || ''
        if (!(await isActiveStaff(caller))) {
          return { success: false, code: 'FORBIDDEN', msg: '无权限' }
        }
      }
      // 非客户端（云函数互调）或已通过店员校验
      return await processDueReminders()
    }

    if (action === 'cancel') {
      const next = { ...payload }
      if (fromClient) {
        const caller = wxContext.OPENID || ''
        if (!caller) return { success: false, code: 'UNAUTHORIZED', msg: '未登录' }
        next.openid = caller
      }
      return await cancelReminder(next)
    }

    return { success: false, msg: '未知 action，请使用 schedule / process / cancel' }
  } catch (e) {
    console.error('sendCareReminder', e)
    return { success: false, msg: e.message || '操作失败' }
  }
}
