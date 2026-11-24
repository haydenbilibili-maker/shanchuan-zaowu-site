/**
 * 获取用户站内信云函数（山海有信）
 *
 * queue:
 *   customer — 顾客信息（默认；非员工强制）
 *   workflow — 员工工作流（仅店员/店长/标本师/超管等可见）
 *   all      — 员工可读全部（一般不用）
 */
const cloud = require('wx-server-sdk')
const { assertStaff: _assertStaff, ROLE_STAFF } = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}


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
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
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
    // 需求 10：信件商品卡（名称 + 图片 + 规格）。历史消息没有该字段 → 返回 []，
    // 前端据此决定是否渲染卡片；不在这里补默认图，以免给旧信凭空造出商品。
    products: normalizeProducts(doc.products),
    // 发货包装实拍（可选附件）：随「山海有信」一起送达顾客，是顾客侧「包装实拍」
    // 区块的**唯一**来源。与 products 同一族问题 —— 本函数是白名单式，不列出来的
    // 字段会被静默丢掉；客户端 normalizePackagePhotos(undefined) 只得到空数组，
    // 表现为「顾客永远看不到图，且无任何报错」。历史消息没有该字段 → 返回 []。
    photos: normalizePhotos(doc.photos),
    // 每日日报的结构化正文（数字 + 每个数字的口径与来源）。
    // 为什么必须在这里显式透传：本函数是**白名单式**归一化，未列出的字段会被丢掉 ——
    // 不透传的话，日报详情页拿不到 payload，只能渲染纯文本，产品负责人要的「口径可对账」就没了。
    // 只透传 dailyDigest 一种 type，且做尺寸收敛，避免任意文档把大对象带进列表响应。
    payload: normalizeDigestPayload(doc),
    read: doc.read === true,
    createTime: doc.createTime || doc.sentAt || doc._createTime,
    _createTime: doc._createTime || doc.sentAt || doc.createTime,
    dedupeKey: doc.dedupeKey || `${type}:${relatedId}:${doc.title || ''}`,
    _source: source,
    _altId: '',
    // 2026-11-24：本条在库里的全部落点（合并后累积）。标已读要逐个落到**正确的集合**；
    // 原先只记 _id + 一个 _altId，且一律当 _altId 在「另一张表」—— 同表新旧两条 / 三条同键时会漏改，表现为「始终有一封未读」
    _members: doc._id ? [{ col: source, id: doc._id }] : []
  }
}

/**
 * 需求 10：把商品卡裁成前端只需要的四项（名称/图片/规格/数量）。
 * 云库文档可能是历史版本或被人工改过，故这里再做一次防御性收敛，
 * 顺带把图片限制为「非空字符串」，避免前端渲染出破图占位。
 */
function normalizeProducts(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const item of list.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue
    const title = String(item.title || '').trim().slice(0, 60)
    const image = String(item.image || '').trim().slice(0, 512)
    if (!title && !image) continue
    out.push({
      id: String(item.id || '').trim().slice(0, 64),
      title: title || '藏品',
      image,
      skuLabel: String(item.skuLabel || '').trim().slice(0, 40),
      count: Math.max(1, parseInt(item.count, 10) || 1)
    })
  }
  return out
}

/**
 * 发货包装实拍（可选附件）的防御性收敛 —— 与 normalizeProducts 同一族。
 *
 * 云库文档可能来自历史版本或被人工改过，故这里只保留**非空字符串地址**并封顶张数，
 * 避免脏数据把列表响应撑大。历史消息没有该字段 → 返回 []（前端据此不渲染该区块）。
 * ⚠️ 这里**不做 cloud:// → https 的转换**：那是客户端渲染态的事，唯一落点是
 *   `utils/messageHelper.normalizePackagePhotos`；云侧只负责把字段**活着送出去**。
 */
const MESSAGE_MAX_PHOTOS = 6

function normalizePhotos(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const item of list.slice(0, MESSAGE_MAX_PHOTOS)) {
    const value = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' ? (item.url || item.fileID || item.src) : '')
    const url = String(value == null ? '' : value).trim().slice(0, 512)
    if (!url) continue
    out.push(url)
  }
  return out
}

/**
 * 每日日报结构化正文的收敛（只认 daily_digest 一种 type）。
 *
 * 为什么收敛而不是原样透传：本函数是客户端可调的读接口，任何类型的文档都可能被塞进
 * `payload`。这里只取日报真正需要的字段，并给数组长度与字符串长度封顶，
 * 免得一条被人工改坏的文档把列表响应撑大。
 */
const DIGEST_MAX_METRICS = 40
const DIGEST_MAX_SOURCES = 4
const DIGEST_STR_MAX = 200

function clipText (v, max = DIGEST_STR_MAX) {
  return String(v == null ? '' : v).slice(0, max)
}

const DIGEST_MAX_STORES = 8
const DIGEST_STORE_KEYS = ['revenueYuan', 'posYuan', 'orderCount', 'refundYuan', 'onlineYuan', 'cashBalanceYuan', 'shipmentCount']

function numOrNull (v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 日报「门店营收」按店分行（可选字段；历史日报没有 → null，前端不渲染） */
function normalizeStoreBreakdown (raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return null
  const row = (r) => {
    const out = { storeId: clipText(r && r.storeId, 64), name: clipText(r && r.name, 24) }
    DIGEST_STORE_KEYS.forEach((k) => { out[k] = numOrNull(r && r[k]) })
    return out
  }
  return {
    columns: Array.isArray(raw.columns)
      ? raw.columns.slice(0, DIGEST_STORE_KEYS.length).map((c) => ({
        key: clipText(c && c.key, 24),
        label: clipText(c && c.label, 12),
        unit: clipText(c && c.unit, 12),
        source: clipText(c && c.source, 64)
      }))
      : [],
    rows: raw.rows.slice(0, DIGEST_MAX_STORES).map(row),
    total: raw.total ? row(raw.total) : null,
    storeCount: Number(raw.storeCount) || 0,
    failedCollections: Array.isArray(raw.failedCollections) ? raw.failedCollections.slice(0, 4).map((x) => clipText(x, 48)) : [],
    mismatches: Array.isArray(raw.mismatches) ? raw.mismatches.slice(0, 8).map((x) => clipText(x, 120)) : [],
    note: clipText(raw.note, 160)
  }
}

function normalizeDigestPayload (doc) {
  const type = String((doc && (doc.type || doc.templateCode)) || '')
  if (type !== 'daily_digest') return null
  const raw = doc && doc.payload
  if (!raw || typeof raw !== 'object') return null
  const metrics = Array.isArray(raw.metrics) ? raw.metrics.slice(0, DIGEST_MAX_METRICS) : []
  return {
    storeBreakdown: normalizeStoreBreakdown(raw.storeBreakdown),
    v: Number(raw.v) || 1,
    dayKey: clipText(raw.dayKey, 10),
    role: clipText(raw.role, 32),
    roleLabel: clipText(raw.roleLabel, 32),
    generatedAt: clipText(raw.generatedAt, 32),
    missing: Array.isArray(raw.missing) ? raw.missing.slice(0, DIGEST_MAX_METRICS).map((x) => clipText(x, 48)) : [],
    // 取数失败（含原因）必须单独回传：写侧 dailyDigest 已把 failed 与 missing 分两档，
    // 读侧若在这里丢掉，超管在信里看到的就只剩「当日无数据」—— 把故障伪装成 0/没生意。
    failed: Array.isArray(raw.failed)
      ? raw.failed.slice(0, DIGEST_MAX_METRICS).map((f) => ({
        id: clipText(f && f.id, 48),
        label: clipText(f && f.label, 32),
        error: clipText(f && f.error, 160)
      }))
      : [],
    sections: Array.isArray(raw.sections)
      ? raw.sections.slice(0, 8).map((s) => ({
        key: clipText(s && s.key, 24),
        label: clipText(s && s.label, 24),
        ids: Array.isArray(s && s.ids) ? s.ids.slice(0, DIGEST_MAX_METRICS).map((x) => clipText(x, 48)) : []
      }))
      : [],
    metrics: metrics.map((m) => ({
      id: clipText(m && m.id, 48),
      section: clipText(m && m.section, 24),
      label: clipText(m && m.label, 32),
      unit: clipText(m && m.unit, 12),
      value: m && m.value == null ? null : Number(m.value),
      source: clipText(m && m.source, 240),
      caveat: clipText(m && m.caveat, 240),
      sources: Array.isArray(m && m.sources)
        ? m.sources.slice(0, DIGEST_MAX_SOURCES).map((s) => ({
          collection: clipText(s && s.collection, 48),
          timeField: clipText(s && s.timeField, 48),
          filter: clipText(s && s.filter, 160),
          tz: clipText(s && s.tz, 48)
        }))
        : []
    }))
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
    // 需求 10：通知日志行永远没有商品卡（只有 user_messages 有），
    // 若让它按 primary 覆盖，会把另一侧真实商品的卡抹成空数组。
    products: (primary.products && primary.products.length) ? primary.products : (secondary.products || []),
    // 发货包装实拍与 products 同一族：notification_logs 镜像行永远没有 photos，
    // 两条同为 user_messages 的同键行（新旧格式并存）也会互相覆盖。
    // 若让它按 primary 覆盖，会把另一侧真实的图片抹成空数组 —— 顾客侧静默无图。
    photos: (primary.photos && primary.photos.length) ? primary.photos : (secondary.photos || []),
    // 日报结构化正文只写在 user_messages 侧（notification_logs 镜像不落 payload）。
    // 若让它按 primary 覆盖，当 primary 是日志行时会把日报正文抹成 null —— 与 products 同一族问题。
    payload: primary.payload || secondary.payload || null,
    _id: primary._id,
    _altId: secondary._id && secondary._id !== primary._id ? secondary._id : (primary._altId || ''),
    _source: primary._source,
    // 内联（不调外部函数）：test:message-products 会把 mergePair 单独切出来执行
    _members: [].concat(prev._members || [], item._members || [])
      .filter((m, i, arr) => m && m.id && arr.findIndex((x) => x && x.col === m.col && x.id === m.id) === i)
  }
}

function mergeMembers(a, b) {
  const out = []
  ;(a || []).concat(b || []).forEach((m) => {
    if (m && m.id && !out.some((x) => x.col === m.col && x.id === m.id)) out.push(m)
  })
  return out
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
  const { _source, _members, ...rest } = msg
  return rest
}

/**
 * 把一组落点逐个标成已读（2026-11-24）。每条按它自己的集合改；改不上（stats.updated = 0，常见于来源标错）
 * 再到另一张表试一次。返回实际改上的条数与失败清单 —— 不再 `.catch(() => null)` 把失败吞成「成功」。
 */
async function markMembersRead(members) {
  let updated = 0
  const failed = []
  for (const m of members || []) {
    const cols = [m.col, m.col === 'notification_logs' ? 'user_messages' : 'notification_logs']
    let ok = false
    for (const col of cols) {
      try {
        const r = await db.collection(col).doc(m.id).update({ data: { read: true, readAt: db.serverDate() } })
        if (r && r.stats && r.stats.updated > 0) { ok = true; break }
        // updated = 0 也可能是「本来就已读」：读回来确认
        const got = await db.collection(col).doc(m.id).get().catch(() => null)
        if (got && got.data && got.data.read === true) { ok = true; break }
      } catch (e) { /* 这张表里没有这条，换另一张 */ }
    }
    if (ok) updated += 1
    else failed.push(m)
  }
  return { updated, failed }
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
    // 2026-11-24：同一封信在列表里是合并后的一组（两张表 / 同表新旧多条）；整组一起标，免得留下一条未读的「影子」
    try {
      const group = (await loadMergedMessages(openid, 'all')).find((m) =>
        m._id === messageId || m._altId === messageId || (m._members || []).some((x) => x.id === messageId))
      if (group && group._members && group._members.length > 1) await markMembersRead(group._members)
    } catch (e) {
      console.warn('markRead group sync failed:', e && e.message)
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

/** 本人在两张表里所有未读落点（按库直接查，最多各 UNREAD_SWEEP_LIMIT 条），按队列 / 类型过滤后返回 { col, id } */
const UNREAD_SWEEP_LIMIT = 500
async function loadUnreadMembers(openid, category, typeFilter, requestedQueue) {
  const out = []
  const cat = category && category !== 'all' ? { category } : null
  const sources = [
    ['user_messages', _.and([buildRecipientWhere(openid, 'all'), { read: _.neq(true) }].concat(cat ? [cat] : []))],
    ['notification_logs', Object.assign({ recipient: openid, channel: _.in(['inapp', 'inapp_campaign']), read: _.neq(true) }, cat || {})]
  ]
  for (const [col, where] of sources) {
    try {
      const res = await db.collection(col).where(where).limit(UNREAD_SWEEP_LIMIT).get()
      const rows = (res.data || []).map((d) => normalizeMessage(d, col))
      filterMerged(rows, typeFilter, requestedQueue).forEach((m) => { if (m._id) out.push({ col, id: m._id }) })
    } catch (e) {
      console.warn('loadUnreadMembers', col, e && e.message)
    }
  }
  return out
}

async function markAllRead(openid, category, typeFilter, requestedQueue, isStaff) {
  if (requestedQueue === QUEUE_WORKFLOW && !isStaff) {
    return { success: false, code: 'FORBIDDEN', msg: '工作流仅员工可见' }
  }
  const load = async () => filterMerged(await loadMergedMessages(openid, category), typeFilter, requestedQueue)
  const unread = (await load()).filter(isUnread)

  // 每封未读的**全部**落点都标上（两张表、同表新旧多条都算）
  // + 直接按库扫一遍本人的未读落点（不受合并读取 160 条窗口限制）：清掉历史上旧实现漏改、平时被同组已读那条盖住、
  //   组成一变（窗口挤出 / 分类不同）就单独冒出来的「影子未读」
  const ghosts = await loadUnreadMembers(openid, category, typeFilter, requestedQueue)
  const members = mergeMembers([].concat(...unread.map((m) => m._members || [])), ghosts)
  if (!members.length) {
    return { success: true, msg: '全部标记成功', unreadCount: 0 }
  }
  const r = await markMembersRead(members)

  // 改完重新数一遍，如实回报：仍有未读就说清楚，并把卡住的那几封记进日志便于排查
  const left = (await load()).filter(isUnread)
  if (left.length) {
    console.error('markAllRead 仍有未读', JSON.stringify(left.map((m) => ({ id: m._id, type: m.type, source: m._source, members: m._members }))), 'failed', JSON.stringify(r.failed))
    return { success: false, msg: `还有 ${left.length} 封没标上，已记录，稍后再试`, unreadCount: left.length, updated: r.updated }
  }
  return { success: true, msg: '全部标记成功', unreadCount: 0, updated: r.updated }
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
