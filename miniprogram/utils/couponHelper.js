/** 优惠券展示与可用性（购物车 / 确认订单共用） */

function formatExpireText(expireTime) {
  if (!expireTime) return '长期有效'
  const date = new Date(expireTime)
  if (Number.isNaN(date.getTime())) return '长期有效'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d} 到期`
}

function formatCouponFaceValue(coupon) {
  const type = coupon?.type || 'cash'
  const value = Number(coupon?.value) || 0
  if (type === 'discount') {
    return value % 10 === 0 ? `${value / 10}折` : `${(value / 10).toFixed(1)}折`
  }
  if (type === 'freeShipping') return '包邮券'
  return `¥${value}`
}

function formatCouponTypeLabel(coupon) {
  const type = coupon?.type || 'cash'
  const map = {
    cash: '满减券',
    discount: '折扣券',
    freeShipping: '包邮券',
    newUser: '新人券',
  }
  return map[type] || '优惠券'
}

function isCouponExpired(coupon, now = Date.now()) {
  if (!coupon?.expireTime) return false
  const exp = new Date(coupon.expireTime).getTime()
  return Number.isNaN(exp) || exp <= now
}

/** 礼券夹展示状态：usable | used | expired */
function resolveCouponDisplayStatus(coupon, now = Date.now()) {
  if (coupon?.status === 'used') return 'used'
  if (coupon?.status === 'expired') return 'expired'
  if (isCouponExpired(coupon, now)) return 'expired'
  if (coupon?.status === 'unused') return 'usable'
  return 'expired'
}

function formatExpireDateShort(expireTime) {
  if (!expireTime) return '永久有效'
  const date = new Date(expireTime)
  if (Number.isNaN(date.getTime())) return '永久有效'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

const WALLET_STATUS_ORDER = { usable: 0, used: 1, expired: 2 }

function prepareWalletCoupon(item, now = Date.now()) {
  const displayStatus = resolveCouponDisplayStatus(item, now)
  const statusLabels = {
    usable: '立即使用',
    used: '已使用',
    expired: '已失效',
  }
  return {
    ...item,
    expireDate: formatExpireDateShort(item.expireTime),
    value: item.value || 0,
    minSpend: item.minSpend || 0,
    title: item.title || item.name || '优惠券',
    valueDisplay: formatCouponFaceValue(item),
    typeLabel: formatCouponTypeLabel(item),
    displayStatus,
    statusLabel: statusLabels[displayStatus] || '已失效',
    isExpired: displayStatus === 'expired',
    isUsable: displayStatus === 'usable',
  }
}

function sortWalletCoupons(list) {
  return [...list].sort((a, b) => {
    const oa = WALLET_STATUS_ORDER[a.displayStatus] ?? 9
    const ob = WALLET_STATUS_ORDER[b.displayStatus] ?? 9
    if (oa !== ob) return oa - ob
    const ta = new Date(a.createTime || a._createTime || 0).getTime()
    const tb = new Date(b.createTime || b._createTime || 0).getTime()
    return tb - ta
  })
}

/** 统计仍可用（未使用且未过期）的券数量 */
function countUsableCoupons(coupons, now = Date.now()) {
  if (!Array.isArray(coupons)) return 0
  return coupons.filter((c) => resolveCouponDisplayStatus(c, now) === 'usable').length
}

function enrichCoupon(coupon, vipTotal = 0) {
  const minSpend = Number(coupon?.minSpend) || 0
  return {
    ...coupon,
    title: coupon?.title || coupon?.name || '优惠券',
    minSpend,
    valueDisplay: formatCouponFaceValue(coupon),
    typeLabel: formatCouponTypeLabel(coupon),
    expireText: formatExpireText(coupon?.expireTime),
    _disabled: vipTotal < minSpend,
  }
}

module.exports = {
  formatExpireText,
  formatExpireDateShort,
  formatCouponFaceValue,
  formatCouponTypeLabel,
  isCouponExpired,
  resolveCouponDisplayStatus,
  prepareWalletCoupon,
  sortWalletCoupons,
  countUsableCoupons,
  enrichCoupon,
}
