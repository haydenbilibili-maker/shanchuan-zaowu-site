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
    // 2026-09-17 口径：新客不再发积分（改为一张真实的「满99减10」券，见下）
    points: 0,
    pointsEnabled: false,
    excludeGrowth: true,
    couponsEnabled: true,
    expireDays: 90,
    stackable: false,
    priority: 100,
    // 与线上 member_welcome_gift（小程序-我的-超管工作台-新会员礼包）逐字对齐：
    // 满49减5 / 满99减10 / 满299减30 / 满499减50 / 满999减100（共 5 张）
    // 各档门槛均高于折扣地板 ceil(value/0.25)，兜底配置也发不出穿底券
    coupons: [
      { id: 'c5', enabled: true, value: 5, minSpend: 49, expireDays: 90, count: 1, title: '新会员礼券 · 5元', channel: 'all' },
      { id: 'c10', enabled: true, value: 10, minSpend: 99, expireDays: 90, count: 1, title: '新会员礼券 · 10元', channel: 'all' },
      { id: 'c30', enabled: true, value: 30, minSpend: 299, expireDays: 90, count: 1, title: '新会员礼券 · 30元', channel: 'all' },
      { id: 'c50', enabled: true, value: 50, minSpend: 499, expireDays: 90, count: 1, title: '新会员礼券 · 50元', channel: 'all' },
      { id: 'c100', enabled: true, value: 100, minSpend: 999, expireDays: 90, count: 1, title: '新会员礼券 · 100元', channel: 'all' }
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
  return validateCouponsActivatable(src, coupons)
}

/**
 * 「礼券总开关开着，却没有任何启用中的券行」= 静默停发。
 *
 * 真实事故（2026-09-15 与 2026-09-16 各一次）：超管工作台/ERP 保存时把 4 条券行
 * 全部存成 `enabled:false`，而 `couponsEnabled` 仍是 true。发券侧 `activeCoupons()`
 * 只取启用行 → 新用户照发 100 积分、礼券 0 张，且 `describeConfig` 只显示积分，
 * 界面完全看不出来；注册用户也拿不到「补领」入口（见 upsertUserProfile 的 anomaly 留痕）。
 * 这里把「会静默停发的配置」挡在保存之前，而不是等用户反馈。
 *
 * 只拦「有券行但全部不可用」；券行为空时 normalizeConfig 会回落到代码兜底档位，
 * 不是停发，故不在此报错。
 */
function validateCouponsActivatable(config, coupons) {
  const src = config && typeof config === 'object' ? config : {}
  if (src.couponsEnabled === false) return { ok: true }
  if (!coupons.length) return { ok: true }
  const active = coupons.filter((row) => {
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

/** 展开券档位为逐张槽位；slotKey 唯一标识「应发的一张券」 */
function expandSlots(config) {
  const slots = []
  activeCoupons(config).forEach((coupon) => {
    const n = Math.max(0, Math.floor(coerceNumber(coupon.count)) || 0)
    for (let i = 0; i < n; i += 1) {
      slots.push({ ...coupon, slotKey: `${coupon.id || coupon.value}:${i}` })
    }
  })
  return slots
}

/**
 * 已发券条款对齐计划（礼包配置 = 唯一真源）。
 *
 * 背景：超管工作台是礼包配置的最高频写入场景，门槛/标题/渠道属热更新字段；
 * 但券在发放时把条款拍成了快照，且旧逻辑在「券已齐」时直接 return，
 * 导致改配置后老会员永远停留在旧门槛（历史事故：配置满49，页面仍显示满50）。
 *
 * 安全边界（宁可不动，不可改错）：
 *  - 只对齐未使用券；used / expired / locked 是历史凭证与退款依据，一律不动。
 *  - 优先按 slotKey 精确匹配；无 slotKey 时仅在该面额只对应唯一天然档位时才回退匹配。
 *  - 档位被删除 → 保留原条款，不猜。
 *  - 档位 id 被复用于不同面额 → 视为另一张券，跳过（面额 value 绝不改写）。
 *
 * @returns {{ items: Array<{_id: string, slotKey: string, patch: object}>, skipped: number, unchanged: number }}
 */
function buildCouponAlignPlan(config, coupons) {
  const slots = expandSlots(config)
  const bySlotKey = new Map()
  const valueCount = new Map()
  slots.forEach((slot) => {
    bySlotKey.set(String(slot.slotKey), slot)
    const key = String(slot.value)
    valueCount.set(key, (valueCount.get(key) || 0) + 1)
  })
  // 仅当某面额在配置中唯一时才允许「无 slotKey」回退匹配，避免 c10s/c10 同类歧义
  const uniqueByValue = new Map()
  slots.forEach((slot) => {
    if (valueCount.get(String(slot.value)) === 1) uniqueByValue.set(String(slot.value), slot)
  })

  const items = []
  let skipped = 0
  let unchanged = 0
  ;(coupons || []).forEach((coupon) => {
    if (!coupon || !coupon._id) return
    const src = String(coupon.source || coupon.couponSource || '')
    if (src !== SOURCE) { skipped += 1; return }
    const status = String(coupon.status || 'unused')
    if (status !== 'unused' && status !== 'available') { skipped += 1; return }
    let slot = coupon.slotKey != null && coupon.slotKey !== ''
      ? bySlotKey.get(String(coupon.slotKey))
      : null
    if (!slot) slot = uniqueByValue.get(String(coupon.value))
    if (!slot) { skipped += 1; return }
    if (Number(slot.value) !== Number(coupon.value)) { skipped += 1; return }

    const patch = {}
    if (Number(coupon.minSpend) !== Number(slot.minSpend)) patch.minSpend = slot.minSpend
    if (String(coupon.title || '') !== String(slot.title || '')) patch.title = slot.title
    // 缺 channel 的旧券语义上等同 'all'，不要为它产生无意义的写入；
    // 但若配置收窄为 store/online，仍需把它纠正过来。
    const couponChannel = String(coupon.channel || 'all').trim().toLowerCase() || 'all'
    const slotChannel = String(slot.channel || 'all').trim().toLowerCase() || 'all'
    if (couponChannel !== slotChannel) patch.channel = slot.channel
    if (!Object.keys(patch).length) { unchanged += 1; return }
    patch.termsSyncedAt = Date.now()
    items.push({ _id: coupon._id, slotKey: String(slot.slotKey), patch })
  })
  return { items, skipped, unchanged }
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
  // 显式告警：总开关开着但券行全停时，摘要原先只显示「100 积分」，
  // 运营在 ERP/超管工作台完全看不出「新用户不会收到礼券」（2026-09-16 事故）。
  const allCouponsOff = !!cfg.couponsEnabled
    && Array.isArray(cfg.coupons) && cfg.coupons.length > 0
    && !coupons.length
  if (!parts.length) {
    return allCouponsOff
      ? '⚠️ 礼券总开关已开，但所有券行都停用了：新用户不会收到礼券'
      : '新会员礼包已启用，但积分与礼券均为空'
  }
  const stack = cfg.stackable ? '可叠加' : '不可叠加（一单一券）'
  const warn = allCouponsOff ? '；⚠️ 礼券总开关已开但所有券行都停用，新用户不会收到礼券' : ''
  return `新会员礼包：${parts.join(' + ')}；${stack}；折扣不低于7.5折${warn}`
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
  expandSlots,
  buildCouponAlignPlan,
  buildPreview,
  describeConfig,
  buildMessageContent,
  validateConfigCoupons
}
