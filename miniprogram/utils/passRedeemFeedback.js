/**
 * 顾客亮码页 · 门店券核销成功反馈（券夹 / 会员卡共用）
 */

const REDEEM_POLL_MS = 1500
const REDEEM_ANIM_MS = 700

function softVibrate(type) {
  try {
    wx.vibrateShort({ type: type || 'light' })
  } catch (e) { /* ignore */ }
}

/**
 * 短轮询 getMemberPass.pollRedeem
 * @param {{ preferredCouponId?: string, token?: string }} opts
 */
async function pollMemberPassRedeem(opts) {
  const preferredCouponId = String((opts && opts.preferredCouponId) || '').trim()
  const token = String((opts && opts.token) || '').trim()
  if (!preferredCouponId && !token) {
    return { success: false, redeemed: false, skipped: true }
  }
  const res = await wx.cloud.callFunction({
    name: 'getMemberPass',
    data: {
      action: 'pollRedeem',
      ...(preferredCouponId ? { preferredCouponId, userCouponId: preferredCouponId } : {}),
      ...(token ? { token } : {})
    }
  })
  return (res && res.result) || {}
}

/**
 * 会员卡亮码无券 ID 时：只认当前 token 被标记，避免近期历史核销误触发成功态。
 * 券夹有 preferredCouponId 时：payload 带券 ID 则必须匹配；token_recent 仅在券 ID 一致时接受。
 */
function shouldAcceptRedeem(payload, opts) {
  if (!payload || !payload.success || !payload.redeemed) return false
  const preferredCouponId = String((opts && opts.preferredCouponId) || '').trim()
  const source = String(payload.source || '').trim()
  const uid = String(payload.userCouponId || '').trim()
  if (preferredCouponId) {
    if (uid && uid !== preferredCouponId) return false
    if (source === 'token_recent') return uid === preferredCouponId
    return true
  }
  return source === 'token' || source === 'coupon'
}

function formatRedeemValueText(value) {
  const n = Number(value) || 0
  return n > 0 ? String(n) : ''
}

module.exports = {
  REDEEM_POLL_MS,
  REDEEM_ANIM_MS,
  softVibrate,
  pollMemberPassRedeem,
  shouldAcceptRedeem,
  formatRedeemValueText
}
