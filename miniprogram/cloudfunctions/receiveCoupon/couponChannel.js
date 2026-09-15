/**
 * 券适用渠道（与 utils/couponHelper.js 口径对齐；云函数目录不共享）
 * online | store | all
 * 缺省 / 空 / 未知 → all（门店+线上皆可；新建与旧券兼容）
 */
function normalizeCouponChannel(raw) {
  if (raw == null || raw === '') return 'all'
  const s = String(raw).trim().toLowerCase()
  if (s === 'store' || s === 'offline' || s === 'in_store') return 'store'
  if (s === 'online' || s === 'mall') return 'online'
  if (s === 'all' || s === 'both' || s === 'any') return 'all'
  return 'all'
}

function couponChannelAllows(couponOrChannel, useAt) {
  const ch = typeof couponOrChannel === 'string'
    ? normalizeCouponChannel(couponOrChannel)
    : normalizeCouponChannel(couponOrChannel && couponOrChannel.channel)
  const at = String(useAt || '').trim().toLowerCase()
  if (at === 'store' || at === 'offline') return ch === 'store' || ch === 'all'
  if (at === 'online' || at === 'mall') return ch === 'online' || ch === 'all'
  return true
}

module.exports = {
  normalizeCouponChannel,
  couponChannelAllows
}
