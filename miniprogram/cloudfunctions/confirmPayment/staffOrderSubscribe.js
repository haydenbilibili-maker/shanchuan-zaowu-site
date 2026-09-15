/**
 * 店长 / 超管：新订单微信订阅消息
 *
 * 环境变量（云开发控制台 → payCallback / confirmPayment → 环境变量）：
 * - STAFF_ORDER_PAID_TMPL_ID  新订单待处理（订阅消息模板 ID；勿写入仓库）
 *
 * 公众平台「详细内容」字段（场景：有新的订单提示店长）：
 * - character_string1：订单编号（≤32，数字/字母/符号）
 * - thing2：商品（≤20）
 * - time5：下单时间（如 2026年9月14日 11:15）
 * - thing3：收货人名（≤20）
 * - thing4：收货地址（≤20）
 */
function tmplId(envKey) {
  return String(process.env[envKey] || '').trim()
}

function clip(v, n) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) : s
}

/** character_string：仅保留数字/字母/常见符号，最长 32 */
function clipCharacterString(v, n = 32) {
  const raw = String(v == null ? '' : v).trim()
  const cleaned = raw.replace(/[^\w\-./#:]+/g, '')
  if (!cleaned) return clip('ORDER', n)
  return cleaned.length > n ? cleaned.slice(0, n) : cleaned
}

/** time.DATA：24 小时制，支持年月日，如 2026年9月14日 11:15 */
function formatTimeValue(v) {
  let d = null
  if (v instanceof Date) d = v
  else if (v && typeof v === 'object' && typeof v.toDate === 'function') {
    try {
      d = v.toDate()
    } catch (e) {
      d = null
    }
  } else if (v) {
    d = new Date(v)
  }
  if (!d || Number.isNaN(d.getTime())) d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${day}日 ${hh}:${mm}`
}

function buildAddressLine(addr) {
  if (!addr || typeof addr !== 'object') return ''
  const region = Array.isArray(addr.region)
    ? addr.region.filter(Boolean).join('')
    : String(addr.regionText || addr.region || '').trim()
  const detail = String(addr.detail || addr.address || '').trim()
  return `${region}${detail}`.trim()
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
    console.warn('staffOrderSubscribe send', e && (e.message || e.errMsg || e))
    const raw = (e && (e.message || e.errMsg)) || 'SEND_FAIL'
    let reason = raw
    if (/43101/.test(raw) || /refuse to accept/i.test(raw)) {
      reason = 'USER_REFUSED_OR_NO_QUOTA(43101)'
    } else if (/47003/.test(raw)) {
      reason = 'ARG_ERROR(47003):' + raw
    }
    return {
      sent: false,
      skipped: false,
      reason
    }
  }
}

/**
 * @param {object} cloud wx-server-sdk cloud
 * @param {{
 *   openid: string,
 *   orderId?: string,
 *   relatedId?: string,
 *   orderNo?: string,
 *   productNames?: string,
 *   orderTime?: string|Date|number,
 *   receiverName?: string,
 *   receiverAddress?: string
 * }} opts
 */
async function notifyStaffOrderSubscribe(cloud, opts = {}) {
  const templateId = tmplId('STAFF_ORDER_PAID_TMPL_ID')
  if (!templateId) {
    return { sent: false, skipped: true, reason: 'TMPL_PENDING' }
  }
  const openid = String(opts.openid || '').trim()
  if (!openid) {
    return { sent: false, skipped: true, reason: 'NO_OPENID' }
  }
  const orderId = String(opts.orderId || opts.relatedId || '').trim()
  const page = orderId
    ? 'subpackages/manager/manager/index?tab=2&title=订单管理'
    : 'pages/user/index'

  const orderNo = clipCharacterString(opts.orderNo || orderId || 'ORDER', 32)
  const products = clip(opts.productNames || '藏品订单', 20)
  const orderTime = formatTimeValue(opts.orderTime)
  const receiverName = clip(opts.receiverName || '待确认', 20)
  const receiverAddress = clip(opts.receiverAddress || '待确认', 20)

  return sendSubscribe(cloud, {
    touser: openid,
    templateId,
    page,
    data: {
      character_string1: { value: orderNo },
      thing2: { value: products },
      time5: { value: orderTime },
      thing3: { value: receiverName },
      thing4: { value: receiverAddress }
    }
  })
}

module.exports = {
  tmplId,
  notifyStaffOrderSubscribe,
  sendSubscribe,
  formatTimeValue,
  buildAddressLine,
  clipCharacterString
}
