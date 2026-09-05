/**
 * 与小程序 cloudfunctions 下各 memberLevels.js 对齐的默认等级与缺档合并。
 * 折扣约定：discountRate 为结算乘数 ∈ (0,1]，如 0.98 = 9.8 折。
 */

export const DEFAULT_LEVELS = [
  {
    level: 1,
    name: '原木·见习者',
    threshold: 0,
    discountRate: 1.0,
    icon: '/assets/icons/knowledge.png',
    benefits: ['基础会员身份', '每日签到积分']
  },
  {
    level: 2,
    name: '秘银·采集家',
    threshold: 500,
    discountRate: 0.98,
    icon: '/assets/icons/star.png',
    benefits: ['藏品 9.8 折']
  },
  {
    level: 3,
    name: '流金·研究员',
    threshold: 3000,
    discountRate: 0.95,
    icon: '/assets/icons/star-active.png',
    benefits: ['藏品 9.5 折', '优先预约名额']
  },
  {
    level: 4,
    name: '曜石·策展人',
    threshold: 10000,
    discountRate: 0.9,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['藏品 9 折', '生日礼券']
  },
  {
    level: 5,
    name: '星陨·守护者',
    threshold: 30000,
    discountRate: 0.85,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['藏品 8.5 折', '专属策展活动']
  },
  {
    level: 6,
    name: '星耀·博物官',
    threshold: 50000,
    discountRate: 0.8,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['藏品 8 折', '私人鉴赏预约', '限量编号优先购']
  },
  {
    level: 99,
    name: '荣誉馆长',
    threshold: 0,
    discountRate: 0.8,
    icon: '/assets/icons/medal_gold.png',
    benefits: ['荣誉身份', '全等级权益']
  }
]

/** 历史「生日礼遇/礼包」统一为「生日礼券」 */
export function remapBirthdayBenefitText(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  if (t === '生日礼遇' || t === '生日礼包') return '生日礼券'
  return t.replace(/生日礼遇|生日礼包/g, '生日礼券')
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

function normalizeDiscountRate(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  if (n > 10) return Math.min(1, Math.round((n / 100) * 10000) / 10000)
  if (n > 1) return Math.min(1, Math.round((n / 10) * 10000) / 10000)
  return Math.round(n * 10000) / 10000
}

export function normalizeLevel(doc) {
  if (!doc || doc.level == null) return null
  const level = Number(doc.level)
  if (!Number.isFinite(level)) return null
  return {
    ...(doc._id ? { _id: doc._id } : {}),
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

export function getDefaultLevels() {
  return DEFAULT_LEVELS.map((row) => normalizeLevel(row))
}

/** 云库占位名（等级6 / Lv6 等）→ 用代码默认正式名覆盖 */
export function isPlaceholderLevelName(name, level) {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^等级\s*\d+$/.test(n)) return true
  if (/^Lv\.?\s*\d+$/i.test(n)) return true
  if (/^Level\s*\d+$/i.test(n)) return true
  if (level != null && n === String(level)) return true
  if (n === '琥珀·博物官') return true
  return false
}

/**
 * 云库行与默认缺档合并（对齐小程序 loadMemberLevels）
 * @returns {{ levels: Array, source: 'cloud'|'default'|'cloud+default' }}
 */
export function mergeLevelsWithDefaults(rows) {
  const normalized = (rows || []).map(normalizeLevel).filter(Boolean)
  if (!normalized.length) {
    return { levels: getDefaultLevels(), source: 'default' }
  }
  const byLevel = new Map(normalized.map((r) => [r.level, r]))
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
    if ((!existing.benefits || !existing.benefits.length) && def.benefits?.length) {
      next.benefits = def.benefits.slice()
      changed = true
    } else if (existing.benefits?.length) {
      const remapped = normalizeBenefits(existing.benefits)
      if (remapped.join('\0') !== existing.benefits.join('\0')) {
        next.benefits = remapped
        changed = true
      }
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
}
