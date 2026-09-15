/**
 * 开票处理结果通知 — dispatchMessage + 直写 fallback
 */
const cloud = require('wx-server-sdk')

const MINI_TEMPLATES = {
  invoice_request_issued: {
    category: 'system',
    title: '电子发票已开具',
    content: (v) =>
      `订单 ${v.orderNo || ''} 的发票已开具。\n抬头：${v.title || ''}${
        v.invoiceNo ? `\n发票号：${v.invoiceNo}` : ''
      }${v.email ? `\n将发送至：${v.email}` : ''}${v.staffNote ? `\n备注：${v.staffNote}` : ''}`,
    actionUrl: () => 'subpackages/feature/user/messages/index'
  },
  invoice_request_rejected: {
    category: 'system',
    title: '开票申请未通过',
    content: (v) =>
      `订单 ${v.orderNo || ''} 的开票申请未通过。\n抬头：${v.title || ''}\n原因：${v.rejectReason || ''}`,
    actionUrl: () => 'subpackages/feature/user/messages/index'
  }
}

function renderMini(eventType, relatedId, vars = {}) {
  const t = MINI_TEMPLATES[eventType]
  if (!t) return null
  return {
    category: t.category,
    title: t.title,
    content: typeof t.content === 'function' ? t.content(vars) : t.content,
    actionUrl: typeof t.actionUrl === 'function' ? t.actionUrl(relatedId) : t.actionUrl || ''
  }
}

async function writeDirect(db, payload) {
  const { eventType, openid, relatedId, title, content, category, actionUrl } = payload
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

  try {
    await db.collection('user_messages').add({
      data: {
        _openid: openid,
        openid,
        recipient: openid,
        category: category || 'system',
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
    actionUrl: rendered.actionUrl
  })
}

module.exports = {
  dispatchInAppMessage,
  writeDirect,
  renderMini
}
