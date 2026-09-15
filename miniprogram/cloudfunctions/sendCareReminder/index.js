/**
 * 签收后养护提醒 — 调度 + 定时发送
 * action:
 *   schedule — 签收时写入队列（默认 3 日后）；客户端仅可为本人调度
 *   process  — 处理到期队列（仅定时触发 / 店员）
 *   cancel   — 取消某订单待发送提醒；客户端仅可取消本人队列
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CARE_TIP_DELAY_DAYS = 3
const MS_PER_DAY = 24 * 60 * 60 * 1000
const BATCH_LIMIT = 40

const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

/**
 * 是否「非客户端来源」。实测定时触发时 wxContext.SOURCE 为空字符串，
 * 小程序客户端必带 wx_client / wx_devtools —— 该判定 C 端无法伪造。
 * event.Type / TriggerName / _internal / _fromApproval / _callerOpenid 等字段
 * 均由调用方控制，**不得单独作为授权依据**。
 */
function isNonClientSource() {
  try {
    const src = String((cloud.getWXContext() || {}).SOURCE || '')
    return !/wx_client|wx_devtools/i.test(src)
  } catch (e) {
    return false
  }
}

function isClientSource(source) {
  const s = String(source || '')
  return s === 'wx_client' || s === 'wx_devtools'
}

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
      const result = await dispatchCareTip(item)
      if (result.success && !result.skipped) {
        await db.collection('care_reminder_queue').doc(item._id).update({
          data: {
            status: 'sent',
            sentAt: db.serverDate(),
            messageId: result.messageId || ''
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

  return {
    success: true,
    processed: list.length,
    sent,
    failed
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
  const fromClient = isClientSource(wxContext.SOURCE)
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
