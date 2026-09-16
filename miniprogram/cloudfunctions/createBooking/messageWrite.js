/**
 * 山海有信 — 云函数内可靠写入（dispatchMessage + 直写 fallback）
 */
const cloud = require('wx-server-sdk')
const { orderProductLine } = require('./orderSummary')

const MINI_TEMPLATES = {
  order_created: {
    category: 'order',
    title: '订单待落定',
    content: (v) => `柜中这几件标本已为你预留\n${v.productNames || '藏品订单'}\n实付 ¥${v.totalPrice || '0.00'}\n请在 30 分钟内完成支付，逾期将自动释出`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  order_paid: {
    category: 'order',
    title: '藏品已入账',
    content: (v) => `订单 ${v.orderNo || ''} 已收妥款项\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}\n实付 ¥${v.totalPrice || '0.00'}\n馆员将尽快备妥，启程时再信告你`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  order_shipped: {
    category: 'order',
    title: '标本已启程',
    content: (v) =>
      `这件标本已启程。经 ${v.carrier || '快递'} 运送。\n订单 ${v.orderNo || ''}\n运单号：${v.trackingNo || ''}\n到柜时请轻取轻放。\n\n开箱与售后\n到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。\n\n入柜保养\n入柜后请避直射阳光，注意防潮；玻璃罩与镜框请尽量保持闭合。`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  order_cancelled: {
    category: 'order',
    title: '订单已释出',
    content: (v) => `订单 ${v.orderNo || ''} 已取消\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}\n${v.reason || ''}`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  order_refunded: {
    category: 'order',
    title: '款项已退回',
    content: (v) => `订单 ${v.orderNo || ''} 退款 ¥${v.refundAmount || '0.00'} 已办理\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}\n预计 1–3 个工作日回到原支付账户`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  booking_success: {
    category: 'booking',
    title: '预约已记下',
    content: (v) => `「${v.title || ''}」\n${v.date || ''} ${v.time || ''}\n票号：${v.ticketCode || ''}\n${v.storeLine || ''}`,
    actionUrl: (id) => `subpackages/business/ticket/index?id=${id}`
  },
  support_ticket_received: {
    category: 'system',
    title: '留言已入册',
    content: (v) => `你的「${v.topicLabel || '留言'}」留言已提交，专员将尽快回复`,
    actionUrl: () => 'subpackages/extra/user/messages/index'
  },
  custom_inquiry_received: {
    category: 'custom',
    title: '定制意向已入册',
    content: () => '你的标本定制意向已入册，专员将在 1–2 个工作日内与你联系',
    actionUrl: () => 'subpackages/feature/custom/inquiry/index'
  },
  pet_intake_booked: {
    category: 'custom',
    title: '伴宠交接已预约',
    content: (v) => `「${v.petName || '伴宠'}」的到店交接已预约：${v.date || ''} ${v.time || ''}\n票号：${v.ticketCode || ''}`,
    actionUrl: (id) => `subpackages/feature/custom/pet/status/index?id=${id}`
  }
}

function renderMini(eventType, relatedId, vars = {}) {
  const t = MINI_TEMPLATES[eventType]
  if (!t) return null
  return {
    category: t.category,
    title: t.title,
    content: typeof t.content === 'function' ? t.content(vars) : t.content,
    actionUrl: typeof t.actionUrl === 'function' ? t.actionUrl(relatedId) : (t.actionUrl || '')
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
      const t = dup.data[0].createTime || dup.data[0]._createTime
      if (t && Date.now() - new Date(t).getTime() < 24 * 60 * 60 * 1000) {
        return { success: true, skipped: true, reason: 'dedupe' }
      }
    }
  } catch (e) {
    // ignore dedupe errors
  }

  const data = {
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

  try {
    await db.collection('user_messages').add({ data })
  } catch (e) {
    console.warn('user_messages add failed:', e.message)
    return { success: false, msg: e.message || '消息写入失败' }
  }

  try {
    await db.collection('notification_logs').add({
      data: {
        recipient: openid,
        channel: 'inapp',
        category: category || 'system',
        templateCode: eventType,
        title,
        content: content || '',
        relatedId: relatedId || '',
        actionUrl: actionUrl || '',
        status: 'success',
        sentAt: db.serverDate(),
        read: false
      }
    })
  } catch (e) {
    console.warn('notification_logs write failed:', e.message)
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
      data: {
        action: 'dispatch',
        eventType,
        openid,
        relatedId,
        vars
      }
    })
    const result = res.result || {}
    if (result.success) return result
    console.warn('dispatchMessage returned failure:', result.msg)
  } catch (err) {
    console.warn('dispatchMessage call failed:', err.message)
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

/** @deprecated 使用 dispatchInAppMessage */
async function writeInAppMessage(db, payload) {
  const type = payload.type || payload.templateCode || 'system_notice'
  return dispatchInAppMessage(db, {
    eventType: type,
    openid: payload.openid,
    relatedId: payload.relatedId,
    vars: {
      ...payload.vars,
      content: payload.content,
      title: payload.title
    }
  })
}

module.exports = {
  dispatchInAppMessage,
  writeDirect,
  writeInAppMessage,
  renderMini
}
