/**
 * 获取用户站内信云函数（山海有信）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAGE_SIZE = 20
const MERGE_FETCH_LIMIT = 120

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, messageId, category, page = 0, pageSize = PAGE_SIZE } = event

  if (!openid) {
    return {
      success: false,
      msg: '请先登录',
      messages: [],
      count: 0,
      unreadCount: 0,
      hasMore: false
    }
  }

  try {
    switch (action) {
      case 'getMessages':
        return await getMessages(openid, category, page, pageSize)

      case 'getUnreadCount':
        return await getUnreadCount(openid, category)

      case 'markRead':
        return await markRead(openid, messageId)

      case 'markAllRead':
        return await markAllRead(openid, category)

      case 'deleteMessage':
        return await deleteMessage(openid, messageId)

      default:
        return { success: false, msg: '未知操作' }
    }
  } catch (e) {
    console.error('getUserMessages error:', e)
    return {
      success: false,
      msg: e.message || '操作失败',
      messages: []
    }
  }
}

function getMessageTime(msg) {
  const raw = msg.createTime || msg.sentAt || msg._createTime
  if (!raw) return 0
  try {
    return new Date(raw).getTime()
  } catch (e) {
    return 0
  }
}

function isUnread(msg) {
  return msg.read !== true
}

function buildRecipientWhere(openid, category) {
  const recipientMatch = _.or([
    { _openid: openid },
    { openid },
    { recipient: openid }
  ])

  if (category && category !== 'all') {
    return _.and([recipientMatch, { category }])
  }
  return recipientMatch
}

function normalizeMessage(doc, source = 'user_messages') {
  const type = doc.type || doc.templateCode || 'system_notice'
  return {
    _id: doc._id,
    title: doc.title || '系统通知',
    content: doc.content || '',
    category: doc.category || 'system',
    type,
    relatedId: doc.relatedId || '',
    actionUrl: doc.actionUrl || '',
    icon: doc.icon || '',
    read: doc.read === true,
    createTime: doc.createTime || doc.sentAt || doc._createTime,
    _createTime: doc._createTime || doc.sentAt || doc.createTime,
    dedupeKey: doc.dedupeKey || `${type}:${doc.relatedId || ''}:${doc.title || ''}`,
    _source: source
  }
}

function dedupeMessages(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = item.dedupeKey || `${item.type}:${item.relatedId}:${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function stripInternalFields(msg) {
  const { _source, ...rest } = msg
  return rest
}

async function fetchUserMessagesRaw(where, limit = MERGE_FETCH_LIMIT) {
  const col = db.collection('user_messages')

  try {
    const res = await col.where(where).orderBy('createTime', 'desc').limit(limit).get()
    return res.data || []
  } catch (e1) {
    console.warn('user_messages orderBy createTime failed:', e1.message)
  }

  try {
    const res = await col.where(where).orderBy('_createTime', 'desc').limit(limit).get()
    return res.data || []
  } catch (e2) {
    console.warn('user_messages orderBy _createTime failed:', e2.message)
  }

  try {
    const res = await col.where(where).limit(limit).get()
    return (res.data || []).sort((a, b) => getMessageTime(b) - getMessageTime(a))
  } catch (e3) {
    console.warn('user_messages fetch failed:', e3.message)
    return []
  }
}

async function fetchNotificationLogsRaw(openid, category, limit = MERGE_FETCH_LIMIT) {
  const logWhere = {
    recipient: openid,
    channel: _.in(['inapp', 'inapp_campaign'])
  }
  if (category && category !== 'all') {
    logWhere.category = category
  }

  try {
    const res = await db.collection('notification_logs')
      .where(logWhere)
      .orderBy('sentAt', 'desc')
      .limit(limit)
      .get()
    return res.data || []
  } catch (e1) {
    console.warn('notification_logs orderBy sentAt failed:', e1.message)
  }

  try {
    const res = await db.collection('notification_logs')
      .where(logWhere)
      .limit(limit)
      .get()
    return (res.data || []).sort((a, b) => getMessageTime(b) - getMessageTime(a))
  } catch (e2) {
    console.warn('notification_logs fetch failed:', e2.message)
    return []
  }
}

async function loadMergedMessages(openid, category) {
  const where = buildRecipientWhere(openid, category)
  const [userRows, logRows] = await Promise.all([
    fetchUserMessagesRaw(where),
    fetchNotificationLogsRaw(openid, category)
  ])

  return dedupeMessages([
    ...userRows.map((row) => normalizeMessage(row, 'user_messages')),
    ...logRows.map((row) => normalizeMessage(row, 'notification_logs'))
  ]).sort((a, b) => getMessageTime(b) - getMessageTime(a))
}

function messageBelongsToUser(doc, openid) {
  if (!doc) return false
  const owner = doc._openid || doc.openid || doc.recipient
  return !owner || owner === openid
}

async function getMessages(openid, category, page, pageSize) {
  const limit = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 50)
  const skip = Math.max(Number(page) || 0, 0) * limit

  const merged = await loadMergedMessages(openid, category)
  const total = merged.length
  const unreadCount = merged.filter(isUnread).length
  const messages = merged.slice(skip, skip + limit).map(stripInternalFields)

  return {
    success: true,
    messages,
    total,
    unreadCount,
    hasMore: skip + messages.length < total,
    page: skip / limit
  }
}

async function getUnreadCount(openid, category) {
  const merged = await loadMergedMessages(openid, category)
  return {
    success: true,
    count: merged.filter(isUnread).length
  }
}

async function markRead(openid, messageId) {
  if (!messageId) {
    return { success: false, msg: '缺少 messageId' }
  }

  try {
    const msgRes = await db.collection('user_messages').doc(messageId).get()
    if (msgRes.data) {
      if (!messageBelongsToUser(msgRes.data, openid)) {
        return { success: false, msg: '无权操作' }
      }
      await db.collection('user_messages').doc(messageId).update({
        data: { read: true, readAt: db.serverDate() }
      })
      return { success: true, msg: '标记成功' }
    }
  } catch (e) {
    // try notification_logs
  }

  try {
    const logRes = await db.collection('notification_logs').doc(messageId).get()
    if (logRes.data) {
      if (!messageBelongsToUser(logRes.data, openid)) {
        return { success: false, msg: '无权操作' }
      }
      await db.collection('notification_logs').doc(messageId).update({
        data: { read: true, readAt: db.serverDate() }
      })
      return { success: true, msg: '标记成功' }
    }
  } catch (err) {
    console.error('markRead failed:', err)
    return { success: false, msg: err.message }
  }

  return { success: false, msg: '消息不存在' }
}

async function markAllRead(openid, category) {
  const merged = await loadMergedMessages(openid, category)
  const unread = merged.filter(isUnread)
  if (!unread.length) {
    return { success: true, msg: '全部标记成功' }
  }

  const userIds = unread.filter((m) => m._source === 'user_messages').map((m) => m._id)
  const logIds = unread.filter((m) => m._source === 'notification_logs').map((m) => m._id)

  await Promise.all([
    ...userIds.map((id) =>
      db.collection('user_messages').doc(id).update({
        data: { read: true, readAt: db.serverDate() }
      }).catch(() => null)
    ),
    ...logIds.map((id) =>
      db.collection('notification_logs').doc(id).update({
        data: { read: true, readAt: db.serverDate() }
      }).catch(() => null)
    )
  ])

  return { success: true, msg: '全部标记成功' }
}

async function deleteMessage(openid, messageId) {
  if (!messageId) {
    return { success: false, msg: '缺少 messageId' }
  }

  try {
    const messageRes = await db.collection('user_messages').doc(messageId).get()
    if (messageRes.data && messageBelongsToUser(messageRes.data, openid)) {
      await db.collection('user_messages').doc(messageId).remove()
      return { success: true, msg: '删除成功' }
    }
  } catch (e) {
    // continue
  }

  return { success: false, msg: '无权删除此消息' }
}
