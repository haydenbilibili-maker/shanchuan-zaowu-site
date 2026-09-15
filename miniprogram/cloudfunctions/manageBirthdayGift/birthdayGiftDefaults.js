/**
 * 生日礼包 — 默认规则（代码兜底）
 * 云库集合 member_birthday_gift 可覆盖；超管「权益会员 → 生日礼包」写入。
 *
 * 触发：生日当天 claimBirthdayGift（Asia/Shanghai）
 * 内容：积分（bonusPoints，默认不计成长）+ 礼券若干
 * 防重：point_records.dedupeKey = birthday_gift:{openid}:{year} + users.birthdayGiftYear
 * 有效期默认：生日本月最后一天；可改为固定天数
 *
 * 折扣纪律：不低于 7.5 折；默认约 8 折（满100减20 ×3）
 */
const { enforceCashMinSpend, validateCashCoupon } = require('./couponDiscountRules')

const SOURCE = 'birthday_gift'
const COLLECTION = 'member_birthday_gift'

function getDefaultConfig() {
  return {
    ruleId: 'member_birthday_gift_v1',
    name: '生日礼包',
    status: 'active',
    enabled: true,
    title: '生日礼包',
    messageTitle: '生日快乐，礼券已到账',
    points: 200,
    pointsEnabled: true,
    pointsTitle: '生日礼券 · 专属积分',
    excludeGrowth: true,
    couponsEnabled: true,
    /** end_of_month | days */
    expireMode: 'end_of_month',
    expireDays: 30,
    stackable: false,
    priority: 100,
    processBatchLimit: 40,
    coupons: [
      {
        id: 'birthday_gift_20',
        enabled: true,
        value: 20,
        minSpend: 100,
        expireDays: 30,
        count: 3,
        title: '生日礼券 · 满100减20',
        channel: 'all'
      }
    ]
  }
}

function coerceNumber(value) {
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

function resolveExpireDays(slotExpireDays, configExpireDays, fallback = 30) {
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
  const id = String(src.id || `bday_${value || index}`).trim() || `bday_${index}`
  const title = String(src.title || '').trim()
    || (value > 0 && minSpend > 0
      ? `生日礼券 · 满${minSpend}减${value}`
      : (value > 0 ? `生日礼券 · ${value}元` : `生日礼券 ${index + 1}`))
  return {
    id,
    enabled: src.enabled !== false,
    value,
    minSpend,
    expireDays,
    count,
    title,
    channel: String(src.channel || 'all').trim().toLowerCase() || 'all'
  }
}

function validateConfigCoupons(config) {
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

function normalizeConfig(raw) {
  const base = getDefaultConfig()
  const merged = { ...base, ...(raw || {}) }

  merged.enabled = merged.enabled !== false && merged.status !== 'inactive'
  merged.status = merged.enabled ? 'active' : 'inactive'
  merged.points = Math.max(0, Math.floor(toNumber(merged.points, base.points)))
  merged.pointsEnabled = merged.pointsEnabled !== false
  merged.excludeGrowth = merged.excludeGrowth !== false
  merged.couponsEnabled = merged.couponsEnabled !== false
  merged.expireDays = Math.max(1, Math.floor(toNumber(merged.expireDays, base.expireDays)))
  merged.expireMode = String(merged.expireMode || base.expireMode).trim() === 'days'
    ? 'days'
    : 'end_of_month'
  merged.stackable = merged.stackable === true
  merged.priority = Math.max(0, Math.floor(toNumber(merged.priority, base.priority != null ? base.priority : 100)))
  merged.processBatchLimit = Math.max(
    1,
    Math.floor(toNumber(merged.processBatchLimit, base.processBatchLimit))
  )
  merged.title = String(merged.title || base.title).trim() || base.title
  merged.messageTitle = String(merged.messageTitle || base.messageTitle).trim() || base.messageTitle
  merged.pointsTitle = String(merged.pointsTitle || base.pointsTitle).trim() || base.pointsTitle
  merged.name = String(merged.name || base.name).trim() || base.name
  merged.ruleId = String(merged.ruleId || base.ruleId).trim() || base.ruleId

  const couponSrc = Array.isArray(merged.coupons) && merged.coupons.length
    ? merged.coupons
    : base.coupons
  merged.coupons = couponSrc
    .map((row, i) => normalizeCouponRow(row, i, merged.expireDays))
    .filter((row) => row.value > 0 && row.count > 0)

  return merged
}

function activeCoupons(config) {
  const cfg = normalizeConfig(config)
  if (!cfg.couponsEnabled) return []
  return cfg.coupons.filter((c) => c.enabled && c.value > 0 && c.count > 0)
}

function describeConfig(config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) return '生日礼包已关闭'
  const parts = []
  if (cfg.pointsEnabled && cfg.points > 0) {
    parts.push(`${cfg.points} 积分`)
  }
  const coupons = activeCoupons(cfg)
  if (coupons.length) {
    const labels = coupons.map((c) => {
      const sheet = c.count > 1 ? `×${c.count}` : ''
      return `满${c.minSpend}减${c.value}${sheet}`
    })
    const expireLabel = cfg.expireMode === 'days'
      ? `${cfg.expireDays} 天`
      : '生日本月内有效'
    parts.push(`礼券 ${labels.join(' / ')}（${expireLabel}）`)
  }
  if (!parts.length) return '生日礼包已启用，但积分与礼券均为空'
  return `生日礼包：${parts.join(' + ')}；生日当天发放；同年仅一次；折扣不低于7.5折`
}

module.exports = {
  SOURCE,
  COLLECTION,
  getDefaultConfig,
  normalizeConfig,
  activeCoupons,
  describeConfig,
  validateConfigCoupons
}
