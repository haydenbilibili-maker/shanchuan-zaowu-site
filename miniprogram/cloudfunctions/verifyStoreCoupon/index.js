/**
 * 门店代金券核销（与预约核销 verifyBooking 分离）
 *
 * action:
 *   listByMember — 扫会员码后列出该会员门店可用券
 *   redeem       — 核销一张门店可用券（消耗 status→used）
 *                  若填写了消费金额(>0)，成功后联动 grantStorePoints 提交线下消费积分
 *                  （核销来源一律 pending_approval，店长审核通过后才入账；不因操作者是店长而直通）
 *
 * 权限：verifyStoreCoupon（现场工作台核销）
 * 失败策略：券核销优先；积分申请失败不回滚核销，返回 pointsGrantFailed 供前端提示补录
 */
const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')
const { normalizeCouponChannel, couponChannelAllows } = require('./couponChannel')
const { validateCashCoupon, maxCashSaveForAmount } = require('./couponDiscountRules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const USER_COUPONS = 'user_coupons'
const TOKENS = 'member_pass_tokens'
const REDEEM_LOGS = 'store_coupon_redeems'

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

/** 小票附图 fileID，最多 3 张 */
function normalizeReceiptImages(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = {}
  raw.forEach((item) => {
    const id = String(item || '').trim()
    if (!id || seen[id]) return
    if (!/^cloud:\/\//.test(id) && !/^https?:\/\//i.test(id)) return
    seen[id] = true
    out.push(id)
  })
  return out.slice(0, 3)
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function parseMinSpend(coupon) {
  if (!coupon) return 0
  const raw = coupon.minSpend != null && coupon.minSpend !== ''
    ? coupon.minSpend
    : coupon.min_spend
  if (raw != null && raw !== '') {
    const n = parseFloat(raw)
    if (!Number.isNaN(n)) return n
  }
  if (coupon.condition) {
    const n = parseFloat(String(coupon.condition).replace(/[^0-9.]/g, ''))
    if (!Number.isNaN(n)) return n
  }
  return 0
}

function isUsableStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  return !s || s === 'unused' || s === 'available'
}

function isUnexpired(coupon, now) {
  const raw = coupon && (coupon.expireTime || coupon.expire_time || coupon.validUntil)
  if (!raw) return true
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return true
  return t > now
}

function parseToken(event) {
  const direct = String((event && (event.memberToken || event.token)) || '').trim()
  if (direct) return direct
  const raw = String((event && (event.qrPayload || event.scanResult || event.code)) || '').trim()
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

function parseCouponRef(event) {
  const id = String((event && (event.userCouponId || event.couponId)) || '').trim()
  if (id) return id
  const raw = String((event && (event.qrPayload || event.scanResult || event.code)) || '').trim()
  if (!raw) return ''
  const m = raw.match(/^COUPON:([A-Za-z0-9_-]+)/i)
  return m ? m[1].trim() : ''
}

async function resolveMemberByToken(token) {
  if (!token) return { ok: false, msg: '未识别到会员码' }
  let rec = null
  try {
    const res = await db.collection(TOKENS).where({ token }).limit(1).get()
    rec = (res.data && res.data[0]) || null
  } catch (e) {
    return { ok: false, msg: '会员码服务未就绪' }
  }
  if (!rec) return { ok: false, msg: '会员码无效，请让顾客刷新' }
  if (String(rec.redeemStatus || '') === 'done') {
    return {
      ok: false,
      redeemed: true,
      msg: '该码对应门店券已核销',
      openid: rec.openid,
      memberNo: rec.memberNo || '',
      preferredCouponId: String(rec.redeemedCouponId || rec.preferredCouponId || '').trim()
    }
  }
  if (Date.now() > toMs(rec.expiresAt)) {
    return { ok: false, expired: true, msg: '会员码已过期（60 秒有效），请让顾客刷新' }
  }
  return {
    ok: true,
    openid: rec.openid,
    memberNo: rec.memberNo || '',
    preferredCouponId: String(rec.preferredCouponId || '').trim()
  }
}

function mapCouponRow(c, now) {
  const channel = normalizeCouponChannel(c.channel)
  const minSpend = parseMinSpend(c)
  const expireRaw = c.expireTime || c.expire_time || c.validUntil
  let expireDate = ''
  if (expireRaw) {
    const d = new Date(expireRaw)
    if (!Number.isNaN(d.getTime())) {
      expireDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  return {
    _id: c._id,
    title: c.title || c.name || '代金券',
    type: c.type || 'cash',
    value: Number(c.value) || 0,
    minSpend,
    channel,
    channelLabel: channel === 'store' ? '仅门店' : (channel === 'all' ? '线上+门店' : '仅线上'),
    expireDate,
    status: c.status || 'unused',
    canRedeem: isUsableStatus(c.status) && isUnexpired(c, now) && couponChannelAllows(channel, 'store')
  }
}

/**
 * 核销成功后联动线下消费积分（复用 grantStorePoints 全链路）。
 * 幂等键：receiptNo = COUPON:{userCouponId} → store_purchases.dedupeKey
 * 无金额或金额≤0：不提交。
 */
async function submitPointsFromRedeem(opts) {
  const amount = opts && opts.amount
  if (amount == null || !(Number(amount) > 0)) {
    return { skipped: true, reason: 'no_amount' }
  }
  const userCouponId = String((opts && opts.userCouponId) || '').trim()
  const memberOpenid = String((opts && opts.memberOpenid) || '').trim()
  const storeId = String((opts && opts.storeId) || '').trim()
  const operatorOpenid = String((opts && opts.operatorOpenid) || '').trim()
  if (!userCouponId || !memberOpenid || !storeId || !operatorOpenid) {
    return { success: false, msg: '积分申请参数不完整' }
  }
  const receiptImages = normalizeReceiptImages(opts && opts.receiptImages)
  if (!receiptImages.length) {
    return { success: false, msg: '请上传小票照片后再提交积分' }
  }

  try {
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: {
        action: 'grant',
        storeId,
        storeName: String((opts && opts.storeName) || '').trim(),
        amount: Number(amount),
        targetOpenid: memberOpenid,
        identifyMethod: 'coupon_redeem',
        // 同一券核销只产生一笔赠分申请
        receiptNo: `COUPON:${userCouponId}`.slice(0, 40),
        clientRequestId: `coupon_redeem:${userCouponId}`,
        remark: `门店券核销·${String((opts && opts.title) || '').trim()}`.slice(0, 200),
        userCouponId,
        receiptImages,
        imageFileIds: receiptImages,
        _fromCouponRedeem: true,
        forcePending: true,
        requireApproval: true,
        _callerOpenid: operatorOpenid
      }
    })
    return (res && res.result) || { success: false, msg: '积分申请无响应' }
  } catch (e) {
    console.warn('verifyStoreCoupon submitPointsFromRedeem:', e && e.message)
    return { success: false, msg: (e && e.message) || '积分申请失败' }
  }
}

function attachPointsGrantFields(base, pointsRes) {
  const out = { ...(base || {}) }
  // 主结论只保留核销成功文案；积分结果走独立字段，避免前端绿字与失败语义打架
  const redeemMsg = out.msg || '核销成功'
  out.msg = redeemMsg
  if (!pointsRes || pointsRes.skipped) {
    out.pointsGrantSubmitted = false
    out.pointsGrantSkipped = true
    out.pointsGrantPending = false
    out.pointsGrantFailed = false
    out.pointsGranted = 0
    out.previewPoints = 0
    out.purchaseId = ''
    out.pointsGrantMsg = ''
    out.pointsGrantTip = ''
    return out
  }
  const ok = !!pointsRes.success
  const pending = ok && !!pointsRes.pendingApproval
  const preview = Number(pointsRes.previewPoints != null
    ? pointsRes.previewPoints
    : pointsRes.pointsGranted) || 0
  out.pointsGrantSubmitted = ok
  out.pointsGrantSkipped = false
  out.pointsGrantPending = pending
  out.pointsGrantFailed = !ok
  out.pointsGranted = ok && !pending
    ? (Number(pointsRes.pointsGranted) || Number(pointsRes.previewPoints) || 0)
    : 0
  out.previewPoints = preview
  out.purchaseId = ok ? (pointsRes.purchaseId || '') : ''
  out.pointsGrantMsg = pointsRes.msg || (ok
    ? (pending
      ? (preview > 0 ? `积分已提交待店长审核（预计 +${preview}）` : '积分已提交待店长审核')
      : '积分已提交')
    : '积分申请失败，可到消费赠分补录')
  out.pointsGrantTip = ok ? '' : (pointsRes.msg || '')
  return out
}

async function listByMember(event, openid, guard) {
  const storeId = String((event && event.storeId) || '').trim()
  if (!storeId) return fail('请先选择门店')

  // 优先 token；核验通过后可传 memberOpenid（避免二次读 token 过期）
  let memberOpenid = String((event && event.memberOpenid) || '').trim()
  let memberNo = ''
  let preferredCouponId = String((event && event.preferredCouponId) || '').trim()
  const token = parseToken(event)
  if (token) {
    const resolved = await resolveMemberByToken(token)
    if (!memberOpenid) {
      if (!resolved.ok) {
        return fail(resolved.msg || '会员码无效', { expired: !!resolved.expired })
      }
      memberOpenid = resolved.openid
      memberNo = resolved.memberNo || ''
    }
    if (!preferredCouponId && resolved.ok) {
      preferredCouponId = resolved.preferredCouponId || ''
    }
  }
  if (!memberOpenid) {
    return fail('未识别到会员码')
  }

  const now = new Date()
  let rows = []
  try {
    const res = await db.collection(USER_COUPONS)
      .where({ _openid: memberOpenid })
      .limit(100)
      .get()
    rows = res.data || []
  } catch (e) {
    console.error('verifyStoreCoupon list', e)
    return fail('读取券夹失败')
  }

  const coupons = rows
    .map((c) => mapCouponRow(c, now))
    .filter((c) => c.canRedeem)
    .sort((a, b) => (b.value || 0) - (a.value || 0))

  // 顾客亮码时选定的券：仅当仍在可核销列表中才带回
  const preferredInList = preferredCouponId
    ? coupons.find((c) => c._id === preferredCouponId)
    : null
  const resolvedPreferredId = preferredInList ? preferredInList._id : ''
  const preselectedCoupon = preferredInList
    ? {
        _id: preferredInList._id,
        title: preferredInList.title,
        value: preferredInList.value,
        minSpend: preferredInList.minSpend,
        channel: preferredInList.channel,
        channelLabel: preferredInList.channelLabel
      }
    : null

  return {
    success: true,
    kind: 'store_coupon',
    kindLabel: '门店代金券 · 核销消耗',
    memberOpenid,
    memberNo,
    storeId,
    operatorName: (guard.actor && guard.actor.name) || '',
    preferredCouponId: resolvedPreferredId,
    preselectedCoupon,
    coupons,
    count: coupons.length,
    msg: coupons.length ? `共 ${coupons.length} 张门店可用券` : '该会员暂无门店可用券'
  }
}

async function redeem(event, openid, guard) {
  const storeId = String((event && event.storeId) || '').trim()
  if (!storeId) return fail('请先选择门店')

  const clientRequestId = String((event && event.clientRequestId) || '').trim()
  if (!clientRequestId) return fail('缺少请求标识，请重试')

  let userCouponId = parseCouponRef(event)
  let memberOpenid = String((event && event.memberOpenid) || '').trim()

  // 也可先扫会员码再选券；若只给了 token + userCouponId
  if (!memberOpenid) {
    const token = parseToken(event)
    if (token) {
      const resolved = await resolveMemberByToken(token)
      if (!resolved.ok) return fail(resolved.msg || '会员码无效', { expired: !!resolved.expired })
      memberOpenid = resolved.openid
    }
  }

  if (!userCouponId) return fail('请选择要核销的代金券')

  const amountRaw = event && event.amount
  const amount = amountRaw === '' || amountRaw == null
    ? null
    : Math.round((parseFloat(amountRaw) || 0) * 100) / 100
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    return fail('消费金额无效')
  }

  const receiptImages = normalizeReceiptImages(
    (event && (event.receiptImages || event.imageFileIds || event.images)) || []
  )
  // 填了消费金额则强制至少 1 张小票（无金额仅核销时选填，不传亦可）
  if (amount != null && amount > 0 && !receiptImages.length) {
    return fail('请上传小票照片后再提交消费金额')
  }

  // 幂等：同 clientRequestId 已核销则直接返回（仍尝试联动积分，靠 COUPON:id 去重）
  try {
    const dup = await db.collection(REDEEM_LOGS)
      .where({ dedupeKey: `store_coupon:${openid}:${clientRequestId}` })
      .limit(1)
      .get()
    const hit = dup.data && dup.data[0]
    if (hit && hit.status === 'done') {
      const hitAmount = hit.amount != null ? Number(hit.amount) : null
      const hitImages = normalizeReceiptImages(hit.receiptImages || hit.imageFileIds || receiptImages)
      const hitCouponId = hit.userCouponId || userCouponId
      const hitMemberOpenid = hit.memberOpenid || memberOpenid
      const hitStoreId = hit.storeId || storeId
      // 幂等重放也要回写 token，避免顾客亮码页一直等不到成功态
      await markPassTokensRedeemed({
        token: parseToken(event),
        memberOpenid: hitMemberOpenid,
        userCouponId: hitCouponId,
        title: hit.title || '',
        value: hit.value || 0,
        storeId: hitStoreId
      })
      const pointsRes = await submitPointsFromRedeem({
        amount: hitAmount,
        userCouponId: hitCouponId,
        memberOpenid: hitMemberOpenid,
        storeId: hitStoreId,
        storeName: hit.storeName || String((event && event.storeName) || '').trim(),
        title: hit.title || '',
        operatorOpenid: openid,
        receiptImages: hitImages
      })
      return attachPointsGrantFields({
        success: true,
        duplicated: true,
        userCouponId: hitCouponId,
        title: hit.title || '',
        value: hit.value || 0,
        amount: hitAmount,
        memberOpenid: hitMemberOpenid,
        storeId: hitStoreId,
        msg: '该核销已完成'
      }, pointsRes)
    }
  } catch (e) {
    // 集合未建时继续，redeem 时再写
  }

  let coupon = null
  try {
    const doc = await db.collection(USER_COUPONS).doc(userCouponId).get()
    coupon = doc.data
  } catch (e) {
    return fail('代金券不存在')
  }
  if (!coupon) return fail('代金券不存在')
  if (memberOpenid && coupon._openid !== memberOpenid) {
    return fail('券与会员不匹配')
  }
  memberOpenid = coupon._openid

  if (!isUsableStatus(coupon.status)) {
    if (String(coupon.status).toLowerCase() === 'used') {
      return fail('该券已核销过')
    }
    if (String(coupon.status).toLowerCase() === 'locked') {
      return fail('该券已被线上订单占用')
    }
    return fail('该券不可用')
  }
  if (!isUnexpired(coupon, new Date())) return fail('该券已过期')
  if (!couponChannelAllows(coupon, 'store')) {
    return fail('该券仅限线上商城使用，请在小程序下单抵扣')
  }

  const minSpend = parseMinSpend(coupon)
  if (amount != null && amount < minSpend) {
    return fail(`未达使用门槛（满 ${minSpend} 可用）`)
  }

  const value = Number(coupon.value) || 0
  const type = coupon.type || 'cash'
  if (type !== 'freeShipping' && type !== 'discount' && value > 0) {
    // 有消费金额时：相对本单不得低于 7.5 折；无金额时校验券档门槛
    if (amount != null && amount > 0) {
      const maxSave = maxCashSaveForAmount(amount)
      if (value > maxSave + 1e-9) {
        return fail(`优惠过猛：本单实付将低于7.5折（最多可减 ¥${maxSave}）`)
      }
    } else if (minSpend > 0) {
      const spendCheck = validateCashCoupon(value, minSpend)
      if (!spendCheck.ok) {
        return fail(spendCheck.msg || '该券门槛配置违规，请勿核销')
      }
    }
  }

  const title = coupon.title || coupon.name || '代金券'
  const remark = String((event && event.remark) || '').trim().slice(0, 200)

  const redeemPatch = {
    status: 'used',
    usedTime: db.serverDate(),
    usedChannel: 'store',
    usedStoreId: storeId,
    usedByStaff: openid,
    usedByStaffName: (guard.actor && guard.actor.name) || '',
    usedAmount: amount,
    usedRemark: remark || '',
    usedOrder: `STORE:${storeId}:${Date.now()}`
  }

  try {
    // 条件更新防并发双核销（与 makeOrder 锁券同模式）
    const lockRes = await db.collection(USER_COUPONS).where({
      _id: userCouponId,
      status: _.in(['unused', 'available'])
    }).update({ data: redeemPatch })
    const locked = lockRes && lockRes.stats
      ? Number(lockRes.stats.updated != null ? lockRes.stats.updated : lockRes.stats.updatedCount) || 0
      : 0

    if (locked <= 0) {
      // 兼容无 status / 空 status 的旧券
      const again = await db.collection(USER_COUPONS).doc(userCouponId).get()
      const fresh = again && again.data
      if (!fresh) return fail('代金券不存在')
      if (!isUsableStatus(fresh.status)) {
        if (String(fresh.status).toLowerCase() === 'used') return fail('该券已核销过')
        if (String(fresh.status).toLowerCase() === 'locked') return fail('该券已被线上订单占用')
        return fail('该券不可用')
      }
      await db.collection(USER_COUPONS).doc(userCouponId).update({ data: redeemPatch })
    }
  } catch (e) {
    console.error('verifyStoreCoupon update coupon', e)
    return fail('核销失败，请重试')
  }

  // 通知顾客亮码页：标记本会话 token（及同券近期 token），供 pollRedeem / 失效二维码
  const redeemToken = parseToken(event)
  await markPassTokensRedeemed({
    token: redeemToken,
    memberOpenid,
    userCouponId,
    title,
    value,
    storeId
  })

  try {
    await db.collection(REDEEM_LOGS).add({
      data: {
        dedupeKey: `store_coupon:${openid}:${clientRequestId}`,
        status: 'done',
        userCouponId,
        memberOpenid,
        storeId,
        storeName: String((event && event.storeName) || '').trim(),
        title,
        value,
        minSpend,
        amount,
        remark,
        receiptImages,
        imageFileIds: receiptImages,
        operatorOpenid: openid,
        operatorName: (guard.actor && guard.actor.name) || '',
        createTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('verifyStoreCoupon log write skipped:', e.message)
  }

  // 有消费金额则联动积分申请；失败不回滚核销
  const pointsRes = await submitPointsFromRedeem({
    amount,
    userCouponId,
    memberOpenid,
    storeId,
    storeName: String((event && event.storeName) || '').trim(),
    title,
    operatorOpenid: openid,
    receiptImages
  })

  return attachPointsGrantFields({
    success: true,
    kind: 'store_coupon',
    kindLabel: '门店代金券 · 已核销',
    userCouponId,
    title,
    value,
    minSpend,
    amount,
    memberOpenid,
    storeId,
    receiptImages,
    msg: `已核销 ${title}（抵 ¥${value}）`
  }, pointsRes)
}

/**
 * 核销成功后写入 member_pass_tokens，供顾客短轮询发现「已核销」并灰态二维码。
 * 顾客 60s 换码会换 token：按 token / preferredCouponId / 同会员近期 token 三路覆盖。
 */
async function markPassTokensRedeemed(opts) {
  const memberOpenid = String((opts && opts.memberOpenid) || '').trim()
  const userCouponId = String((opts && opts.userCouponId) || '').trim()
  const token = String((opts && opts.token) || '').trim()
  const title = (opts && opts.title) || ''
  const value = Number((opts && opts.value) || 0) || 0
  const storeId = String((opts && opts.storeId) || '').trim()
  if (!memberOpenid && !token) return

  const patch = {
    redeemStatus: 'done',
    redeemedAt: db.serverDate(),
    redeemedCouponId: userCouponId,
    redeemedTitle: title,
    redeemedValue: value,
    redeemedStoreId: storeId,
    // 立刻失效，避免继续被扫作有效通行码
    expiresAt: new Date()
  }

  const touched = new Set()
  const tryUpdateDoc = async (id) => {
    if (!id || touched.has(id)) return
    touched.add(id)
    try {
      await db.collection(TOKENS).doc(id).update({ data: patch })
    } catch (e) { /* ignore */ }
  }

  if (token) {
    try {
      const res = await db.collection(TOKENS).where({ token }).limit(1).get()
      const rec = res.data && res.data[0]
      if (rec && rec._id) await tryUpdateDoc(rec._id)
    } catch (e) { /* ignore */ }
  }

  if (memberOpenid && userCouponId) {
    try {
      const res = await db.collection(TOKENS)
        .where({ openid: memberOpenid, preferredCouponId: userCouponId })
        .limit(12)
        .get()
      const rows = res.data || []
      for (let i = 0; i < rows.length; i++) {
        await tryUpdateDoc(rows[i]._id)
      }
    } catch (e) { /* ignore */ }
  }

  // 兜底：preferredCouponId 未写入 token 时，仍标记该会员近 3 分钟内发的码
  if (memberOpenid) {
    try {
      const since = new Date(Date.now() - 3 * 60 * 1000)
      const res = await db.collection(TOKENS)
        .where({
          openid: memberOpenid,
          createdAt: _.gte(since)
        })
        .limit(12)
        .get()
      const rows = res.data || []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (!row || !row._id) continue
        // 已核销其他券的码不要覆盖
        if (String(row.redeemStatus || '') === 'done') {
          const prev = String(row.redeemedCouponId || '').trim()
          if (prev && userCouponId && prev !== userCouponId) continue
        }
        await tryUpdateDoc(row._id)
      }
    } catch (e) { /* ignore */ }
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return fail('请先登录')

  const action = String((event && event.action) || 'listByMember').trim()
  const storeId = String((event && event.storeId) || '').trim()

  const guard = await assertStaff(db, openid, {
    permission: 'verifyStoreCoupon',
    storeId: storeId || undefined
  })
  if (!guard.ok) {
    return fail(guard.msg || '无操作权限', { code: guard.code })
  }

  try {
    if (action === 'redeem') return await redeem(event, openid, guard)
    if (action === 'listByMember' || action === 'list') return await listByMember(event, openid, guard)
    return fail('未知操作')
  } catch (e) {
    console.error('verifyStoreCoupon', e)
    return fail(e.message || '系统繁忙')
  }
}
