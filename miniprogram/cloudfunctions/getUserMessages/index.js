/**
 * 获取用户站内信云函数（山海有信）
 *
 * queue:
 *   customer — 顾客信息（默认；非员工强制）
 *   workflow — 员工工作流（仅店员/店长/标本师/超管等可见）
 *   all      — 员工可读全部（一般不用）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_STAFF } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAGE_SIZE = 20
const MERGE_FETCH_LIMIT = 160

const QUEUE_CUSTOMER = 'customer'
const QUEUE_WORKFLOW = 'workflow'

const WORKFLOW_EVENT_TYPES = {
  staff_order_paid: true,
  staff_artisan_sku_sold: true,
  wishlist_restock_request: true,
  invoice_request_staff: true,
  approval_submitted: true,
  approval_approved: true,
  approval_rejected: true
}

function isWorkflowEventType(eventType) {
  const t = String(eventType || '').trim()
  if (!t) return false
  if (WORKFLOW_EVENT_TYPES[t]) return true
  if (t.indexOf('staff_') === 0) return true
  if (/_staff$/.test(t)) return true
  if (t.indexOf('approval_') === 0) return true
  return false
}

function resolveMessageQueue(doc = {}) {
  const q = String(doc.queue || '').trim()
  if (q === QUEUE_WORKFLOW || q === QUEUE_CUSTOMER) return q
  const aud = String(doc.audience || '').trim()
  if (aud === 'staff' || aud === 'workflow') return QUEUE_WORKFLOW
  if (aud === 'user' || aud === 'customer') return QUEUE_CUSTOMER
  if (String(doc.category || '') === 'ops') return QUEUE_WORKFLOW
  if (isWorkflowEventType(doc.type || doc.templateCode)) return QUEUE_WORKFLOW
  return QUEUE_CUSTOMER
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const {
    action,
    messageId,
    category,
    type,
    types,
    queue,
    page = 0,
    pageSize = PAGE_SIZE
  } = event

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

  const typeFilter = normalizeTypeFilter(type, types)
  const staffGuard = await assertStaff(db, openid, { role: ROLE_STAFF })
  const isStaff = !!(staffGuard && staffGuard.ok)
  const requestedQueue = resolveRequestedQueue({ queue, category }, typeFilter, isStaff)

  try {
    switch (action) {
      case 'getMessages':
        return await getMessages(openid, category, page, pageSize, typeFilter, requestedQueue, isStaff)

      case 'getMessage':
        return await getMessage(openid, messageId, isStaff)

      case 'getUnreadCount':
        return await getUnreadCount(openid, category, typeFilter, requestedQueue, isStaff)

      case 'getUnreadBreakdown':
        return await getUnreadBreakdown(openid, isStaff)

      case 'markRead':
        return await markRead(openid, messageId, isStaff)

      case 'markAllRead':
        return await markAllRead(openid, category, typeFilter, requestedQueue, isStaff)

      case 'deleteMessage':
        return await deleteMessage(openid, messageId, isStaff)

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

function normalizeTypeFilter(type, types) {
  if (Array.isArray(types) && types.length) {
    return types.map((t) => String(t || '').trim()).filter(Boolean)
  }
  if (type) {
    const t = String(type).trim()
    return t ? [t] : null
  }
  return null
}

/**
 * 解析请求队列。非员工一律 customer。
 * 兼容：category=ops 或 type 全为工作流类型 → workflow
 */
function resolveRequestedQueue({ queue, category }, typeFilter, isStaff) {
  const q = String(queue || '').trim()
  if (!isStaff) return QUEUE_CUSTOMER

  if (q === QUEUE_WORKFLOW || q === QUEUE_CUSTOMER || q === 'all') return q
  if (String(category || '') === 'ops') return QUEUE_WORKFLOW
  if (
    typeFilter &&
    typeFilter.length &&
    typeFilter.every((t) => isWorkflowEventType(t))
  ) {
    return QUEUE_WORKFLOW
  }
  return QUEUE_CUSTOMER
}

function matchTypeFilter(msg, typeFilter) {
  if (!typeFilter || !typeFilter.length) return true
  const t = String((msg && (msg.type || msg.templateCode)) || '')
  return typeFilter.indexOf(t) !== -1
}

function matchQueueFilter(msg, requestedQueue) {
  if (!requestedQueue || requestedQueue === 'all') return true
  return resolveMessageQueue(msg) === requestedQueue
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

function inferActionUrl(type, relatedId, existing) {
  if (existing) return existing
  if (!relatedId || !type) return ''
  if (
    type.indexOf('order_') === 0 ||
    type.indexOf('custom_production') === 0
  ) {
    return `subpackages/business/order-detail/index?id=${relatedId}`
  }
  return ''
}

function normalizeMessage(doc, source = 'user_messages') {
  const type = doc.type || doc.templateCode || 'system_notice'
  const relatedId = doc.relatedId || ''
  const campaignId = doc.campaignId || ''
  const queue = resolveMessageQueue(doc)
  return {
    _id: doc._id,
    title: doc.title || '系统通知',
    content: doc.content || '',
    category: doc.category || 'system',
    queue,
    type,
    relatedId,
    campaignId,
    channel: doc.channel || (campaignId ? 'inapp_campaign' : 'inapp'),
    actionUrl: inferActionUrl(type, relatedId, doc.actionUrl || ''),
    icon: doc.icon || '',
    read: doc.read === true,
    createTime: doc.createTime || doc.sentAt || doc._createTime,
    _createTime: doc._createTime || doc.sentAt || doc.createTime,
    dedupeKey: doc.dedupeKey || `${type}:${relatedId}:${doc.title || ''}`,
    _source: source,
    _altId: ''
  }
}

function eventDedupeKey(item) {
  const type = item.type || 'system_notice'
  const relatedId = item.relatedId || item.campaignId || ''
  if (relatedId) return `${type}::${relatedId}`
  return item.dedupeKey || `${type}::${item.title || ''}::${item._id}`
}

function mergePair(prev, item) {
  const userMsg = item._source === 'user_messages' ? item : (prev._source === 'user_messages' ? prev : null)
  const other = userMsg ? (userMsg === item ? prev : item) : item
  const primary = userMsg || (item.actionUrl && !prev.actionUrl ? item : prev)
  const secondary = primary === item ? prev : item
  return {
    ...secondary,
    ...primary,
    read: primary.read === true || secondary.read === true,
    actionUrl: primary.actionUrl || secondary.actionUrl,
    campaignId: primary.campaignId || secondary.campaignId,
    channel: primary.channel || secondary.channel,
    queue: primary.queue || secondary.queue || resolveMessageQueue(primary),
    content: primary.content || secondary.content,
    title: primary.title || secondary.title,
    _id: primary._id,
    _altId: secondary._id && secondary._id !== primary._id ? secondary._id : (primary._altId || ''),
    _source: primary._source
  }
}

function dedupeMessages(list) {
  const best = new Map()
  for (const item of list) {
    const key = eventDedupeKey(item)
    const prev = best.get(key)
    if (!prev) {
      best.set(key, item)
    } else {
      best.set(key, mergePair(prev, item))
    }
  }
  return Array.from(best.values())
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

function filterMerged(merged, typeFilter, requestedQueue) {
  let list = merged || []
  if (requestedQueue && requestedQueue !== 'all') {
    list = list.filter((m) => matchQueueFilter(m, requestedQueue))
  }
  if (typeFilter && typeFilter.length) {
    list = list.filter((m) => matchTypeFilter(m, typeFilter))
  }
  return list
}

function messageBelongsToUser(doc, openid) {
  if (!doc) return false
  const owner = doc._openid || doc.openid || doc.recipient
  return !owner || owner === openid
}

/**
 * 严格归属判定（用于**删除**等破坏性操作）。
 * messageBelongsToUser 对「无归属字段」的文档返回 true，读场景可接受，
 * 但删除场景会允许用户删掉他人的无归属日志，故此处要求归属字段必须存在且匹配。
 */
function messageOwnedStrictly(doc, openid) {
  if (!doc || !openid) return false
  const owner = String(doc.userOpenid || doc._openid || doc.openid || doc.recipient || '').trim()
  return !!owner && owner === String(openid).trim()
}

function canAccessMessage(msg, isStaff) {
  if (!msg) return false
  if (resolveMessageQueue(msg) === QUEUE_WORKFLOW && !isStaff) return false
  return true
}

async function getMessages(openid, category, page, pageSize, typeFilter, requestedQueue, isStaff) {
  if (requestedQueue === QUEUE_WORKFLOW && !isStaff) {
    return {
      success: false,
      code: 'FORBIDDEN',
      msg: '工作流仅员工可见',
      messages: [],
      total: 0,
      unreadCount: 0,
      hasMore: false,
      queue: QUEUE_CUSTOMER,
      isStaff: false
    }
  }

  const limit = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 50)
  const skip = Math.max(Number(page) || 0, 0) * limit

  const merged = filterMerged(
    await loadMergedMessages(openid, category),
    typeFilter,
    requestedQueue
  )
  const total = merged.length
  const unreadCount = merged.filter(isUnread).length
  const messages = merged.slice(skip, skip + limit).map(stripInternalFields)

  return {
    success: true,
    messages,
    total,
    unreadCount,
    hasMore: skip + messages.length < total,
    page: skip / limit,
    queue: requestedQueue,
    isStaff: !!isStaff
  }
}

async function getMessage(openid, messageId, isStaff) {
  if (!messageId) {
    return { success: false, msg: '缺少 messageId' }
  }
  const merged = await loadMergedMessages(openid, 'all')
  const found = merged.find((m) => m._id === messageId || m._altId === messageId)
  if (!found || !canAccessMessage(found, isStaff)) {
    return { success: false, msg: '消息不存在' }
  }
  return { success: true, message: stripInternalFields(found), isStaff: !!isStaff }
}

async function getUnreadCount(openid, category, typeFilter, requestedQueue, isStaff) {
  if (requestedQueue === QUEUE_WORKFLOW && !isStaff) {
    return { success: true, count: 0, queue: QUEUE_CUSTOMER, isStaff: false }
  }
  const merged = filterMerged(
    await loadMergedMessages(openid, category),
    typeFilter,
    requestedQueue
  )
  return {
    success: true,
    count: merged.filter(isUnread).length,
    queue: requestedQueue,
    isStaff: !!isStaff
  }
}

async function getUnreadBreakdown(openid, isStaff) {
  const merged = await loadMergedMessages(openid, 'all')
  const customerUnread = merged
    .filter((m) => resolveMessageQueue(m) === QUEUE_CUSTOMER && isUnread(m))
    .length
  const workflowUnread = isStaff
    ? merged.filter((m) => resolveMessageQueue(m) === QUEUE_WORKFLOW && isUnread(m)).length
    : 0
  return {
    success: true,
    isStaff: !!isStaff,
    customer: customerUnread,
    workflow: workflowUnread,
    count: customerUnread,
    total: customerUnread + workflowUnread
  }
}

async function markDocRead(collection, id, openid) {
  if (!id) return false
  try {
    const res = await db.collection(collection).doc(id).get()
    if (!res.data || !messageBelongsToUser(res.data, openid)) return false
    await db.collection(collection).doc(id).update({
      data: { read: true, readAt: db.serverDate() }
    })
    return res.data
  } catch (e) {
    return false
  }
}

async function markRead(openid, messageId, isStaff) {
  if (!messageId) {
    return { success: false, msg: '缺少 messageId' }
  }

  const userDoc = await markDocRead('user_messages', messageId, openid)
  const logDoc = userDoc ? false : await markDocRead('notification_logs', messageId, openid)
  const found = userDoc || logDoc

  if (found) {
    if (!canAccessMessage(normalizeMessage(found), isStaff)) {
      return { success: false, msg: '消息不存在' }
    }
    const otherCol = userDoc ? 'notification_logs' : 'user_messages'
    const extraIds = []
    try {
      if (found.dedupeKey) {
        const twins = await db.collection(otherCol).where({
          dedupeKey: found.dedupeKey
        }).limit(5).get()
        ;(twins.data || []).forEach((row) => {
          if (messageBelongsToUser(row, openid) && row.read !== true && row._id !== messageId) {
            extraIds.push(row._id)
          }
        })
      }
    } catch (e) {
      // 双写补齐失败不影响主路径
    }
    if (extraIds.length) {
      await Promise.all(extraIds.map((id) =>
        db.collection(otherCol).doc(id).update({
          data: { read: true, readAt: db.serverDate() }
        }).catch(() => null)
      ))
    }
    return { success: true, msg: '标记成功' }
  }

  return { success: false, msg: '消息不存在' }
}

async function markAllRead(openid, category, typeFilter, requestedQueue, isStaff) {
  if (requestedQueue === QUEUE_WORKFLOW && !isStaff) {
    return { success: false, code: 'FORBIDDEN', msg: '工作流仅员工可见' }
  }
  const merged = filterMerged(
    await loadMergedMessages(openid, category),
    typeFilter,
    requestedQueue
  )
  const unread = merged.filter(isUnread)
  if (!unread.length) {
    return { success: true, msg: '全部标记成功' }
  }

  const ids = []
  unread.forEach((m) => {
    if (m._id) ids.push({ col: m._source === 'notification_logs' ? 'notification_logs' : 'user_messages', id: m._id })
    if (m._altId) {
      ids.push({
        col: m._source === 'notification_logs' ? 'user_messages' : 'notification_logs',
        id: m._altId
      })
    }
  })

  await Promise.all(ids.map((item) =>
    db.collection(item.col).doc(item.id).update({
      data: { read: true, readAt: db.serverDate() }
    }).catch(() => null)
  ))

  return { success: true, msg: '全部标记成功' }
}

async function deleteMessage(openid, messageId, isStaff) {
  if (!messageId) {
    return { success: false, msg: '缺少 messageId' }
  }

  // 列表是 user_messages 与 notification_logs 两个集合合并而成（按 dedupeKey 去重），
  // 因此删除必须两边都清，否则刷新后消息会「复活」，或落在 notification_logs 侧时报无权删除。
  let removed = 0

  try {
    const messageRes = await db.collection('user_messages').doc(messageId).get()
    const doc = messageRes.data
    if (doc && messageOwnedStrictly(doc, openid)) {
      if (!canAccessMessage(normalizeMessage(doc), isStaff)) {
        return { success: false, msg: '无权删除此消息' }
      }
      const dedupeKey = String(doc.dedupeKey || '').trim()
      await db.collection('user_messages').doc(messageId).remove()
      removed += 1
      if (dedupeKey) {
        // 按 dedupeKey 清理镜像日志（同一条消息在两表共用 dempeKey）
        try {
          const mirrors = await db.collection('notification_logs')
            .where({ _openid: openid, dedupeKey })
            .limit(20)
            .get()
          for (const row of (mirrors.data || [])) {
            await db.collection('notification_logs').doc(row._id).remove()
            removed += 1
          }
        } catch (e) {
          console.warn('deleteMessage mirror cleanup failed:', e && e.message)
        }
      }
      return { success: true, msg: '删除成功', removed }
    }
  } catch (e) {
    // 落到下面的 notification_logs 分支
  }

  // 该消息只存在于 notification_logs 侧（未双写到 user_messages）
  try {
    const logRes = await db.collection('notification_logs').doc(messageId).get()
    const log = logRes.data
    if (log && messageOwnedStrictly(log, openid)) {
      await db.collection('notification_logs').doc(messageId).remove()
      return { success: true, msg: '删除成功', removed: 1 }
    }
  } catch (e) {
    // continue
  }

  return { success: false, msg: '无权删除此消息' }
}
