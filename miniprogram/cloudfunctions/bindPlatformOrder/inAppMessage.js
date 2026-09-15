/**
 * 山海有信 — 积分类云函数内的可靠写入（dispatchMessage + 直写 fallback）
 * 复制到 grantStorePoints / exchangeCoupon，保持同名同内容
 */
const cloud = require('wx-server-sdk')

const MINI_TEMPLATES = {
  store_points_granted: {
    category: 'activity',
    title: '门店消费已入账',
    content: (v) => `在${v.storeName || '门店'}消费 ¥${v.amount || '0'}，已记入 ${v.points || 0} 积分\n当前可用 ${v.balance || 0} 分`,
    actionUrl: () => 'subpackages/business/points/index'
  },
  store_points_revoked: {
    category: 'activity',
    title: '积分已调整',
    content: (v) => `因${v.reason || '门店消费调整'}，已扣回 ${v.points || 0} 积分\n当前可用 ${v.balance || 0} 分`,
    actionUrl: () => 'subpackages/business/points/index'
  },
  store_receipt_submitted: {
    category: 'activity',
    title: '小票认领已入册',
    content: (v) =>
      `已收到你的门店小票（¥${v.amount || '0'}）。店长通常在 ${v.slaWorkDays || 3} 个工作日内核对，通过后按「每满 ¥1 → 1 积分 + 1 成长值」入账。`,
    actionUrl: () => 'subpackages/business/order-claim/index?mode=receipt'
  },
  store_receipt_approved: {
    category: 'activity',
    title: '小票认领已入账',
    content: (v) =>
      `${v.storeName || '门店'}小票 ¥${v.amount || '0'} 已审核通过，记入 ${v.points || 0} 积分与 ${v.points || 0} 成长值\n当前可用 ${v.balance || 0} 分`,
    actionUrl: () => 'subpackages/business/order-claim/index?mode=receipt'
  },
  store_receipt_rejected: {
    category: 'activity',
    title: '小票认领未通过',
    content: (v) =>
      `门店小票（¥${v.amount || '0'}）未通过核对。原因：${v.reason || '未通过'}\n可到「订单认领」查看或重新提交。`,
    actionUrl: () => 'subpackages/business/order-claim/index?mode=receipt'
  },
  platform_order_submitted: {
    category: 'activity',
    title: '外部订单已入册',
    content: (v) => {
      const amountLine =
        v.amountText != null && v.amountText !== ''
          ? v.amountText
          : v.amount
            ? `（¥${v.amount}）`
            : ''
      return `已收到 ${v.platformName || '外部平台'} 订单 ${v.orderNo || ''}${amountLine}。店长核对后将按门店消费规则入账。`
    },
    actionUrl: () => 'subpackages/business/order-claim/index?mode=order'
  },
  platform_order_approved: {
    category: 'activity',
    title: '外部订单已入账',
    content: (v) =>
      `${v.platformName || '外部平台'} 订单 ${v.orderNo || ''}（¥${v.amount || '0'}）已通过，记入 ${v.points || 0} 积分与 ${v.points || 0} 成长值\n当前可用 ${v.balance || 0} 分`,
    actionUrl: () => 'subpackages/business/order-claim/index?mode=order'
  },
  platform_order_rejected: {
    category: 'activity',
    title: '外部订单未通过',
    content: (v) =>
      `${v.platformName || '外部平台'} 订单 ${v.orderNo || ''} 未通过核对。原因：${v.reason || '未通过'}\n可到「订单认领」查看。`,
    actionUrl: () => 'subpackages/business/order-claim/index?mode=order'
  },
  coupon_exchanged: {
    category: 'activity',
    title: '礼券已入夹',
    content: (v) => `${v.couponTitle || '代金券'} 已放入你的券夹，有效期至 ${v.expireDate || ''}\n本次消耗 ${v.costPoints || 0} 积分`,
    actionUrl: () => 'subpackages/business/coupons/index'
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
      return { success: true, skipped: true, reason: 'dedupe' }
    }
  } catch (e) {
    // 去重失败不阻塞主流程
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
      data: { action: 'dispatch', eventType, openid, relatedId, vars }
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

module.exports = {
  dispatchInAppMessage,
  writeDirect,
  renderMini
}
