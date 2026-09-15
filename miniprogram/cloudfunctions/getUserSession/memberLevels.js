/**
 * 会员等级：优先读云库 member_levels，失败则用内置默认。
 * 折扣约定：discountRate 为结算乘数 ∈ (0,1]，如 0.98 = 9.8 折。
 * 兼容误填：9.8 → 0.98；98 → 0.98。
 */
const COLLECTION = 'member_levels'

/** 权威成长门槛：100 / 1000 / 2000 / 10000 / 30000 / 100000（与云库实表对齐） */
const DEFAULT_LEVELS = [
  {
    level: 1,
    name: '原木·见习者',
    threshold: 100,
    discountRate: 0.98,
    icon: '/assets/icons/knowledge.png',
    benefits: ['基础权益', '浏览收藏', '参与活动']
  },
  {
    level: 2,
    name: '秘银·采集家',
    threshold: 1000,
    discountRate: 0.95,
    icon: '/assets/icons/star.png',
    benefits: ['9.5折优惠', '优先预约', '生日礼券']
  },
  {
    level: 3,
    name: '流金·研究员',
    threshold: 2000,
    discountRate: 0.9,
    icon: '/assets/icons/star-active.png',
    benefits: ['9折优惠', '专属客服', '优先预约', '生日礼券']
  },
  {
    level: 4,
    name: '曜石·策展人',
    threshold: 10000,
    discountRate: 0.85,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['8.5折优惠', '专属客服', '优先预约', '生日礼券', '专属活动']
  },
  {
    level: 5,
    name: '星陨·守护者',
    threshold: 30000,
    discountRate: 0.8,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['8折优惠', '专属客服', '优先预约', '生日礼券', '专属活动', '定制服务']
  },
  {
    level: 6,
    name: '星耀·博物官',
    threshold: 100000,
    discountRate: 0.7,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['藏品 7 折', '私人鉴赏预约', '限量编号优先购']
  },
  {
    level: 99,
    name: '荣誉馆长',
    threshold: 0,
    discountRate: 0.7,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['荣誉身份', '全等级权益']
  }
]

function normalizeDiscountRate(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  if (n > 10) return Math.min(1, Math.round((n / 100) * 10000) / 10000)
  if (n > 1) return Math.min(1, Math.round((n / 10) * 10000) / 10000)
  return Math.round(n * 10000) / 10000
}

function normalizeBenefits(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((b) => {
      if (typeof b === 'string') return remapBirthdayBenefitText(b.trim())
      if (b && typeof b === 'object') {
        return remapBirthdayBenefitText(String(b.title || b.label || b.desc || '').trim())
      }
      return ''
    })
    .filter(Boolean)
}

/** 历史「生日礼遇/礼包」统一为「生日礼券」 */
function remapBirthdayBenefitText(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  if (t === '生日礼遇' || t === '生日礼包') return '生日礼券'
  return t.replace(/生日礼遇|生日礼包/g, '生日礼券')
}

function normalizeLevel(doc) {
  if (!doc || doc.level == null) return null
  const level = Number(doc.level)
  if (!Number.isFinite(level)) return null
  return {
    level,
    name: String(doc.name || `等级${level}`).trim() || `等级${level}`,
    threshold: Math.max(0, Math.floor(Number(doc.threshold) || 0)),
    discountRate: normalizeDiscountRate(
      doc.discountRate != null ? doc.discountRate : doc.discount
    ),
    icon: doc.icon || '/assets/icons/medal_gold.png',
    benefits: normalizeBenefits(doc.benefits || doc.privileges || doc.perks)
  }
}

function getDefaultLevels() {
  return DEFAULT_LEVELS.map((row) => normalizeLevel(row))
}

/** 云库占位名（等级6 / Lv6 等）→ 用代码默认正式名覆盖 */
function isPlaceholderLevelName(name, level) {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^等级\s*\d+$/.test(n)) return true
  if (/^Lv\.?\s*\d+$/i.test(n)) return true
  if (/^Level\s*\d+$/i.test(n)) return true
  if (level != null && n === String(level)) return true
  // 已更名：旧「琥珀·博物官」→「星耀·博物官」
  if (n === '琥珀·博物官') return true
  return false
}

/**
 * 误配的 500–50000 门槛种子（L2=500 / L6=50000 等）。
 * 命中后整表回退权威 DEFAULT_LEVELS（100–100000）。
 */
function looksLikeWrong500Ladder(levels) {
  const list = levels || []
  if (!list.length) return false
  const byLevel = new Map(
    list.map((l) => [Number(l.level), Math.floor(Number(l.threshold) || 0)])
  )
  if (byLevel.get(2) === 500) return true
  if (byLevel.get(6) === 50000) return true
  if (byLevel.get(1) === 0 && byLevel.get(3) === 3000) return true
  const paidDefaults = getDefaultLevels().filter((l) => l.level >= 1 && l.level <= 6)
  let mismatch = 0
  let wrongHits = 0
  const wrongByLevel = { 1: 0, 2: 500, 3: 3000, 4: 10000, 5: 30000, 6: 50000 }
  paidDefaults.forEach((def) => {
    const th = byLevel.get(def.level)
    if (th == null || th !== def.threshold) mismatch += 1
    if (th === wrongByLevel[def.level]) wrongHits += 1
  })
  return mismatch >= 3 && wrongHits >= 3
}

/**
 * @returns {{ levels: Array, source: 'cloud'|'default'|'cloud+default'|'default-repaired' }}
 */
async function loadMemberLevels(db) {
  try {
    const res = await db.collection(COLLECTION).limit(100).get()
    const rows = (res.data || []).map(normalizeLevel).filter(Boolean)
    if (!rows.length) return { levels: getDefaultLevels(), source: 'default' }

    if (looksLikeWrong500Ladder(rows)) {
      console.warn('loadMemberLevels: wrong 500–50000 ladder, using 100–100000 defaults')
      return { levels: getDefaultLevels(), source: 'default-repaired' }
    }

    const byLevel = new Map(rows.map((r) => [r.level, r]))
    // 云库若只种了 Lv1–5，补齐代码默认中的 Lv6 / 荣誉馆长；占位名/空权益用默认补齐
    let filled = false
    getDefaultLevels().forEach((def) => {
      const existing = byLevel.get(def.level)
      if (!existing) {
        byLevel.set(def.level, def)
        filled = true
        return
      }
      const next = { ...existing }
      let changed = false
      if (def.name && isPlaceholderLevelName(existing.name, existing.level)) {
        next.name = def.name
        changed = true
      }
      if ((!existing.benefits || !existing.benefits.length) && def.benefits && def.benefits.length) {
        next.benefits = def.benefits
        changed = true
      }
      if (!existing.icon && def.icon) {
        next.icon = def.icon
        changed = true
      }
      if (changed) {
        byLevel.set(def.level, next)
        filled = true
      }
    })
    const merged = Array.from(byLevel.values()).sort((a, b) => a.level - b.level)
    return { levels: merged, source: filled ? 'cloud+default' : 'cloud' }
  } catch (e) {
    console.warn('loadMemberLevels failed:', e && e.message)
    return { levels: getDefaultLevels(), source: 'default' }
  }
}

/**
 * 规范化 Admin 人工档位覆盖。
 * - floor：effectiveGrowth = max(自然成长, growthFloor)，保留自动升级
 * - exact：锁定到指定付费档，暂停自动升级直至清除
 * Lv99 荣誉馆长不走本字段（仍看 isHonorary）
 */
function normalizeLevelOverride(raw) {
  if (!raw || typeof raw !== 'object') return null
  const level = Number(raw.level)
  if (!Number.isFinite(level) || level < 1 || level === 99) return null
  const mode = String(raw.mode || 'floor').toLowerCase() === 'exact' ? 'exact' : 'floor'
  const growthFloor = Math.max(
    0,
    Math.floor(Number(raw.growthFloor != null ? raw.growthFloor : raw.threshold) || 0)
  )
  return {
    level: Math.floor(level),
    mode,
    growthFloor,
    note: String(raw.note || '').trim().slice(0, 200)
  }
}

function resolveFromPaidGrowth(paid, growth) {
  let current = paid[0] || {
    level: 1,
    name: '原木·见习者',
    threshold: 0,
    discountRate: 1
  }
  paid.forEach((row) => {
    if (growth >= row.threshold) current = row
  })
  const nextCandidates = paid.filter((l) => l.threshold > current.threshold)
  let nextThreshold = 0
  if (nextCandidates.length) {
    nextThreshold = nextCandidates.reduce((min, row) =>
      (row.threshold < min ? row.threshold : min), nextCandidates[0].threshold)
  }
  return {
    level: current.level,
    levelName: current.name,
    discountRate: current.discountRate,
    nextThreshold
  }
}

/**
 * @param {Array} levels
 * @param {number} growthValue 自然成长值（订单 + 门店）
 * @param {boolean} isHonorary
 * @param {object|null} [levelOverride] users.levelOverride
 */
function resolveMemberLevel(levels, growthValue, isHonorary, levelOverride) {
  const list = (levels && levels.length ? levels : getDefaultLevels()).slice()
  list.sort((a, b) => a.level - b.level)
  const growth = Math.max(0, Math.floor(Number(growthValue) || 0))
  const honorary = list.find((l) => l.level === 99)

  if (isHonorary) {
    return {
      level: 99,
      levelName: (honorary && honorary.name) || '荣誉馆长',
      discountRate: honorary ? honorary.discountRate : 0.8,
      nextThreshold: 0,
      overrideMode: '',
      effectiveGrowth: growth
    }
  }

  const paid = list.filter((l) => l.level !== 99)
  const ov = normalizeLevelOverride(levelOverride)

  if (ov && ov.mode === 'exact') {
    const locked = paid.find((l) => l.level === ov.level) || paid[0]
    const nextCandidates = paid.filter((l) => l.threshold > locked.threshold)
    let nextThreshold = 0
    if (nextCandidates.length) {
      nextThreshold = nextCandidates.reduce((min, row) =>
        (row.threshold < min ? row.threshold : min), nextCandidates[0].threshold)
    }
    return {
      level: locked.level,
      levelName: locked.name,
      discountRate: locked.discountRate,
      nextThreshold,
      overrideMode: 'exact',
      effectiveGrowth: growth
    }
  }

  const floorGrowth = ov && ov.mode === 'floor'
    ? Math.max(growth, ov.growthFloor)
    : growth
  const resolved = resolveFromPaidGrowth(paid, floorGrowth)
  const floorActive = !!(ov && ov.mode === 'floor' && floorGrowth > growth)
  return {
    ...resolved,
    overrideMode: floorActive ? 'floor' : (ov ? ov.mode : ''),
    effectiveGrowth: floorGrowth
  }
}

/** 转为客户端 profileConstants.LEVEL_BENEFITS 兼容结构 */
function toLevelLadder(levels) {
  return (levels || getDefaultLevels()).map((l) => ({
    level: l.level,
    name: l.name,
    threshold: l.threshold,
    discount: l.discountRate,
    perks: (l.benefits || []).map((text) => ({
      title: text,
      label: text,
      desc: text,
      icon: l.icon || '/assets/icons/done.png'
    }))
  }))
}

module.exports = {
  COLLECTION,
  DEFAULT_LEVELS,
  normalizeDiscountRate,
  normalizeLevel,
  getDefaultLevels,
  loadMemberLevels,
  normalizeLevelOverride,
  resolveMemberLevel,
  toLevelLadder
}
