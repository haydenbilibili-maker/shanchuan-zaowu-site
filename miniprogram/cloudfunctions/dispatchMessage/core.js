const { orderProductLine } = require('./orderSummary')
const {
  DEFAULT_TEMPLATES,
  QUEUE_CUSTOMER,
  QUEUE_WORKFLOW,
  resolveMessageQueue
} = require('./templates')

const DEDUPE_HOURS = 24

function renderTemplate(str, vars = {}) {
  if (!str) return ''
  const merged = { relatedId: vars.relatedId || '', ...vars }
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = merged[key]
    return val !== undefined && val !== null ? String(val) : ''
  })
}

async function getTemplate(db, templateCode) {
  try {
    const res = await db.collection('message_templates')
      .where({ templateCode, enabled: true })
      .limit(1)
      .get()
    if (res.data && res.data[0]) return res.data[0]
  } catch (e) {
    // collection may not exist yet
  }
  const def = DEFAULT_TEMPLATES[templateCode]
  if (!def) return null
  return {
    templateCode,
    enabled: true,
    ...def
  }
}

async function checkDedupe(db, dedupeKey) {
  if (!dedupeKey) return false
  const since = new Date(Date.now() - DEDUPE_HOURS * 60 * 60 * 1000)
  try {
    const res = await db.collection('user_messages')
      .where({ dedupeKey })
      .limit(1)
      .get()
    if (!res.data || !res.data.length) return false
    const msg = res.data[0]
    const t = msg.createTime || msg._createTime
    if (!t) return true
    return new Date(t) >= since
  } catch (e) {
    return false
  }
}

async function writeMessage(db, payload) {
  const {
    openid,
    category,
    type,
    title,
    content,
    relatedId = '',
    actionUrl = '',
    icon = '',
    templateCode = '',
    dedupeKey = '',
    campaignId = '',
    queue = QUEUE_CUSTOMER
  } = payload

  const resolvedQueue = resolveMessageQueue({
    queue,
    category,
    eventType: templateCode || type,
    type
  })

  const data = {
    _openid: openid,
    openid,
    recipient: openid,
    category,
    queue: resolvedQueue,
    type,
    title,
    content: content || '',
    relatedId,
    actionUrl,
    icon,
    templateCode: templateCode || type,
    dedupeKey,
    read: false,
    createTime: db.serverDate(),
    _createTime: db.serverDate()
  }
  if (campaignId) data.campaignId = campaignId

  const addRes = await db.collection('user_messages').add({ data })

  try {
    await db.collection('notification_logs').add({
      data: {
        recipient: openid,
        channel: campaignId ? 'inapp_campaign' : 'inapp',
        queue: resolvedQueue,
        category,
        type,
        templateCode: templateCode || type,
        title,
        content: content || '',
        relatedId,
        actionUrl,
        dedupeKey,
        campaignId: campaignId || '',
        status: 'success',
        sentAt: db.serverDate(),
        read: false
      }
    })
  } catch (logErr) {
    console.warn('notification_logs write failed:', logErr)
  }

  return addRes._id
}

async function dispatch(db, options) {
  const {
    eventType,
    openid,
    relatedId = '',
    vars = {},
    skipDedupe = false,
    title: overrideTitle,
    content: overrideContent,
    actionUrl: overrideActionUrl,
    category: overrideCategory,
    queue: overrideQueue,
    campaignId = ''
  } = options

  if (!openid || !eventType) {
    return { success: false, msg: '缺少 openid 或 eventType' }
  }

  const template = await getTemplate(db, eventType)
  if (!template && !overrideTitle) {
    return { success: false, msg: `未知模板: ${eventType}` }
  }

  const mergedVars = { relatedId, ...vars }
  // 订单类消息：由 order.products 自动派生「名称（规格·工艺·装裱）」摘要，
  // 模板中用 {{productLine}} 引用；调用方只需把 order.products 传进 vars。
  if (mergedVars.productLine === undefined && Array.isArray(vars.products)) {
    mergedVars.productLine = orderProductLine(vars.products, {
      fallback: vars.productNames || '藏品订单'
    })
  }
  const title = overrideTitle || renderTemplate(template.titleTemplate, mergedVars)
  const content = overrideContent !== undefined
    ? overrideContent
    : renderTemplate(template.contentTemplate, mergedVars)
  const actionUrl = overrideActionUrl !== undefined
    ? overrideActionUrl
    : renderTemplate(template.actionUrlTemplate || '', mergedVars)
  const category = overrideCategory || (template && template.category) || 'system'
  const type = eventType
  const queue = resolveMessageQueue({
    queue: overrideQueue || (template && template.queue),
    category,
    eventType,
    type
  })

  const dedupeKey = campaignId
    ? `campaign:${campaignId}:${openid}`
    : `${eventType}:${relatedId}:${openid}`

  if (!skipDedupe && !campaignId) {
    const dup = await checkDedupe(db, dedupeKey)
    if (dup) {
      return { success: true, skipped: true, reason: 'dedupe' }
    }
  }

  if (!title) {
    return { success: false, msg: '消息标题为空' }
  }

  const messageId = await writeMessage(db, {
    openid,
    category,
    queue,
    type,
    title,
    content,
    relatedId,
    actionUrl,
    templateCode: eventType,
    dedupeKey,
    campaignId
  })

  return { success: true, messageId, dedupeKey, queue }
}

module.exports = {
  renderTemplate,
  getTemplate,
  checkDedupe,
  writeMessage,
  dispatch,
  DEFAULT_TEMPLATES,
  QUEUE_CUSTOMER,
  QUEUE_WORKFLOW,
  resolveMessageQueue
}
