/**
 * 山海有信 — 审批通知（申请人 / 可选）
 */
const cloud = require('wx-server-sdk')

const MINI_TEMPLATES = {
  approval_submitted: {
    category: 'ops',
    queue: 'workflow',
    title: '审批已提交',
    content: (v) => `${v.title || '申请'}已提交，等待${v.approverLabel || '上级'}审核。`,
    actionUrl: () => 'subpackages/manager/approvals/index'
  },
  approval_approved: {
    category: 'ops',
    queue: 'workflow',
    title: '审批已通过',
    content: (v) => `${v.title || '申请'}已通过${v.deciderName ? '（' + v.deciderName + '）' : ''}。`,
    actionUrl: () => 'subpackages/manager/approvals/index'
  },
  approval_rejected: {
    category: 'ops',
    queue: 'workflow',
    title: '审批未通过',
    content: (v) => `${v.title || '申请'}未通过。原因：${v.reason || '未通过'}`,
    actionUrl: () => 'subpackages/manager/approvals/index'
  }
}

function renderMini(eventType, relatedId, vars = {}) {
  const t = MINI_TEMPLATES[eventType]
  if (!t) return null
  return {
    category: t.category,
    queue: t.queue || 'workflow',
    title: t.title,
    content: typeof t.content === 'function' ? t.content(vars) : t.content,
    actionUrl: typeof t.actionUrl === 'function' ? t.actionUrl(relatedId) : (t.actionUrl || '')
  }
}

async function writeDirect(db, payload) {
  const { eventType, openid, relatedId, title, content, category, queue, actionUrl } = payload
  if (!openid || !title) return { success: false, msg: '缺少 openid 或 title' }

  const dedupeKey = `${eventType}:${relatedId || ''}:${openid}:${Date.now()}`
  const resolvedQueue = queue || 'workflow'
  try {
    await db.collection('user_messages').add({
      data: {
        _openid: openid,
        openid,
        recipient: openid,
        category: category || 'ops',
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
  if (!openid || !eventType) return { success: false, msg: '缺少 openid 或 eventType' }

  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', eventType, openid, relatedId, vars }
    })
    const result = res.result || {}
    if (result.success) return result
  } catch (err) {
    console.warn('dispatchMessage call failed:', err.message)
  }

  const rendered = renderMini(eventType, relatedId, vars)
  if (!rendered) return { success: false, msg: `无 fallback 模板: ${eventType}` }

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

module.exports = { dispatchInAppMessage, MINI_TEMPLATES }
