/**
 * 新会员礼包 — 默认规则（代码兜底）
 * 云库集合 member_welcome_gift 可覆盖；Admin「新会员礼包」页写入。
 *
 * 触发：upsertUserProfile completeOnboarding
 * 内容：积分（bonusPoints，默认不计成长）+ 礼券若干（user_coupons）
 * 防重：point_records.dedupeKey = register_gift:{openid} + users.registerGiftClaimed
 * 叠券：stackable 默认 false；下单链路 makeOrder 本就只接单张 couponId
 *
 * 折扣纪律：不低于 7.5 折；默认档位落在约 8～9 折（满 X 减 Y，Y/X ≤ 0.25）
 */
const { enforceCashMinSpend, validateCashCoupon } = require('./couponDiscountRules')

const SOURCE = 'register_gift'
const COLLECTION = 'member_welcome_gift'

function getDefaultConfig() {
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
      // 与 upsertUserProfile/welcomeGiftDefaults 同源；首单友好档门槛 49
      { id: 'c10s', enabled: true, value: 10, minSpend: 49, expireDays: 30, count: 1, title: '新会员礼券 · 满49减10', channel: 'all' },
      { id: 'c10', enabled: true, value: 10, minSpend: 100, expireDays: 30, count: 1, title: '新会员礼券 · 满100减10', channel: 'all' },
      { id: 'c30', enabled: true, value: 30, minSpend: 200, expireDays: 30, count: 1, title: '新会员礼券 · 满200减30', channel: 'all' },
      { id: 'c50', enabled: true, value: 50, minSpend: 300, expireDays: 30, count: 1, title: '新会员礼券 · 满300减50', channel: 'all' },
      { id: 'c100', enabled: true, value: 100, minSpend: 500, expireDays: 30, count: 1, title: '新会员礼券 · 满500减100', channel: 'all' }
    ]
  }
}

/** 兼容 CloudBase Extended JSON 与普通 number/string */
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

/**
 * 发券有效天数：券行 > 礼包默认 > 30
 * 券行缺省 / 非法时才回落到顶层 expireDays。
 */
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
  // 缺省 expireDays 时继承顶层默认，不写成硬编码 30（便于后续改默认即生效）
  const expireDays = resolveExpireDays(src.expireDays, defaultExpireDays, 30)
  const count = Math.max(0, Math.floor(toNumber(src.count, 1)))
  const minSpendRaw = src.minSpend != null && src.minSpend !== ''
    ? toNumber(src.minSpend, 0)
    : 0
  // 过低门槛自动抬至 7.5 折地板，避免历史云库配置发穿底券
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
    channel: String(src.channel || 'all').trim().toLowerCase() || 'all'
  }
}

/** 保存前校验原始门槛（不走静默抬升），拒绝低于 7.5 折的配置 */
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

/**
 * 把云端记录浅合并到默认值上，收敛数值与券列表。
 */
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
  // 与现有下单一致：一单一券；Admin 可开「允许叠加」字段但默认关，线上仍以 makeOrder 单券为准
  merged.stackable = merged.stackable === true
  merged.priority = Math.max(0, Math.floor(toNumber(merged.priority, base.priority != null ? base.priority : 100)))
  merged.title = String(merged.title || base.title).trim() || base.title
  merged.messageTitle = String(merged.messageTitle || base.messageTitle).trim() || base.messageTitle
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

/** C 端注册页预览：仅安全展示字段（积分 + 展开后的礼券卡） */
function buildPreview(config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) {
    return {
      enabled: false,
      points: 0,
      couponCount: 0,
      coupons: [],
      expireDays: cfg.expireDays
    }
  }
  const points = cfg.pointsEnabled ? cfg.points : 0
  const coupons = []
  activeCoupons(cfg).forEach((c) => {
    const n = Math.max(1, Math.floor(c.count) || 1)
    for (let i = 0; i < n; i += 1) {
      coupons.push({
        id: n > 1 ? `${c.id}_${i + 1}` : c.id,
        value: c.value,
        minSpend: c.minSpend,
        title: c.title,
        label: c.minSpend > 0 ? `满${c.minSpend}可用` : '无门槛'
      })
    }
  })
  return {
    enabled: true,
    points,
    couponCount: coupons.length,
    coupons,
    expireDays: cfg.expireDays
  }
}

function describeConfig(config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) return '新会员礼包已关闭'
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
    parts.push(`礼券 ${labels.join(' / ')}（${cfg.expireDays} 天）`)
  }
  if (!parts.length) return '新会员礼包已启用，但积分与礼券均为空'
  const stack = cfg.stackable ? '可叠加' : '不可叠加（一单一券）'
  return `新会员礼包：${parts.join(' + ')}；${stack}；折扣不低于7.5折`
}

function buildMessageContent(config, expireDateLabel) {
  const cfg = normalizeConfig(config)
  const lines = ['欢迎来到山海造物。']
  const bits = []
  if (cfg.pointsEnabled && cfg.points > 0) {
    bits.push(`${cfg.points} 积分`)
  }
  const coupons = activeCoupons(cfg)
  if (coupons.length) {
    const labels = coupons.map((c) => {
      const sheet = c.count > 1 ? `×${c.count}` : ''
      return `${c.value} 元${sheet}`
    })
    bits.push(`礼券 ${labels.join('、')}`)
  }
  if (bits.length) {
    lines.push(`注册礼包已放入账户：${bits.join('，')}。`)
  }
  if (coupons.length && expireDateLabel) {
    lines.push(`礼券有效期至 ${expireDateLabel}，同一订单仅可用一张券。`)
  } else if (coupons.length) {
    lines.push('礼券可在我的券夹查看，同一订单仅可用一张券。')
  } else {
    lines.push('可在积分明细中查看。')
  }
  return lines.join('\n')
}

module.exports = {
  SOURCE,
  COLLECTION,
  getDefaultConfig,
  normalizeConfig,
  resolveExpireDays,
  activeCoupons,
  buildPreview,
  describeConfig,
  buildMessageContent,
  validateConfigCoupons
}
