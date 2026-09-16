/**
 * 开票申请 — 用户回执 + 可选专员通知（dispatchMessage + 直写 fallback）
 */
const cloud = require('wx-server-sdk')

const MINI_TEMPLATES = {
  invoice_request_received: {
    category: 'system',
    title: '开票申请已入册',
    content: (v) =>
      `订单 ${v.orderNo || ''} 的开票申请已提交\n抬头：${v.title || ''}\n专员核对后将开具电子发票并发送`,
    actionUrl: () => 'subpackages/extra/user/messages/index'
  },
  invoice_request_staff: {
    category: 'ops',
    queue: 'workflow',
    title: '新开票申请待办',
    content: (v) =>
      `订单 ${v.orderNo || ''} · ${v.invoiceTypeLabel || ''}\n抬头：${v.title || ''}${v.taxNo ? `\n税号：${v.taxNo}` : ''}${v.email ? `\n邮箱：${v.email}` : ''}`,
    actionUrl: () => 'subpackages/manager/invoice-requests/index'
  }
}

function renderMini(eventType, relatedId, vars = {}) {
  const t = MINI_TEMPLATES[eventType]
  if (!t) return null
  return {
    category: t.category,
    queue: t.queue || (t.category === 'ops' ? 'workflow' : 'customer'),
    title: t.title,
    content: typeof t.content === 'function' ? t.content(vars) : t.content,
    actionUrl: typeof t.actionUrl === 'function' ? t.actionUrl(relatedId) : (t.actionUrl || '')
  }
}

async function writeDirect(db, payload) {
  const { eventType, openid, relatedId, title, content, category, queue, actionUrl } = payload
  if (!openid || !title) {
    return { success: false, msg: '缺少 openid 或 title' }
  }

  const dedupeKey = `${eventType}:${relatedId || ''}:${openid}`
  try {
    const dup = await db.collection('user_messages').where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) {
      return { success: true, skipped: true, reason: 'dedupe' }
    }
  } catch (e) {
    // ignore
  }

  const resolvedQueue = queue
    || (MINI_TEMPLATES[eventType] && MINI_TEMPLATES[eventType].queue)
    || (category === 'ops' ? 'workflow' : 'customer')

  try {
    await db.collection('user_messages').add({
      data: {
        _openid: openid,
        openid,
        recipient: openid,
        category: category || 'system',
        queue: resolvedQueue,
        type: eventType,
        title,
        content: content || '',
        relatedId: relatedId || '',
        actionUrl: actionUrl || '',
        templateCode: eventType,
        dedupeKey,
        read: false,
        createTime: db.serverDate(),
        _createTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('user_messages add failed:', e.message)
    return { success: false, msg: e.message || '消息写入失败' }
  }

  return { success: true, fallback: true }
}

async function dispatchInAppMessage(db, { eventType, openid, relatedId, vars = {} }) {
  if (!openid || !eventType) {
    return { success: false, msg: '缺少 openid 或 eventType' }
  }

  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', eventType, openid, relatedId, vars }
    })
    const result = res.result || {}
    if (result.success) return result
    console.warn('dispatchMessage returned failure:', result.msg)
  } catch (err) {
    console.warn('dispatchMessage call failed:', err && err.message)
  }

  const rendered = renderMini(eventType, relatedId, vars)
  if (!rendered) {
    return { success: false, msg: `无 fallback 模板: ${eventType}` }
  }

  return writeDirect(db, {
    eventType,
    openid,
    relatedId,
    title: rendered.title,
    content: rendered.content,
    category: rendered.category,
    queue: rendered.queue,
    actionUrl: rendered.actionUrl
  })
}

function getAdminOpenids() {
  const raw = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 尝试通知专员；失败不阻断主流程 */
async function notifyStaffInvoice(db, { relatedId, vars }) {
  const admins = getAdminOpenids()
  if (!admins.length) {
    console.log('[invoice] no MESSAGE_ADMIN_OPENIDS, skip staff notify', relatedId, vars && vars.orderNo)
    return { success: true, skipped: true, reason: 'no_admin' }
  }

  const results = []
  for (const openid of admins) {
    try {
      const r = await dispatchInAppMessage(db, {
        eventType: 'invoice_request_staff',
        openid,
        relatedId,
        vars
      })
      results.push({ openid, ...r })
    } catch (e) {
      console.warn('staff invoice notify failed:', openid, e && e.message)
      results.push({ openid, success: false, msg: e && e.message })
    }
  }
  return { success: true, results }
}

module.exports = {
  dispatchInAppMessage,
  notifyStaffInvoice,
  writeDirect,
  renderMini
}
