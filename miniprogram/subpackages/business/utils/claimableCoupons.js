/**
 * 券夹「可领取」区块的展示派生（纯函数；数据来自云函数 getClaimableCoupons）
 */
const { couponFaceLabel, couponChannelLabel } = require('../../../utils/couponHelper')

function fmtDate(raw) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** 有效期文案：固定到期日显示具体日期；与 receiveCoupon 的到期判定同序（固定日 → 天数 → 模板到期 → 默认 30 天） */
function claimExpireText(c) {
  const fixed = fmtDate(c && c.fixedExpireTime)
  const days = Number(c && c.expireDays) || 0
  if (fixed && days) return `领取后 ${days} 天内有效 · 最晚 ${fixed}`
  if (fixed) return `有效期至 ${fixed}`
  if (days) return `领取后 ${days} 天内有效`
  const tpl = fmtDate(c && c.expireTime)
  if (tpl) return `有效期至 ${tpl}`
  return '领取后 30 天内有效'
}

function decorateClaimable(c) {
  const limit = Number(c && c.limitPerUser) || 0
  return {
    ...c,
    faceLabel: couponFaceLabel(c),
    channelLabel: couponChannelLabel(c),
    expireText: claimExpireText(c),
    limitText: limit > 0 ? `每人限领 ${limit} 张` : '',
    claimed: false,
    claimError: ''
  }
}

/** receiveCoupon 的「已领满」拒绝文案 → 就地标记为已领取，而不是当成错误 */
function isClaimLimitMsg(msg) {
  return /每人限领/.test(String(msg || ''))
}

module.exports = { fmtDate, claimExpireText, decorateClaimable, isClaimLimitMsg }
