const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { buildMemberNo } = require('./profileUtil')
const { assertStaff } = require('./staffGuard')
const { loadMemberLevels, resolveMemberLevel } = require('./memberLevels')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TTL_MS = 60 * 1000

function toExpiryMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function parseToken(event) {
  const direct = String((event && event.token) || '').trim()
  if (direct) return direct
  const raw = String((event && (event.qrPayload || event.raw || event.scanResult)) || '').trim()
  if (!raw) return ''
  if (raw[0] === '{') {
    try {
      const obj = JSON.parse(raw)
      return String((obj && obj.token) || '').trim()
    } catch (e) {
      return ''
    }
  }
  const uri = raw.match(/[?&]token=([A-Za-z0-9_-]+)/)
  return uri ? uri[1] : ''
}

function parsePreferredCouponId(event) {
  return String(
    (event && (event.preferredCouponId || event.userCouponId || event.selectedCouponId)) || ''
  ).trim()
}

function couponOwnedBy(coupon, openid) {
  if (!coupon || !openid) return false
  const owner = String(coupon._openid || coupon.openid || '').trim()
  return owner === openid
}

/**
 * 可选：校验亮码时带入的券归属当前用户且仍可用（校验失败不阻断发码，仅丢弃意向）
 */
async function resolvePreferredCouponId(openid, couponId) {
  const id = String(couponId || '').trim()
  if (!openid || !id) return ''
  try {
    const doc = await db.collection('user_coupons').doc(id).get()
    const coupon = doc && doc.data
    if (!coupon || !couponOwnedBy(coupon, openid)) return ''
    const status = String(coupon.status || '').trim().toLowerCase()
    if (status && status !== 'unused' && status !== 'available') return ''
    return id
  } catch (e) {
    return ''
  }
}

async function issueMemberPass(openid, event) {
  if (!openid) return { success: false, msg: '未登录' }

  const token = crypto.randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + TTL_MS)
  const memberNo = buildMemberNo(openid)
  const preferredCouponId = await resolvePreferredCouponId(openid, parsePreferredCouponId(event))

  try {
    const data = {
      openid,
      token,
      memberNo,
      expiresAt,
      createdAt: db.serverDate()
    }
    if (preferredCouponId) data.preferredCouponId = preferredCouponId
    await db.collection('member_pass_tokens').add({ data })
  } catch (e) {
    console.error('getMemberPass persist', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: '会员码服务未就绪' }
    }
    return { success: false, msg: e.message || '会员码生成失败' }
  }

  const qrPayload = JSON.stringify({
    v: 1,
    token,
    memberNo
  })

  return {
    success: true,
    token,
    memberNo,
    preferredCouponId: preferredCouponId || '',
    qrPayload,
    expiresIn: 60,
    expiresAt: expiresAt.getTime()
  }
}

async function sumPaidGrowth(memberOpenid) {
  const PAGE = 100
  const MAX_PAGES = 60
  let totalAmount = 0
  try {
    let skip = 0
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await db.collection('orders')
        .where({
          _openid: memberOpenid,
          status: _.in(['paid', 'shipped', 'received'])
        })
        .orderBy('createTime', 'asc')
        .skip(skip)
        .limit(PAGE)
        .get()
      const rows = res.data || []
      rows.forEach((order) => {
        if (order.source === 'exchange') return
        const raw = order.growthAmount != null && order.growthAmount !== ''
          ? order.growthAmount
          : order.totalPrice
        if (raw == null || raw === '') return
        const price = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
        if (!isNaN(price)) totalAmount += price
      })
      if (rows.length < PAGE) break
      skip += rows.length
    }
  } catch (e) {
    return Math.floor(totalAmount)
  }
  return Math.floor(totalAmount)
}

async function verifyMemberPass(event, operatorOpenid) {
  if (!operatorOpenid) return { success: false, msg: '未登录' }
  const guard = await assertStaff(db, operatorOpenid, { permission: 'verifyMemberPass' })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const token = parseToken(event)
  if (!token) return { success: false, valid: false, msg: '未识别到会员码' }

  let rec = null
  try {
    const res = await db.collection('member_pass_tokens').where({ token }).limit(1).get()
    rec = res.data && res.data[0]
  } catch (e) {
    return { success: false, msg: '会员码服务未就绪' }
  }

  if (!rec) {
    return { success: true, valid: false, expired: false, msg: '会员码无效，请让顾客刷新' }
  }

  if (String(rec.redeemStatus || '') === 'done') {
    return {
      success: true,
      valid: false,
      expired: false,
      redeemed: true,
      memberNo: rec.memberNo || buildMemberNo(rec.openid),
      preferredCouponId: String(rec.redeemedCouponId || rec.preferredCouponId || '').trim(),
      msg: '该码对应门店券已核销'
    }
  }

  const expired = Date.now() > toExpiryMs(rec.expiresAt)
  if (expired) {
    return {
      success: true,
      valid: false,
      expired: true,
      memberNo: rec.memberNo || buildMemberNo(rec.openid),
      msg: '会员码已过期，请让顾客刷新'
    }
  }

  let userInfo = null
  try {
    const userRes = await db.collection('users').where({ _openid: rec.openid }).limit(1).get()
    userInfo = (userRes.data && userRes.data[0]) || null
  } catch (e) {
    userInfo = null
  }

  const orderGrowth = await sumPaidGrowth(rec.openid)
  const storeGrowth = Math.max(0, Math.floor(Number(userInfo && userInfo.storeGrowthValue) || 0))
  const growthValue = orderGrowth + storeGrowth
  const { levels } = await loadMemberLevels(db)
  const level = resolveMemberLevel(
    levels,
    growthValue,
    !!(userInfo && userInfo.isHonorary),
    userInfo && userInfo.levelOverride
  )
  const memberNo = rec.memberNo || buildMemberNo(rec.openid)

  try {
    await db.collection('member_pass_tokens').doc(rec._id).update({
      data: {
        lastVerifiedAt: db.serverDate(),
        lastVerifiedBy: operatorOpenid
      }
    })
  } catch (e) { /* ignore */ }

  const preferredCouponId = String(rec.preferredCouponId || '').trim()

  return {
    success: true,
    valid: true,
    expired: false,
    memberNo,
    memberOpenid: rec.openid || '',
    preferredCouponId,
    nickName: (userInfo && userInfo.nickName) || '藏家',
    level: level.level,
    levelName: level.levelName,
    discountRate: level.discountRate,
    growthValue,
    storeGrowthValue: storeGrowth,
    msg: preferredCouponId ? '核验通过 · 顾客已选券' : '核验通过'
  }
}

function buildRedeemedPayload(source, fields) {
  return {
    success: true,
    redeemed: true,
    source,
    userCouponId: fields.userCouponId || '',
    title: fields.title || '代金券',
    value: Number(fields.value) || 0,
    usedStoreId: fields.usedStoreId || '',
    msg: '门店券已核销'
  }
}

/**
 * 顾客亮码页短轮询：检测门店券是否已被核销。
 * 1) user_coupons 按券 ID（跨 60s 换码仍可靠，主路径）
 * 2) 当前 token 的 redeemStatus
 * 3) 同会员近期 token 上的 redeem 标记（换码 / preferred 未写入时兜底）
 */
async function pollRedeem(openid, event) {
  if (!openid) return { success: false, msg: '未登录' }

  const preferredCouponId = parsePreferredCouponId(event)
  const token = parseToken(event)

  if (preferredCouponId) {
    try {
      const doc = await db.collection('user_coupons').doc(preferredCouponId).get()
      const coupon = doc && doc.data
      if (coupon && couponOwnedBy(coupon, openid)) {
        const status = String(coupon.status || '').trim().toLowerCase()
        // 亮码页盯的就是这张券：只要已 used 即视为核销成功（不依赖 usedChannel 字段是否写全）
        if (status === 'used') {
          return buildRedeemedPayload('coupon', {
            userCouponId: preferredCouponId,
            title: coupon.title || coupon.name || '代金券',
            value: Number(coupon.value) || 0,
            usedStoreId: coupon.usedStoreId || ''
          })
        }
      }
    } catch (e) { /* fall through */ }
  }

  const tokenDoneToPayload = (rec, source) => {
    if (!rec || String(rec.redeemStatus || '') !== 'done') return null
    return buildRedeemedPayload(source, {
      userCouponId: rec.redeemedCouponId || preferredCouponId || '',
      title: rec.redeemedTitle || '代金券',
      value: Number(rec.redeemedValue) || 0,
      usedStoreId: rec.redeemedStoreId || ''
    })
  }

  if (token) {
    try {
      const res = await db.collection('member_pass_tokens')
        .where({ token, openid })
        .limit(1)
        .get()
      const hit = tokenDoneToPayload((res.data && res.data[0]) || null, 'token')
      if (hit) return hit
    } catch (e) { /* ignore */ }
  }

  // 兜底：当前 token 已换掉时，按 openid（+ 可选券 ID）找近期已核销标记
  // 仅认 5 分钟内的标记，避免再开亮码命中历史核销
  const RECENT_REDEEM_MS = 5 * 60 * 1000
  const isRecentRedeem = (rec) => {
    const t = toExpiryMs(rec && (rec.redeemedAt || rec.lastVerifiedAt || rec.expiresAt))
    return t > 0 && Date.now() - t <= RECENT_REDEEM_MS
  }
  try {
    const res = await db.collection('member_pass_tokens')
      .where({ openid, redeemStatus: 'done' })
      .orderBy('redeemedAt', 'desc')
      .limit(5)
      .get()
    const rows = res.data || []
    for (let i = 0; i < rows.length; i++) {
      const rec = rows[i]
      if (!rec || !isRecentRedeem(rec)) continue
      const redeemedId = String(rec.redeemedCouponId || rec.preferredCouponId || '').trim()
      if (preferredCouponId && redeemedId && redeemedId !== preferredCouponId) continue
      const hit = tokenDoneToPayload(rec, 'token_recent')
      if (hit) return hit
    }
  } catch (e) {
    // redeemedAt 无索引时降级：不带 orderBy
    try {
      const res = await db.collection('member_pass_tokens')
        .where({ openid, redeemStatus: 'done' })
        .limit(8)
        .get()
      const rows = res.data || []
      for (let i = 0; i < rows.length; i++) {
        const rec = rows[i]
        if (!rec || !isRecentRedeem(rec)) continue
        const redeemedId = String(rec.redeemedCouponId || rec.preferredCouponId || '').trim()
        if (preferredCouponId && redeemedId && redeemedId !== preferredCouponId) continue
        const hit = tokenDoneToPayload(rec, 'token_recent')
        if (hit) return hit
      }
    } catch (e2) { /* ignore */ }
  }

  return { success: true, redeemed: false }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = (event && event.action) || 'issue'

  try {
    if (action === 'verify') return await verifyMemberPass(event, openid)
    if (action === 'pollRedeem' || action === 'checkRedeem') {
      return await pollRedeem(openid, event)
    }
    return await issueMemberPass(openid, event)
  } catch (e) {
    console.error('getMemberPass', e)
    return { success: false, msg: e.message || (action === 'verify' ? '核验失败' : '会员码生成失败') }
  }
}
