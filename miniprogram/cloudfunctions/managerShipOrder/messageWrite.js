/**
 * 山海有信 — 云函数内可靠写入（dispatchMessage + 直写 fallback）
 */
const cloud = require('wx-server-sdk')
const { orderProductLine, pickMessageProducts, pickPackagePhotos } = require('./orderSummary')

/** 店长订单备注（随发货私信发送）上限，与前端输入框 maxlength 保持一致 */
const NOTE_MAX = 100
/** C 端展示用备注标签：以「馆员留言：」开头，客户端会高亮这一行 */
const NOTE_LABEL = '馆员留言'

function normalizeOrderNote(value) {
  return String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX)
}

/** 发货私信附录：开箱售后 + 入柜保养（博物柜语气，事实→感受→连接） */
const SHIPPED_CARE_APPENDIX = [
  '开箱与售后',
  '到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。',
  '',
  '入柜保养',
  '入柜后请避直射阳光，注意防潮；玻璃罩与镜框请尽量保持闭合。'
].join('\n')

/** 发货私信正文：启程说明 + 运单 + 轻取提示 + 开箱保养 + 备注（无备注则不加空行） */
function buildShippedContent(headLine, v = {}) {
  const lines = [
    headLine,
    `运单号：${v.trackingNo || ''}`,
    '到柜时请轻取轻放。',
    '',
    SHIPPED_CARE_APPENDIX
  ]
  const note = normalizeOrderNote(v.note)
  if (note) lines.push(`${NOTE_LABEL}：${note}`)
  return lines.join('\n')
}

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
      buildShippedContent(`这件标本已启程。经 ${v.carrier || '快递'} 运送。\n订单 ${v.orderNo || ''}\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}`, v),
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  order_received: {
    category: 'order',
    title: '门店自取完成',
    content: (v) =>
      `订单 ${v.orderNo || ''} 已确认到店领取。\n${v.productNames || '藏品'} 已交予你\n${v.tip || '感谢你走进山海造物'}`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  custom_production_framing: {
    category: 'custom',
    title: '开始装裱',
    content: (v) => `订单 ${v.orderNo || ''} 已进入装裱。标本师正细细为你处理`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  custom_production_packing: {
    category: 'custom',
    title: '装裱完成',
    content: (v) => `订单 ${v.orderNo || ''} 装裱已完成，正在包装，即将启程`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  custom_production_shipped: {
    category: 'custom',
    title: '定制藏品已启程',
    content: (v) =>
      `订单 ${v.orderNo || ''} 定制藏品已启程。\n感谢你的耐心等候。\n\n${SHIPPED_CARE_APPENDIX}`,
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
  gift_paid: {
    category: 'order',
    title: '心意已备妥',
    content: (v) => {
      const head = `礼赠订单 ${v.orderNo || ''} 已收妥款项\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}\n实付 ¥${v.totalPrice || '0.00'}`
      if (v.days) return `${head}\n请把礼笺交给 TA；${v.days} 日内未填址将自动退回`
      return `${head}\n${v.tip || v.productNames || '心意已备妥'}`
    },
    actionUrl: (id) => `subpackages/feature/gift/success/index?orderId=${id}`
  },
  gift_awaiting_address: {
    category: 'order',
    title: '正等 TA 留下地址',
    content: (v) => `「${v.productNames || '标本'}」已备妥\n正等 TA 开启礼笺并留下去处`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  gift_accepted: {
    category: 'order',
    title: 'TA 已开启礼笺',
    content: (v) => `礼赠订单 ${v.orderNo || ''}：TA 已收下这份山海，正待留下地址`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  gift_address_submitted: {
    category: 'order',
    title: 'TA 已留下去处',
    content: (v) => `礼赠订单 ${v.orderNo || ''}：去处已确认，馆员即将备妥启程`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  gift_nudge: {
    category: 'order',
    title: '不妨再提醒一声',
    content: (v) => `礼赠订单 ${v.orderNo || ''} 仍在等待 TA 留下地址\n可再次分享礼笺卡片`,
    actionUrl: (id) => `subpackages/feature/gift/success/index?orderId=${id}`
  },
  gift_nudge_receiver: {
    category: 'order',
    title: '还有一份山海等你',
    content: (v) => `有一份标本礼赠，正等你留下收件去处`,
    actionUrl: (id, v = {}) => `subpackages/feature/gift/receive/index?orderId=${id}&token=${v.token || ''}`
  },
  gift_shipped: {
    category: 'order',
    title: '标本已启程',
    content: (v) =>
      buildShippedContent(`这份礼赠已启程。经 ${v.carrier || '快递'} 运送。\n订单 ${v.orderNo || ''}\n${orderProductLine(v.products, { fallback: v.productNames || '藏品订单' })}`, v),
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  gift_delivered: {
    category: 'order',
    title: '礼物已到柜',
    content: (v) =>
      `礼赠订单 ${v.orderNo || ''}：「${v.productTitle || '标本'}」已妥投到柜`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  },
  gift_expired_refund: {
    category: 'order',
    title: '邀约已过期',
    content: (v) => `礼赠订单 ${v.orderNo || ''} 填址期限已至，款项将退回赠予者`,
    actionUrl: (id) => `subpackages/business/order-detail/index?id=${id}`
  }
,
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
    actionUrl: typeof t.actionUrl === 'function' ? t.actionUrl(relatedId, vars) : (t.actionUrl || ''),
    // 需求 10：fallback 直写路径同样要带「名称 + 图片 + 规格」商品卡，
    // 否则 dispatchMessage 调用失败时信件就退回「只有订单号」的旧形态。
    products: pickMessageProducts(vars.products),
    // 发货包装图片（可选）：fallback 路径同样要带 —— 否则「图只在 dispatchMessage 成功时才到」
    // 会变成一条**只在故障时才丢图**的隐藏行为（最难排查的那类）。
    photos: pickPackagePhotos(vars.photos)
  }
}

/** 供调用方在需要时先把标题/正文渲染好（发货私信含订单备注，需绕过 DB 模板） */
const renderMiniMessage = renderMini

async function writeDirect(db, payload) {
  const { eventType, openid, relatedId, title, content, category, actionUrl, products, photos } = payload
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
  // 需求 10：商品卡（名称 + 图片 + 规格）
  if (Array.isArray(products) && products.length) data.products = products
  // 发货包装图片（可选）：空数组不落字段 → 存量消息文档（无此键）与「这次没选图」
  // 在读取侧走同一条「不渲染」分支。
  const safePhotos = pickPackagePhotos(photos)
  if (safePhotos.length) data.photos = safePhotos

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

async function dispatchInAppMessage(db, { eventType, openid, relatedId, vars = {}, title, content }) {
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
        vars,
        // 发货包装图片（可选）：顶层显式传，别只靠 vars ——
        // 图片是附件不是模板变量，模板里没有 {{photo}} 可渲染。
        ...(Array.isArray(vars && vars.photos) && vars.photos.length
          ? { photos: vars.photos }
          : {}),
        ...(title ? { title } : {}),
        ...(content != null ? { content } : {})
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
    actionUrl: rendered.actionUrl,
    products: rendered.products,
    photos: rendered.photos
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
  normalizeOrderNote,
  NOTE_MAX,
  NOTE_LABEL,
  renderMiniMessage,
  renderMini
}
