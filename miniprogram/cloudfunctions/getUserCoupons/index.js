const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return /not exist|NOT_EXIST|集合不存在|502005|COLLECTION_NOT/i.test(msg)
}

function expireRaw(coupon) {
  if (!coupon) return null
  return coupon.expireTime || coupon.expire_time || coupon.validUntil || null
}

function isUsable(coupon, now) {
  const s = String((coupon && coupon.status) || '').trim().toLowerCase()
  if (s && s !== 'unused' && s !== 'available') return false
  const raw = expireRaw(coupon)
  if (!raw) return true
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return true
  return t > now
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, msg: '请先登录' }

  const usableOnly = !!(event && event.usableOnly)

  try {
    const res = await db.collection('user_coupons')
      .where({ _openid: OPENID })
      .limit(100)
      .get()

    let list = res.data || []
    if (usableOnly) {
      const now = new Date()
      list = list.filter((c) => isUsable(c, now))
    }

    return { success: true, data: list }
  } catch (err) {
    console.error('getUserCoupons', err)
    if (isMissingCollection(err)) return { success: true, data: [] }
    return { success: false, msg: '优惠券加载失败', data: [] }
  }
}
