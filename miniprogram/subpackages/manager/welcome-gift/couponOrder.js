/**
 * 新会员礼包编辑页：券行顺序与稳定 key
 *
 * 为什么单独成模块：
 *   ① **顺序是业务语义** —— 券面在各处（注册页预览、发放、站内信、ERP）透出的顺序就是这里的数组顺序，
 *      所以「新增的 99-10 应排在第二位」这种事必须能被守卫逐例验证，而不是靠人眼；
 *   ② **稳定 key 是修 bug 的**：页面原用 `wx:key="id"`，而 `id` 是**可编辑字段** ——
 *      每敲一个字符 key 就变，微信会重建该行节点 → 输入框失焦、键盘重弹一次
 *      （真机反馈：「每编辑一个字母，就会自动弹出」）。key 必须来自不可编辑的 `_key`。
 */

let seq = 0

/** 生成行内稳定 key（不进数据库：save 前会 strip 掉） */
function nextCouponKey() {
  seq += 1
  return `k${Date.now().toString(36)}${seq}`
}

/** 给每行补 `_key`（已存在的保留，避免重新加载时抖动） */
function ensureCouponKeys(coupons) {
  return (coupons || []).map((c) => Object.assign({}, c, { _key: (c && c._key) || nextCouponKey() }))
}

/** 去掉 `_key`（保存前调用；云函数也会丢未知字段，这里主动做以免脏数据上行） */
function stripCouponKeys(coupons) {
  return (coupons || []).map((c) => {
    const out = Object.assign({}, c)
    delete out._key
    return out
  })
}

/** 门槛升序、同门槛按面额升序；稳定（相同键保持原相对顺序） */
function sortCouponsByThreshold(coupons) {
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

/**
 * 新增一行时按门槛插到合适位置（而不是一律追加到末尾）——
 * 这样新加的「满99减10」自然落在满49减5 之后，不会排到最后（真机反馈的现象）。
 */
function insertCouponByThreshold(coupons, row) {
  const list = (coupons || []).slice()
  const target = Number(row && row.minSpend) || 0
  let at = list.length
  for (let i = 0; i < list.length; i += 1) {
    if ((Number(list[i] && list[i].minSpend) || 0) > target) { at = i; break }
  }
  list.splice(at, 0, row)
  return list
}

/** 上移 / 下移（越界原样返回；返回新数组便于 setData） */
function moveCoupon(coupons, from, to) {
  const list = (coupons || []).slice()
  if (from < 0 || from >= list.length) return list
  if (to < 0 || to >= list.length) return list
  if (from === to) return list
  const [row] = list.splice(from, 1)
  list.splice(to, 0, row)
  return list
}

/**
 * 折扣地板违规检测（与云函数 couponDiscountRules 同口径：门槛 ≥ ceil(面额 / 0.25)，即不低于 7.5 折）。
 * 返回 [{ index, need, row }...]；停用行与零面额行跳过（它们不参与发放）。
 */
function findFloorViolations(coupons, ratio) {
  const r = Number(ratio) > 0 ? Number(ratio) : 0.25
  const out = []
  ;(coupons || []).forEach((row, index) => {
    if (!row || row.enabled === false) return
    const value = Number(row.value) || 0
    if (!(value > 0)) return
    const need = Math.ceil(value / r)
    if ((Number(row.minSpend) || 0) < need) out.push({ index, need, row })
  })
  return out
}

module.exports = {
  nextCouponKey,
  ensureCouponKeys,
  stripCouponKeys,
  sortCouponsByThreshold,
  insertCouponByThreshold,
  moveCoupon,
  findFloorViolations
}
