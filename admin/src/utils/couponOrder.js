/**
 * 券行顺序与稳定 key（ERP 新会员礼包页）
 *
 * ⚠️ 与小程序超管工作台 `miniprogram/subpackages/manager/welcome-gift/couponOrder.js`
 * **必须同口径** —— 守卫 `npm run test:welcome-gift-editor` 会逐例比对两边输出。
 * 顺序是业务语义：券面在注册页预览 / 发放 / 站内信 / 两端后台透出的顺序就是数组顺序。
 *
 * 折扣地板**不在这里**：它属于「券的合法性」，唯一出处仍是 `utils/welcomeGift.js`
 * 的 validateWelcomeGiftCoupons（由 check:coupon-floor 与云函数对表）。
 */

let seq = 0

/** 生成行内稳定 key（只用于 el-table 的 row-key，不写库：保存前 strip） */
export function nextCouponKey() {
  seq += 1
  return `k${Date.now().toString(36)}${seq}`
}

export function ensureCouponKeys(coupons) {
  return (coupons || []).map((c) => ({ ...c, _key: (c && c._key) || nextCouponKey() }))
}

export function stripCouponKeys(coupons) {
  return (coupons || []).map((c) => {
    const out = { ...c }
    delete out._key
    return out
  })
}

/** 门槛升序、同门槛按面额升序；稳定 */
export function sortCouponsByThreshold(coupons) {
  return (coupons || [])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ma = Number(a.c && a.c.minSpend) || 0
      const mb = Number(b.c && b.c.minSpend) || 0
      if (ma !== mb) return ma - mb
      const va = Number(a.c && a.c.value) || 0
      const vb = Number(b.c && b.c.value) || 0
      if (va !== vb) return va - vb
      return a.i - b.i
    })
    .map((x) => x.c)
}

/** 新增券按门槛插位（新加的低门槛券不会排到最后） */
export function insertCouponByThreshold(coupons, row) {
  const list = (coupons || []).slice()
  const target = Number(row && row.minSpend) || 0
  let at = list.length
  for (let i = 0; i < list.length; i += 1) {
    if ((Number(list[i] && list[i].minSpend) || 0) > target) { at = i; break }
  }
  list.splice(at, 0, row)
  return list
}

export function moveCoupon(coupons, from, to) {
  const list = (coupons || []).slice()
  if (from < 0 || from >= list.length) return list
  if (to < 0 || to >= list.length) return list
  if (from === to) return list
  const [row] = list.splice(from, 1)
  list.splice(to, 0, row)
  return list
}
