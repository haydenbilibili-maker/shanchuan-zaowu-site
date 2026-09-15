/**
 * 礼赠订阅消息下发（模板 ID 空则跳过，不假接）
 *
 * 环境变量（云开发控制台 → manageGift → 环境变量）：
 * - GIFT_NUDGE_TMPL_ID     催填 / 支付后提醒分享填址
 * - GIFT_FULFILL_TMPL_ID   填址完成 / 即将启程
 * - GIFT_EXPIRE_TMPL_ID    即将过期 / 已过期退款
 *
 * 字段名按常见「事物+时间」类模板占位（thing / time / phrase）；
 * 审过模板字段不一致时，以公众平台为准改 data 映射。
 */
function tmplId(envKey) {
  return String(process.env[envKey] || '').trim()
}

function clip(v, n) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) : s
}

async function sendSubscribe(cloud, { touser, templateId, page, data }) {
  const openid = String(touser || '').trim()
  const tmpl = String(templateId || '').trim()
  if (!openid || !tmpl) {
    return { sent: false, skipped: true, reason: 'TMPL_OR_USER_EMPTY' }
  }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: tmpl,
      page: String(page || '').replace(/^\//, ''),
      data: data || {},
      miniprogramState: 'formal'
    })
    return { sent: true, skipped: false }
  } catch (e) {
    console.warn('giftSubscribe send', e && (e.message || e.errMsg || e))
    return {
      sent: false,
      skipped: false,
      reason: (e && (e.message || e.errMsg)) || 'SEND_FAIL'
    }
  }
}

/**
 * @param {'nudge'|'fulfill'|'expire'|'paid_await_address'} scene
 */
async function notifyGiftSubscribe(cloud, scene, { openid, orderId, orderNo, tip, expireLabel } = {}) {
  const page = orderId
    ? `subpackages/feature/gift/success/index?orderId=${encodeURIComponent(orderId)}`
    : 'pages/user/index'
  const no = clip(orderNo || orderId || '礼赠', 20)

  if (scene === 'nudge' || scene === 'paid_await_address') {
    const templateId = tmplId('GIFT_NUDGE_TMPL_ID')
    if (!templateId) return { sent: false, skipped: true, reason: 'TMPL_PENDING' }
    const thing2 =
      scene === 'paid_await_address'
        ? clip(tip || '礼已备妥，请交给 TA 留下地址', 20)
        : clip(tip || '不妨再提醒 TA 留下地址', 20)
    return sendSubscribe(cloud, {
      touser: openid,
      templateId,
      page: orderId
        ? `subpackages/feature/gift/success/index?orderId=${encodeURIComponent(orderId)}`
        : page,
      data: {
        thing1: { value: no },
        thing2: { value: thing2 }
      }
    })
  }

  if (scene === 'fulfill') {
    const templateId = tmplId('GIFT_FULFILL_TMPL_ID')
    if (!templateId) return { sent: false, skipped: true, reason: 'TMPL_PENDING' }
    return sendSubscribe(cloud, {
      touser: openid,
      templateId,
      page: orderId
        ? `subpackages/business/order-detail/index?id=${encodeURIComponent(orderId)}`
        : page,
      data: {
        thing1: { value: no },
        thing2: { value: clip(tip || 'TA 已留下地址，即将启程', 20) }
      }
    })
  }

  if (scene === 'expire') {
    const templateId = tmplId('GIFT_EXPIRE_TMPL_ID') || tmplId('GIFT_NUDGE_TMPL_ID')
    if (!templateId) return { sent: false, skipped: true, reason: 'TMPL_PENDING' }
    const data = {
      thing1: { value: no },
      thing2: { value: clip(tip || '填址期限将至或已过期', 20) }
    }
    if (expireLabel) data.time3 = { value: clip(expireLabel, 20) }
    return sendSubscribe(cloud, {
      touser: openid,
      templateId,
      page: orderId
        ? `subpackages/business/order-detail/index?id=${encodeURIComponent(orderId)}`
        : page,
      data
    })
  }

  return { sent: false, skipped: true, reason: 'UNKNOWN_SCENE' }
}

module.exports = {
  tmplId,
  notifyGiftSubscribe,
  sendSubscribe
}
