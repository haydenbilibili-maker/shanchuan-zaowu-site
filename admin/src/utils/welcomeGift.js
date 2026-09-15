/**
 * 新会员礼包默认配置（与小程序 upsertUserProfile/welcomeGiftDefaults.js 对齐）
 * 折扣纪律：不低于 7.5 折（value/minSpend ≤ 0.25）；默认约 8～9 折
 */

export const COLLECTION = 'member_welcome_gift'
export const SOURCE = 'register_gift'
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
    points: 100,
    pointsEnabled: true,
    excludeGrowth: true,
    couponsEnabled: true,
    expireDays: 30,
    stackable: false,
    priority: 100,
    coupons: [
      // 首单友好档：门槛 49（折扣纪律下限 ceil(10/0.25)=40，合规）；与小程序 welcomeGiftDefaults 对齐
      { id: 'c10s', enabled: true, value: 10, minSpend: 49, expireDays: 30, count: 1, title: '新会员礼券 · 满49减10', channel: 'all' },
      { id: 'c10', enabled: true, value: 10, minSpend: 100, expireDays: 30, count: 1, title: '新会员礼券 · 满100减10', channel: 'all' },
      { id: 'c30', enabled: true, value: 30, minSpend: 200, expireDays: 30, count: 1, title: '新会员礼券 · 满200减30', channel: 'all' },
      { id: 'c50', enabled: true, value: 50, minSpend: 300, expireDays: 30, count: 1, title: '新会员礼券 · 满300减50', channel: 'all' },
      { id: 'c100', enabled: true, value: 100, minSpend: 500, expireDays: 30, count: 1, title: '新会员礼券 · 满500减100', channel: 'all' }
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
  return { ok: true }
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

/** 仅业务字段，供 update/add，避免 _id/_openid 导致写库失败或回读污染 */
export function buildWelcomeGiftWritePayload(config) {
  const normalized = normalizeWelcomeGiftConfig(config)
  return {
    ruleId: normalized.ruleId,
    name: normalized.name,
    status: normalized.enabled ? 'active' : 'inactive',
    enabled: normalized.enabled,
    title: normalized.title,
    messageTitle: normalized.messageTitle,
    points: normalized.points,
    pointsEnabled: normalized.pointsEnabled,
    excludeGrowth: normalized.excludeGrowth,
    couponsEnabled: normalized.couponsEnabled,
    expireDays: normalized.expireDays,
    stackable: normalized.stackable,
    priority: normalized.priority,
    coupons: (normalized.coupons || []).map((c) => ({
      id: c.id,
      enabled: c.enabled !== false,
      value: c.value,
      minSpend: c.minSpend,
      expireDays: c.expireDays,
      count: c.count,
      title: c.title,
      channel: c.channel || 'all'
    })),
    updateTime: Date.now(),
    _updateTime: Date.now()
  }
}

export function describeWelcomeGift(config) {
  const cfg = normalizeWelcomeGiftConfig(config)
  if (!cfg.enabled) return '新会员礼包已关闭'
  const parts = []
  if (cfg.pointsEnabled && cfg.points > 0) parts.push(`${cfg.points} 积分`)
  if (cfg.couponsEnabled) {
    const active = (cfg.coupons || []).filter((c) => c.enabled && c.value > 0 && c.count > 0)
    if (active.length) {
      const sameDays = active.every((c) => Number(c.expireDays) === Number(cfg.expireDays))
      const daysLabel = sameDays
        ? `${cfg.expireDays} 天`
        : `默认 ${cfg.expireDays} 天（各券可不同）`
      parts.push(`礼券 ${active.map((c) => `满${c.minSpend}减${c.value}${c.count > 1 ? `×${c.count}` : ''}`).join(' / ')}（${daysLabel}）`)
    }
  }
  if (!parts.length) return '已启用，但积分与礼券均为空'
  return `${parts.join(' + ')}；${cfg.stackable ? '可叠加' : '不可叠加（一单一券）'}；折扣不低于7.5折`
}
