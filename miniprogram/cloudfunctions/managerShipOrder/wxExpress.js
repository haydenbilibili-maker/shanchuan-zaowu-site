/**
 * 微信物流消息 + 物流查询组件（共用同步）
 *
 * 官方文档：
 * - 查询组件 https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/industry/express/business/express_search.html
 *   插件仅 business 分包 app.json plugins.logisticsPlugin（provider wx9ad912bf20548d92；同 provider 不可多分包/根级重复声明）
 *   前端：requirePlugin('logisticsPlugin').openWaybillTracking({ waybillToken })
 *   店长端：跳转 logistics-track?token=…（勿在 manager 再声明同插件；勿走 C 端 order-detail 所有权校验）
 *   服务端：POST /cgi-bin/express/delivery/open_msg/trace_waybill → waybill_token
 * - 物流消息 https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/industry/express/business/express_open_msg.html
 *   服务端：POST /cgi-bin/express/delivery/open_msg/follow_waybill
 *   微信跟踪运单，在「已揽件 / 派件中 / 已签收」给下单用户推送服务通知
 *   查签收：query_follow_trace / query_trace → waybill_info.status（4 已签收 / 6 代签收）
 *
 * 平台开通（缺一则对应能力降级，店长发货本身仍成功）：
 * 1. 小程序 MP → 功能 → 物流服务 → 申请开通「物流消息」
 * 2. 小程序 MP → 功能 → 物流服务 → 申请开通「查询组件」
 * 3. MP → 设置 → 第三方设置 → 插件管理 → 添加「物流查询」wx9ad912bf20548d92
 *
 * 注意：「顺丰月结账号」配在 MP → 物流助手（电子面单下单），与本文件无关。
 * 本链路不读月结账号，只传已有运单号 + 微信支付交易号给查询组件/物流消息。
 *
 * 两接口均不支持云调用，需 HTTPS + access_token。
 * access_token 获取：优先 cloud.openapi.auth.getAccessToken（需开发者工具上传登记权限）；
 * 主回退：云函数环境变量 WX_APP_SECRET + APPID 调 /cgi-bin/token（官方推荐给非云调用接口用）。
 * 共用订单字段：waybill_id（运单号）、delivery_id（快递公司编码）、
 * trans_id（wxTransactionId）、receiver_phone、goods_info。
 */
const https = require('https')

const CARRIER_TO_DELIVERY_ID = {
  顺丰: 'SF',
  顺丰速运: 'SF',
  顺丰快递: 'SF',
  SF: 'SF',
  中通: 'ZTO',
  中通快递: 'ZTO',
  圆通: 'YTO',
  圆通速递: 'YTO',
  韵达: 'YD',
  韵达快递: 'YD',
  韵达速递: 'YD',
  申通: 'STO',
  申通快递: 'STO',
  极兔: 'JTSD',
  极兔速递: 'JTSD',
  京东: 'JD',
  京东物流: 'JD',
  京东快递: 'JD',
  邮政: 'EMS',
  邮政快递: 'EMS',
  EMS: 'EMS',
  中国邮政: 'EMS',
  德邦: 'DBL',
  德邦快递: 'DBL',
  德邦物流: 'DBL',
  菜鸟: 'CNSD',
  菜鸟速递: 'CNSD',
  百世: 'HTKY',
  百世快递: 'HTKY'
}

const FALLBACK_GOODS_IMG = 'https://www.qq.com'

/** waybill_info.status — 与微信物流消息文档一致 */
const WAYBILL_STATUS = {
  UNKNOWN: 0,
  PICKED_UP: 1,
  IN_TRANSIT: 2,
  OUT_FOR_DELIVERY: 3,
  SIGNED: 4,
  EXCEPTION: 5,
  PROXY_SIGNED: 6
}

const WAYBILL_STATUS_LABEL = {
  0: '未揽收',
  1: '已揽件',
  2: '运输中',
  3: '派件中',
  4: '已签收',
  5: '异常',
  6: '代签收'
}

function isWaybillDelivered(status) {
  const n = Number(status)
  return n === WAYBILL_STATUS.SIGNED || n === WAYBILL_STATUS.PROXY_SIGNED
}

function waybillStatusLabel(status) {
  const n = Number(status)
  if (Number.isFinite(n) && WAYBILL_STATUS_LABEL[n]) return WAYBILL_STATUS_LABEL[n]
  return ''
}

/** 进程内短期缓存，避免同一次发货/补同步重复打 token 接口 */
let _tokenCache = { token: '', expiresAt: 0 }

function requestWxJson(method, pathnameWithQuery, body) {
  const hasBody = body != null
  const data = hasBody ? JSON.stringify(body) : ''
  const headers = {}
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(data)
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.weixin.qq.com',
        path: pathnameWithQuery,
        method,
        headers
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch (e) {
            reject(new Error(raw || e.message))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy(new Error('微信物流接口超时'))
    })
    if (hasBody) req.write(data)
    req.end()
  })
}

function postWxJson(pathnameWithQuery, body) {
  return requestWxJson('POST', pathnameWithQuery, body || {})
}

function pickToken(res) {
  if (!res || typeof res !== 'object') return ''
  return res.accessToken || res.access_token || ''
}

function formatOpenApiErr(err) {
  if (!err) return 'unknown'
  const code = err.errCode != null ? err.errCode : err.errcode
  const msg = err.errMsg || err.errmsg || err.message || String(err)
  return code != null ? `${code} ${msg}` : msg
}

function readAppSecret() {
  return String(
    process.env.WX_APP_SECRET ||
      process.env.WECHAT_APP_SECRET ||
      process.env.APP_SECRET ||
      ''
  ).trim()
}

function readAppId(cloud) {
  try {
    const ctx = cloud && typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : null
    if (ctx && ctx.APPID) return String(ctx.APPID).trim()
  } catch (e) {
    /* ignore */
  }
  // project.config.json appid（公开信息，作无登录态触发时的回退）
  return String(process.env.WX_APPID || process.env.APPID || 'wxf2550373b010b447').trim()
}

/**
 * 物流 open_msg 接口不支持云调用，必须带 access_token 走 HTTPS。
 * 优先尝试云调用 auth.getAccessToken（部分环境可用）；失败则用环境变量 AppSecret 换 token。
 * 注意：官方文档标注 getAccessToken「不支持云调用」，故 AppSecret 回退是主路径。
 */
async function getAccessToken(cloud) {
  const now = Date.now()
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60 * 1000) {
    return _tokenCache.token
  }

  const errors = []

  // 1) 云调用（若已用微信开发者工具上传并登记 permissions.openapi: auth.getAccessToken）
  try {
    if (cloud && cloud.openapi && cloud.openapi.auth && typeof cloud.openapi.auth.getAccessToken === 'function') {
      const res = await cloud.openapi.auth.getAccessToken({})
      const token = pickToken(res)
      if (token) {
        const ttlSec = Number(res.expiresIn || res.expires_in || 7200) || 7200
        _tokenCache = { token, expiresAt: now + ttlSec * 1000 }
        return token
      }
      errors.push('openapi.auth.getAccessToken: empty token')
    } else {
      errors.push('openapi.auth.getAccessToken: unavailable')
    }
  } catch (err) {
    console.warn('[wxExpress] openapi getAccessToken', formatOpenApiErr(err))
    errors.push(`openapi:${formatOpenApiErr(err)}`)
  }

  // 2) AppSecret HTTPS（物流轨迹主路径；密钥仅放云函数环境变量，勿写入代码仓）
  const appid = readAppId(cloud)
  const secret = readAppSecret()
  if (!secret) {
    throw new Error(
      '无法获取 access_token：物流轨迹接口需 access_token，请在云函数 managerShipOrder 环境变量配置 WX_APP_SECRET（小程序 AppSecret）。' +
        (errors.length ? ` 云调用尝试：${errors.join(' | ')}` : '')
    )
  }
  if (!appid) {
    throw new Error('无法获取 access_token：缺少 APPID')
  }

  try {
    const tokenRes = await requestWxJson(
      'GET',
      `/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`,
      null
    )
    const token = pickToken(tokenRes)
    if (token) {
      const ttlSec = Number(tokenRes.expires_in || tokenRes.expiresIn || 7200) || 7200
      _tokenCache = { token, expiresAt: now + ttlSec * 1000 }
      return token
    }
    const detail = tokenRes.errcode
      ? `${tokenRes.errcode} ${tokenRes.errmsg || ''}`.trim()
      : 'empty token'
    throw new Error(detail)
  } catch (err) {
    const detail = (err && err.message) || String(err)
    throw new Error(
      `无法获取 access_token（AppSecret 换票失败：${detail}）。若公众平台开启了 IP 白名单，请关闭或放行云函数出口 IP；并确认 AppSecret 未冻结。`
    )
  }
}

function resolveDeliveryId(carrier) {
  const raw = String(carrier || '').trim()
  if (!raw) return ''
  if (CARRIER_TO_DELIVERY_ID[raw]) return CARRIER_TO_DELIVERY_ID[raw]
  const compact = raw.replace(/\s/g, '')
  if (CARRIER_TO_DELIVERY_ID[compact]) return CARRIER_TO_DELIVERY_ID[compact]
  const hit = Object.keys(CARRIER_TO_DELIVERY_ID).find((k) => compact.indexOf(k) !== -1)
  return hit ? CARRIER_TO_DELIVERY_ID[hit] : ''
}

/** 11111… / 全相同字符等占位单号，微信轨迹接口必然失败 */
function looksLikePlaceholderTracking(trackingNumber) {
  const s = String(trackingNumber || '')
    .trim()
    .replace(/\s/g, '')
  if (!s || s.length < 6) return true
  if (/^(.)\1+$/.test(s)) return true
  if (/^0+$/.test(s) || /^1{8,}$/.test(s) || /^9{8,}$/.test(s)) return true
  if (/^(test|testing|demo|temp|placeholder|假单号|测试)/i.test(s)) return true
  return false
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length >= 11) return digits.slice(-11)
  return digits
}

function isHttpsUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

async function toHttpsUrl(cloud, url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (isHttpsUrl(s)) return s
  if (s.indexOf('cloud://') !== 0) return ''
  try {
    const res = await cloud.getTempFileURL({ fileList: [s] })
    const item = res.fileList && res.fileList[0]
    return (item && item.tempFileURL) || ''
  } catch (err) {
    console.warn('[wxExpress] getTempFileURL', (err && err.message) || err)
    return ''
  }
}

async function buildGoodsInfo(cloud, products) {
  const src = Array.isArray(products) ? products.slice(0, 5) : []
  const detail_list = []
  for (const p of src) {
    const name = String((p && (p.title || p.name || p.goodsName)) || '').trim().slice(0, 40)
    const img = await toHttpsUrl(cloud, p && (p.image || p.cover || p.img))
    detail_list.push({
      goods_name: name || '山海造物藏品',
      goods_img_url: img || FALLBACK_GOODS_IMG
    })
  }
  if (!detail_list.length) {
    detail_list.push({
      goods_name: '山海造物藏品',
      goods_img_url: FALLBACK_GOODS_IMG
    })
  }
  return { detail_list }
}

function permissionDenied(res) {
  const errcode = res && res.errcode
  const errmsg = String((res && res.errmsg) || '')
  return (
    errcode === 48001 ||
    errcode === 41001 ||
    errcode === 40001 ||
    /unauthorized|no permission|access_token|未授权|没有权限|未开通/i.test(errmsg)
  )
}

function buildPayload(order, { trackingNumber, deliveryId, goodsInfo }) {
  const addr = order.address || {}
  const openid = order._openid || order.openid
  const transId = String(order.wxTransactionId || order.transactionId || order.transaction_id || '').trim()
  const receiverPhone = normalizePhone(addr.phone || addr.mobile || addr.tel)
  return {
    openid,
    waybill_id: trackingNumber,
    trans_id: transId,
    receiver_phone: receiverPhone,
    delivery_id: deliveryId || undefined,
    order_detail_path: `subpackages/business/order-detail/index?id=${order._id}`,
    goods_info: goodsInfo
  }
}

async function callOpenMsg(accessToken, apiName, payload) {
  const clean = {}
  Object.keys(payload).forEach((k) => {
    if (payload[k] !== undefined && payload[k] !== '') clean[k] = payload[k]
  })
  const res = await postWxJson(
    `/cgi-bin/express/delivery/open_msg/${apiName}?access_token=${encodeURIComponent(accessToken)}`,
    clean
  )
  return res || {}
}

/**
 * 向微信同步运单：物流消息 follow_waybill + 查询组件 trace_waybill
 * @returns {{ status: string, waybillToken: string, followWaybillToken: string, skipReason?: string, error?: string, details: object }}
 */
async function syncWxExpress(cloud, order, { carrier, trackingNumber } = {}) {
  const tracking = String(trackingNumber || (order.logistics && order.logistics.trackingNumber) || '')
    .trim()
    .replace(/\s/g, '')
  const carrierName = String(carrier || (order.logistics && order.logistics.carrier) || '').trim()
  const deliveryId = resolveDeliveryId(carrierName)
  const openid = order._openid || order.openid
  const transId = String(order.wxTransactionId || order.transactionId || order.transaction_id || '').trim()
  const receiverPhone = normalizePhone((order.address && (order.address.phone || order.address.mobile)) || '')

  if (!openid) {
    return { status: 'skipped', waybillToken: '', followWaybillToken: '', skipReason: 'missing_openid', details: {} }
  }
  if (!tracking || tracking.length < 6) {
    return { status: 'skipped', waybillToken: '', followWaybillToken: '', skipReason: 'missing_waybill', details: {} }
  }
  if (looksLikePlaceholderTracking(tracking)) {
    return {
      status: 'skipped',
      waybillToken: '',
      followWaybillToken: '',
      skipReason: 'placeholder_waybill',
      error: '运单号疑似占位/测试单号，无法查询官方轨迹；请填写真实顺丰运单号',
      details: {}
    }
  }
  if (!transId) {
    // 模拟支付 / 未回写微信支付单号时无法调官方接口
    return {
      status: 'skipped',
      waybillToken: '',
      followWaybillToken: '',
      skipReason: 'missing_trans_id',
      error: '缺少 wxTransactionId。需真实微信支付回写交易单号后才能开通物流消息/查询组件',
      details: {}
    }
  }
  if (!receiverPhone || receiverPhone.length < 7) {
    return {
      status: 'skipped',
      waybillToken: '',
      followWaybillToken: '',
      skipReason: 'missing_receiver_phone',
      details: {}
    }
  }

  let accessToken
  try {
    accessToken = await getAccessToken(cloud)
  } catch (err) {
    return {
      status: 'failed',
      waybillToken: '',
      followWaybillToken: '',
      skipReason: 'access_token',
      error: err.message || String(err),
      details: {}
    }
  }

  const goodsInfo = await buildGoodsInfo(cloud, order.products)
  const payload = buildPayload(order, { trackingNumber: tracking, deliveryId, goodsInfo })
  const details = {}

  let followToken = ''
  let traceToken = ''
  const errors = []

  try {
    const followRes = await callOpenMsg(accessToken, 'follow_waybill', payload)
    details.follow_waybill = { errcode: followRes.errcode, errmsg: followRes.errmsg }
    if (!followRes.errcode && followRes.waybill_token) {
      followToken = followRes.waybill_token
    } else if (permissionDenied(followRes)) {
      details.follow_waybill.needOpen = 'MP → 功能 → 物流服务 → 申请开通「物流消息」'
      errors.push(`follow_waybill:${followRes.errcode || ''} ${followRes.errmsg || '未开通物流消息'}`)
    } else {
      errors.push(`follow_waybill:${followRes.errcode || ''} ${followRes.errmsg || '失败'}`)
    }
  } catch (err) {
    errors.push(`follow_waybill:${err.message || err}`)
  }

  try {
    const traceRes = await callOpenMsg(accessToken, 'trace_waybill', payload)
    details.trace_waybill = { errcode: traceRes.errcode, errmsg: traceRes.errmsg }
    if (!traceRes.errcode && traceRes.waybill_token) {
      traceToken = traceRes.waybill_token
    } else if (permissionDenied(traceRes)) {
      details.trace_waybill.needOpen = 'MP → 功能 → 物流服务 → 申请开通「查询组件」，并添加插件 wx9ad912bf20548d92'
      errors.push(`trace_waybill:${traceRes.errcode || ''} ${traceRes.errmsg || '未开通查询组件'}`)
    } else {
      errors.push(`trace_waybill:${traceRes.errcode || ''} ${traceRes.errmsg || '失败'}`)
    }
  } catch (err) {
    errors.push(`trace_waybill:${err.message || err}`)
  }

  const waybillToken = traceToken || followToken
  const followWaybillToken = followToken || traceToken
  let status = 'failed'
  if (traceToken && followToken) status = 'ok'
  else if (traceToken || followToken) status = 'partial'
  else if (errors.length && errors.every((e) => /未开通|48001/.test(e))) status = 'skipped'

  return {
    status,
    waybillToken,
    followWaybillToken,
    deliveryId,
    skipReason: status === 'ok' ? '' : (errors[0] || ''),
    error: errors.join(' | '),
    details
  }
}

function logisticsPatchFromSync(syncRes) {
  if (!syncRes) return {}
  return {
    deliveryId: syncRes.deliveryId || '',
    waybillToken: syncRes.waybillToken || '',
    followWaybillToken: syncRes.followWaybillToken || '',
    wxExpressStatus: syncRes.status || 'failed',
    wxExpressSkipReason: syncRes.skipReason || '',
    wxExpressError: syncRes.error || ''
  }
}

/** 运维探测：只返回能否取到 token，不回传明文 */
async function probeAccessToken(cloud) {
  try {
    const token = await getAccessToken(cloud)
    return {
      ok: !!token,
      hasAppSecret: !!readAppSecret(),
      appId: readAppId(cloud) || '',
      tokenLen: token ? String(token).length : 0
    }
  } catch (err) {
    return {
      ok: false,
      hasAppSecret: !!readAppSecret(),
      appId: readAppId(cloud) || '',
      error: (err && err.message) || String(err)
    }
  }
}

/**
 * 查询运单物流状态（优先物流消息 query_follow_trace，回退查询组件 query_trace）
 * @returns {{ ok: boolean, status: number|null, statusLabel: string, waybillId: string, api: string, errcode?: number, errmsg?: string, error?: string }}
 */
async function queryWaybillTrace(cloud, { waybillToken, openid } = {}) {
  const token = String(waybillToken || '').trim()
  if (!token) {
    return { ok: false, status: null, statusLabel: '', waybillId: '', api: '', error: 'missing_waybill_token' }
  }

  let accessToken
  try {
    accessToken = await getAccessToken(cloud)
  } catch (err) {
    return {
      ok: false,
      status: null,
      statusLabel: '',
      waybillId: '',
      api: '',
      error: (err && err.message) || String(err)
    }
  }

  const payload = { waybill_token: token }
  const oid = String(openid || '').trim()
  if (oid) payload.openid = oid

  const tryApi = async (apiName) => {
    const res = await callOpenMsg(accessToken, apiName, payload)
    const info = (res && res.waybill_info) || {}
    const status =
      info.status !== undefined && info.status !== null && info.status !== ''
        ? Number(info.status)
        : null
    return {
      ok: !res.errcode && status !== null && Number.isFinite(status),
      status: Number.isFinite(status) ? status : null,
      statusLabel: waybillStatusLabel(status),
      waybillId: String(info.waybill_id || ''),
      api: apiName,
      errcode: res.errcode || 0,
      errmsg: res.errmsg || '',
      raw: res
    }
  }

  try {
    const follow = await tryApi('query_follow_trace')
    if (follow.ok) return follow
    // token 来自 trace_waybill 时走查询组件接口
    const trace = await tryApi('query_trace')
    if (trace.ok) return trace
    return follow.errcode || follow.error ? follow : trace
  } catch (err) {
    return {
      ok: false,
      status: null,
      statusLabel: '',
      waybillId: '',
      api: '',
      error: (err && err.message) || String(err)
    }
  }
}

module.exports = {
  resolveDeliveryId,
  looksLikePlaceholderTracking,
  syncWxExpress,
  logisticsPatchFromSync,
  probeAccessToken,
  queryWaybillTrace,
  isWaybillDelivered,
  waybillStatusLabel,
  WAYBILL_STATUS
}
