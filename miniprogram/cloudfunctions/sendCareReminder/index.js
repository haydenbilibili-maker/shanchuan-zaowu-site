/**
 * 签收后养护提醒 — 调度 + 定时发送
 * action:
 *   schedule — 签收时写入队列（默认 3 日后）
 *   process  — 处理到期队列（定时触发 / 手动）
 *   cancel   — 取消某订单待发送提醒
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CARE_TIP_DELAY_DAYS = 3
const MS_PER_DAY = 24 * 60 * 60 * 1000
const BATCH_LIMIT = 40

function buildGuidePath(category, orderId, productId) {
  const q = [`category=${encodeURIComponent(category || 'GENERAL')}`]
  if (orderId) q.push(`orderId=${encodeURIComponent(orderId)}`)
  if (productId) q.push(`productId=${encodeURIComponent(productId)}`)
  q.push('from=care_tip')
  return `pages/care/guide/index?${q.join('&')}`
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
  const { action = 'process' } = event || {}

  try {
    if (action === 'schedule') {
      return await scheduleReminder(event)
    }
    if (action === 'process') {
      return await processDueReminders()
    }
    if (action === 'cancel') {
      return await cancelReminder(event)
    }
    return { success: false, msg: '未知 action，请使用 schedule / process / cancel' }
  } catch (e) {
    console.error('sendCareReminder', e)
    return { success: false, msg: e.message || '操作失败' }
  }
}
