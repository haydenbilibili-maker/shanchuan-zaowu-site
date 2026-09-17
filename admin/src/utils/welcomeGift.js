/**
 * 新会员礼包 —— **仅用于 ERP 表单的展示归一与本地预校验**。
 *
 * ⚠️ 本文件**不再包含任何写库 payload / 集合名**：新会员礼包的唯一权威写入路径是小程序
 * 超管工作台的云函数（ERP 经 /api/cloud-fn 代理调用同一个函数）。
 * 历史形态（ERP 直写集合）会漏掉 `updatedBy` 与「已发未使用券条款同步」，
 * 且与工作台形成两份实现 —— 2026-09-16 已收口。
 * 权威校验/归一/摘要都在云函数 `manageWelcomeGift/welcomeGiftDefaults.js` 里。
 * 折扣纪律：不低于 7.5 折（value/minSpend ≤ 0.25）；默认约 9 折
 */

export const MIN_PAY_RATIO = 0.75
export const MAX_OFF_RATIO = 1 - MIN_PAY_RATIO

export function cashCouponMinSpendFloor(value) {
  const v = Math.max(0, Number(value) || 0)
  if (v <= 0) return 0
  return Math.ceil(v / MAX_OFF_RATIO)
}

export function enforceCashMinSpend(value, minSpend) {
  const v = Math.max(0, Math.floor(Number(value) || 0))
  const raw = Math.max(0, Math.floor(Number(minSpend) || 0))
  const floor = cashCouponMinSpendFloor(v)
  if (v <= 0) return raw
  if (raw <= 0) return Math.max(floor, v * 5)
  return Math.max(raw, floor)
}

export function validateCashCoupon(value, minSpend) {
  const v = Number(value) || 0
  const m = Number(minSpend) || 0
  if (!(v > 0)) return { ok: false, msg: '代金券面额无效' }
  if (!(m > 0)) return { ok: false, msg: '代金券须设置使用门槛' }
  if (v / m > MAX_OFF_RATIO + 1e-9) {
    return {
      ok: false,
      msg: `优惠过猛：满${m}减${v}低于7.5折（实付须≥原价75%），请提高门槛或降低面额`,
      minSpendFloor: cashCouponMinSpendFloor(v)
    }
  }
  return { ok: true }
}

export function getDefaultWelcomeGiftConfig() {
  return {
    ruleId: 'member_welcome_gift_v1',
    name: '新会员礼包',
    status: 'active',
    enabled: true,
    title: '新会员礼包',
    messageTitle: '新会员礼包已到账',
    // 2026-09-17 口径：新客不再发积分（改为一张真实的「满99减10」券，见下）
    points: 0,
    pointsEnabled: false,
    excludeGrowth: true,
    couponsEnabled: true,
    expireDays: 90,
    stackable: false,
    priority: 100,
    // 与线上 member_welcome_gift、小程序 cloudfunctions/*/welcomeGiftDefaults.js 逐字对齐：
    // 满49减5 / 满99减10 / 满299减30 / 满499减50 / 满999减100（共 5 张，90 天）。
    // 读不到集合时本默认值会被写入，故必须与线上权威档位一致，不能各写一套。
    coupons: [
      { id: 'c5', enabled: true, value: 5, minSpend: 49, expireDays: 90, count: 1, title: '新会员礼券 · 5元', channel: 'all' },
      { id: 'c10', enabled: true, value: 10, minSpend: 99, expireDays: 90, count: 1, title: '新会员礼券 · 10元', channel: 'all' },
      { id: 'c30', enabled: true, value: 30, minSpend: 299, expireDays: 90, count: 1, title: '新会员礼券 · 30元', channel: 'all' },
      { id: 'c50', enabled: true, value: 50, minSpend: 499, expireDays: 90, count: 1, title: '新会员礼券 · 50元', channel: 'all' },
      { id: 'c100', enabled: true, value: 100, minSpend: 999, expireDays: 90, count: 1, title: '新会员礼券 · 100元', channel: 'all' }
    ]
  }
}

/** 兼容 CloudBase Extended JSON（$numberInt / $numberDouble）与普通 number/string */
export function coerceNumber(value) {
  if (value == null || value === '') return NaN
  if (typeof value === 'object') {
    if (value.$numberInt != null) return Number(value.$numberInt)
    if (value.$numberDouble != null) return Number(value.$numberDouble)
    if (value.$numberLong != null) return Number(value.$numberLong)
  }
  return Number(value)
}

function toNumber(value, fallback) {
  const n = coerceNumber(value)
  return Number.isFinite(n) ? n : fallback
}

/** 券行 > 礼包默认 > 30（与 upsertUserProfile/welcomeGiftDefaults 对齐） */
export function resolveExpireDays(slotExpireDays, configExpireDays, fallback = 30) {
  const slot = coerceNumber(slotExpireDays)
  if (Number.isFinite(slot) && slot > 0) return Math.max(1, Math.floor(slot))
  const cfg = coerceNumber(configExpireDays)
  if (Number.isFinite(cfg) && cfg > 0) return Math.max(1, Math.floor(cfg))
  const fb = coerceNumber(fallback)
  if (Number.isFinite(fb) && fb > 0) return Math.max(1, Math.floor(fb))
  return 30
}

function normalizeCouponRow(row, index, defaultExpireDays) {
  const src = row && typeof row === 'object' ? row : {}
  const value = Math.max(0, Math.floor(toNumber(src.value, 0)))
  const expireDays = resolveExpireDays(src.expireDays, defaultExpireDays, 30)
  const count = Math.max(0, Math.floor(toNumber(src.count, 1)))
  const minSpendRaw = src.minSpend != null && src.minSpend !== ''
    ? toNumber(src.minSpend, 0)
    : 0
  const minSpend = enforceCashMinSpend(value, minSpendRaw)
  const id = String(src.id || `c${value || index}`).trim() || `c${index}`
  const title = String(src.title || '').trim()
    || (value > 0 && minSpend > 0 ? `新会员礼券 · 满${minSpend}减${value}` : (value > 0 ? `新会员礼券 · ${value}元` : `新会员礼券 ${index + 1}`))
  return {
    id,
    enabled: src.enabled !== false,
    value,
    minSpend,
    expireDays,
    count,
    title,
    channel: ['online', 'store', 'all'].includes(String(src.channel || ''))
      ? String(src.channel)
      : 'all'
  }
}

/** 保存前校验原始门槛 */
export function validateWelcomeGiftCoupons(config) {
  const src = config && typeof config === 'object' ? config : {}
  const coupons = Array.isArray(src.coupons) ? src.coupons : []
  for (let i = 0; i < coupons.length; i += 1) {
    const row = coupons[i] || {}
    if (row.enabled === false) continue
    const value = Math.max(0, Math.floor(toNumber(row.value, 0)))
    if (!(value > 0)) continue
    const minSpend = row.minSpend != null && row.minSpend !== ''
      ? Math.max(0, Math.floor(toNumber(row.minSpend, 0)))
      : 0
    const check = validateCashCoupon(value, minSpend)
    if (!check.ok) return check
  }
  return validateWelcomeGiftActivatable(src, coupons)
}

/**
 * 「礼券总开关开着，却没有任何启用中的券行」= 新用户静默收不到券。
 *
 * 真实事故（2026-09-15、2026-09-16 各一次）：保存时把券行全部存成 `enabled:false`
 * 而 `couponsEnabled` 仍为 true；发券侧只取启用行 → 只到账 100 积分、礼券 0 张，
 * 页面上完全看不出来。ERP 是**直写** member_welcome_gift 的（不经云函数），
 * 所以这层拦截必须在这里独立存在，不能只依赖 manageWelcomeGift 的校验。
 *
 * 券行为空时不报错：normalizeWelcomeGiftConfig 会回落到代码兜底档位（非停发）。
 */
export function validateWelcomeGiftActivatable(config, coupons) {
  const src = config && typeof config === 'object' ? config : {}
  if (src.couponsEnabled === false) return { ok: true }
  const list = Array.isArray(coupons) ? coupons : []
  if (!list.length) return { ok: true }
  const active = list.filter((row) => {
    const r = row && typeof row === 'object' ? row : {}
    if (r.enabled === false) return false
    return toNumber(r.value, 0) > 0 && toNumber(r.count, 1) > 0
  })
  if (active.length) return { ok: true }
  return {
    ok: false,
    code: 'COUPONS_ALL_DISABLED',
    msg: '礼券总开关是开着的，但没有任何启用中的券行——保存后新用户将收不到礼券。请至少启用一条券行，或关闭「礼券」总开关。'
  }
}

/**
 * 将默认有效天数同步到券行。
 * @param {object[]} coupons
 * @param {number} nextDays
 * @param {{ onlyMatching?: number|null }} [opts] onlyMatching 有值时只改仍等于该天数的行
 */
export function applyDefaultExpireDaysToCoupons(coupons, nextDays, opts = {}) {
  const days = resolveExpireDays(nextDays, null, 30)
  const list = Array.isArray(coupons) ? coupons : []
  const onlyMatching = opts.onlyMatching
  const matchDays = onlyMatching == null ? null : resolveExpireDays(onlyMatching, null, 30)
  list.forEach((row) => {
    if (!row || typeof row !== 'object') return
    if (matchDays != null) {
      const rowDays = coerceNumber(row.expireDays)
      if (!Number.isFinite(rowDays) || Math.floor(rowDays) !== matchDays) return
    }
    row.expireDays = days
  })
  return days
}

export function normalizeWelcomeGiftConfig(raw) {
  const base = getDefaultWelcomeGiftConfig()
  const src = raw && typeof raw === 'object' ? raw : {}
  // 不把 _id / _openid 等元数据并进业务字段
  const merged = { ...base }
  Object.keys(base).forEach((key) => {
    if (src[key] !== undefined) merged[key] = src[key]
  })
  if (Array.isArray(src.coupons)) merged.coupons = src.coupons

  merged.enabled = merged.enabled !== false && merged.status !== 'inactive'
  merged.status = merged.enabled ? 'active' : 'inactive'
  merged.points = Math.max(0, Math.floor(toNumber(merged.points, base.points)))
  merged.pointsEnabled = merged.pointsEnabled !== false
  merged.excludeGrowth = merged.excludeGrowth !== false
  merged.couponsEnabled = merged.couponsEnabled !== false
  merged.expireDays = Math.max(1, Math.floor(toNumber(merged.expireDays, base.expireDays)))
  merged.stackable = merged.stackable === true
  merged.priority = Math.max(0, Math.floor(toNumber(merged.priority, base.priority)))
  merged.title = String(merged.title || base.title).trim() || base.title
  merged.messageTitle = String(merged.messageTitle || base.messageTitle).trim() || base.messageTitle
  merged.name = String(merged.name || base.name).trim() || base.name
  merged.ruleId = String(merged.ruleId || base.ruleId).trim() || base.ruleId

  const couponSrc = Array.isArray(merged.coupons) && merged.coupons.length
    ? merged.coupons
    : base.coupons
  merged.coupons = couponSrc
    .map((row, i) => normalizeCouponRow(row, i, merged.expireDays))
    .filter((row) => row.value > 0)

  return merged
}

