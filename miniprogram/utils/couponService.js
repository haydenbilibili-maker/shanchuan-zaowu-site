/**
 * 用户券包读取：优先云函数（不受客户端集合权限限制），失败再回退直查。
 * 集合不存在 / 无权限视为空券包，不作为页面错误。
 */
const {
  resolveCouponStatus,
  couponTitle,
  couponFaceLabel,
  couponExpireTime,
  parseMinSpend,
  isCouponUnexpired,
  sortCouponCards,
  normalizeCouponChannel,
  couponChannelLabel,
  couponChannelAllows
} = require('./couponHelper')

function errText(err) {
  return String((err && (err.errMsg || err.message || err.msg)) || err || '')
}

function isMissingCollection(err) {
  return /not exist|NOT_EXIST|集合不存在|502005|COLLECTION_NOT/i.test(errText(err))
}

function isPermissionDenied(err) {
  return /permission|PERMISSION|无权|-502003|-502001|-1\s*database|cannot be accessed|security rule|DATABASE_PERMISSION/i.test(errText(err))
}

function isFunctionMissing(err) {
  return /FUNCTION_NOT_FOUND|-501007|找不到对应的云函数|FunctionNameParam|does not exist/i.test(errText(err))
}

function isSoftEmptyError(err) {
  return isMissingCollection(err) || isPermissionDenied(err)
}

function mapCouponCard(item, now) {
  const expireAt = couponExpireTime(item)
  let expireDate = '长期有效'
  if (expireAt) {
    const date = new Date(expireAt)
    if (!Number.isNaN(date.getTime())) {
      const y = date.getFullYear()
      const m = `${date.getMonth() + 1}`.padStart(2, '0')
      const d = `${date.getDate()}`.padStart(2, '0')
      expireDate = `${y}.${m}.${d}`
    }
  }
  const status = resolveCouponStatus(item, now)
  const channel = normalizeCouponChannel(item.channel)
  return {
    ...item,
    expireTime: expireAt,
    expireDate,
    value: item.value || 0,
    minSpend: parseMinSpend(item),
    title: couponTitle(item),
    faceLabel: couponFaceLabel(item),
    channel,
    channelLabel: couponChannelLabel(channel),
    canUseOnline: status === 'unused' && couponChannelAllows(channel, 'online'),
    canUseStore: status === 'unused' && couponChannelAllows(channel, 'store'),
    status,
    canUse: status === 'unused'
  }
}

function packList(rawList, usableOnly, now, via) {
  let list = rawList || []
  if (usableOnly) {
    list = list.filter((c) => resolveCouponStatus(c, now) === 'unused')
  }
  return {
    ok: true,
    list: sortCouponCards(list.map((item) => mapCouponCard(item, now))),
    via
  }
}

async function fetchViaCloudFunction(usableOnly) {
  const res = await wx.cloud.callFunction({
    name: 'getUserCoupons',
    data: { usableOnly: !!usableOnly }
  })
  const result = (res && res.result) || {}
  if (result.success === false) {
    const err = new Error(result.msg || '云函数返回失败')
    err.msg = result.msg
    throw err
  }
  if (Array.isArray(result.data)) {
    return { list: result.data, via: 'cloud' }
  }
  const err = new Error(result.msg || '云函数返回失败')
  err.msg = result.msg
  throw err
}

async function fetchViaDatabase(usableOnly) {
  const db = wx.cloud.database()
  const _ = db.command
  let query = db.collection('user_coupons')
  if (usableOnly) {
    query = query.where({ status: _.in(['unused', 'available']) })
  }
  const res = await query.limit(100).get()
  return { list: res.data || [], via: 'db' }
}

/**
 * @param {{ usableOnly?: boolean }} options
 * @returns {Promise<{ ok: boolean, list: object[], emptyReason?: string, via?: string }>}
 */
async function fetchMyCoupons(options = {}) {
  const usableOnly = !!options.usableOnly
  const now = new Date()

  // 本机已退出：禁止用 OPENID / 直查拉回可识别券包
  try {
    const { isLocalLoggedOut } = require('./userSession')
    if (isLocalLoggedOut()) {
      return { ok: true, list: [], emptyReason: 'guest', via: 'none' }
    }
  } catch (e) { /* ignore */ }

  try {
    const packed = await fetchViaCloudFunction(usableOnly)
    return packList(packed.list, usableOnly, now, packed.via)
  } catch (cloudErr) {
    const fallbackEmpty = () => ({ ok: true, list: [], emptyReason: 'empty', via: 'none' })

    try {
      const packed = await fetchViaDatabase(usableOnly)
      let list = packed.list || []
      if (usableOnly) {
        list = list.filter((c) => isCouponUnexpired(c, now) && resolveCouponStatus(c, now) === 'unused')
      }
      return packList(list, false, now, packed.via)
    } catch (dbErr) {
      if (isSoftEmptyError(dbErr) || isSoftEmptyError(cloudErr) || isFunctionMissing(cloudErr)) {
        return fallbackEmpty()
      }
      console.error('fetchMyCoupons', cloudErr, dbErr)
      return { ok: false, list: [], emptyReason: 'error' }
    }
  }
}

module.exports = {
  fetchMyCoupons,
  mapCouponCard
}
