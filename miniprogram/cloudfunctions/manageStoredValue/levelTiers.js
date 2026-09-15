/**
 * 充值档位 ↔ 会员等级门槛对照
 * 权威门槛：L1–L6 = 100 / 1000 / 2000 / 10000 / 30000 / 100000（云库曾用实表）
 * 云库 member_levels 可读时优先用云数据；若命中错误的 500–50000 种子则回退本表。
 */

const COLLECTION = 'member_levels'

/**
 * L1–L6 付费成长门槛（金额即充值档；¥1 = 1 成长值）
 * 折扣：discountRate 为结算乘数，如 0.98 = 9.8 折
 */
const DEFAULT_PAID_LEVELS = [
  { level: 1, name: '原木·见习者', threshold: 100, discountRate: 0.98 },
  { level: 2, name: '秘银·采集家', threshold: 1000, discountRate: 0.95 },
  { level: 3, name: '流金·研究员', threshold: 2000, discountRate: 0.9 },
  { level: 4, name: '曜石·策展人', threshold: 10000, discountRate: 0.85 },
  { level: 5, name: '星陨·守护者', threshold: 30000, discountRate: 0.8 },
  { level: 6, name: '星耀·博物官', threshold: 100000, discountRate: 0.7 }
]

/** 曾误写入代码/云库的 500–50000 门槛（应纠正为本表） */
const WRONG_THRESHOLDS_BY_LEVEL = {
  1: 0,
  2: 500,
  3: 3000,
  4: 10000,
  5: 30000,
  6: 50000
}

function looksLikeWrong500Ladder(levels) {
  const list = levels || []
  if (!list.length) return false
  const byLevel = new Map(
    list.map((l) => [Number(l.level), Math.floor(Number(l.threshold) || 0)])
  )
  // 典型错误：L2=500 或 L6=50000（正表为 L2=1000 / L6=100000）
  if (byLevel.get(2) === 500) return true
  if (byLevel.get(6) === 50000) return true
  if (byLevel.get(1) === 0 && byLevel.get(3) === 3000) return true
  let mismatch = 0
  DEFAULT_PAID_LEVELS.forEach((def) => {
    const th = byLevel.get(def.level)
    if (th == null || th !== def.threshold) mismatch += 1
  })
  // 与正表对不上超过一半，且像 500 系种子
  if (mismatch >= 3) {
    const wrongHits = DEFAULT_PAID_LEVELS.filter((def) => {
      const th = byLevel.get(def.level)
      return th === WRONG_THRESHOLDS_BY_LEVEL[def.level]
    }).length
    return wrongHits >= 3
  }
  return false
}

function normalizeDiscountRate(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  if (n > 10) return Math.min(1, Math.round((n / 100) * 10000) / 10000)
  if (n > 1) return Math.min(1, Math.round((n / 10) * 10000) / 10000)
  return Math.round(n * 10000) / 10000
}

function formatDiscountLabel(rate) {
  const r = normalizeDiscountRate(rate)
  if (r >= 0.999) return '无折扣'
  const zhe = Math.round(r * 1000) / 100
  if (Math.abs(zhe - Math.round(zhe)) < 0.001) return `${Math.round(zhe)} 折`
  return `${zhe} 折`
}

function formatDiscountShort(rate) {
  return formatDiscountLabel(rate).replace(/\s/g, '')
}

/**
 * 由会员门槛生成默认充值档位（分）— L1–L6 六档
 */
function buildDefaultPackagesFromLevels(levels) {
  const paid = (levels && levels.length ? levels : DEFAULT_PAID_LEVELS)
    .filter((l) => l.level !== 99 && Number(l.threshold) > 0)
    .slice()
    .sort((a, b) => a.threshold - b.threshold)

  return paid.map((row, index) => {
    const yuan = Math.floor(Number(row.threshold) || 0)
    const payFen = yuan * 100
    return {
      id: `T${yuan}`,
      name: `充值 ${yuan}`,
      payFen,
      principalFen: payFen,
      bonusFen: 0,
      sort: (index + 1) * 10,
      enabled: true,
      level: row.level,
      levelName: row.name,
      threshold: yuan,
      discountRate: normalizeDiscountRate(row.discountRate)
    }
  })
}

function getDefaultLevelPackages() {
  return buildDefaultPackagesFromLevels(DEFAULT_PAID_LEVELS)
}

async function loadPaidLevels(db) {
  try {
    const res = await db.collection(COLLECTION).limit(100).get()
    const rows = (res.data || [])
      .map((doc) => {
        const level = Number(doc.level)
        if (!Number.isFinite(level) || level === 99) return null
        const threshold = Math.max(0, Math.floor(Number(doc.threshold) || 0))
        if (threshold <= 0) return null
        return {
          level,
          name: String(doc.name || `Lv${level}`).trim() || `Lv${level}`,
          threshold,
          discountRate: normalizeDiscountRate(
            doc.discountRate != null ? doc.discountRate : doc.discount
          )
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.threshold - b.threshold)

    if (!rows.length) return { levels: DEFAULT_PAID_LEVELS.slice(), source: 'default' }

    // 错误的 500–50000 种子 → 回退 100–100000 正表
    if (looksLikeWrong500Ladder(rows)) {
      console.warn('loadPaidLevels: wrong 500–50000 ladder, using 100–100000 defaults')
      return { levels: DEFAULT_PAID_LEVELS.slice(), source: 'default-repaired' }
    }

    // 云库缺档时用默认补齐
    const byLevel = new Map(rows.map((r) => [r.level, r]))
    DEFAULT_PAID_LEVELS.forEach((def) => {
      if (!byLevel.has(def.level)) byLevel.set(def.level, def)
    })
    const merged = Array.from(byLevel.values()).sort((a, b) => a.threshold - b.threshold)
    return { levels: merged, source: 'cloud' }
  } catch (e) {
    console.warn('loadPaidLevels', e && e.message)
    return { levels: DEFAULT_PAID_LEVELS.slice(), source: 'default' }
  }
}

function matchLevelForPayFen(levels, payFen) {
  const yuan = Math.floor((Number(payFen) || 0) / 100)
  if (yuan <= 0) return null
  const list = (levels && levels.length ? levels : DEFAULT_PAID_LEVELS).slice()
  // 精确对齐门槛优先；否则取不超过该金额的最高档（用于自定义金额说明）
  const exact = list.find((l) => l.threshold === yuan)
  if (exact) return exact
  let best = null
  list.forEach((l) => {
    if (l.threshold > 0 && l.threshold <= yuan) {
      if (!best || l.threshold > best.threshold) best = l
    }
  })
  return best
}

function enrichPackageWithLevel(pkg, levels) {
  const payFen = Number(pkg && pkg.payFen) || 0
  const points = Math.floor(payFen / 100)
  const matched = matchLevelForPayFen(levels, payFen)
  const exact = matched && matched.threshold === points
  const discountLabel = matched ? formatDiscountLabel(matched.discountRate) : ''
  const discountShort = matched ? formatDiscountShort(matched.discountRate) : ''

  let levelHint = ''
  if (exact && matched) {
    levelHint = `对齐 Lv${matched.level} ${matched.name} 门槛；到达后指定藏品 ${discountShort}`
  } else if (matched) {
    levelHint = `累计成长达 Lv${matched.level} 后，指定藏品 ${discountShort}`
  } else {
    levelHint = '充值计入成长值；到达对应等级后享会员折扣'
  }

  return {
    ...pkg,
    points,
    pointsHint: points > 0 ? `到账后得 ${points} 积分` : '',
    level: matched ? matched.level : 0,
    levelName: matched ? matched.name : '',
    threshold: matched ? matched.threshold : 0,
    discountRate: matched ? matched.discountRate : 1,
    discountLabel,
    discountShort,
    levelHint,
    exactLevelMatch: !!exact
  }
}

function enrichPackages(packages, levels) {
  return (packages || []).map((p) => enrichPackageWithLevel(p, levels))
}

/** 更早的储值默认档（非会员门槛） */
const LEGACY_PACKAGE_IDS = ['T100', 'T300', 'T500', 'T1000']

/** 误配的 500–50000 五档 */
const WRONG_500_PACKAGE_IDS = ['T500', 'T3000', 'T10000', 'T30000', 'T50000']

function looksLikeLegacyDefaultPackages(packages) {
  if (!Array.isArray(packages) || packages.length !== 4) return false
  const ids = packages.map((p) => String(p.id || '')).sort()
  const legacy = LEGACY_PACKAGE_IDS.slice().sort()
  return ids.every((id, i) => id === legacy[i])
}

function looksLikeWrong500Packages(packages) {
  if (!Array.isArray(packages) || packages.length !== 5) return false
  const ids = packages.map((p) => String(p.id || '')).sort()
  const wrong = WRONG_500_PACKAGE_IDS.slice().sort()
  return ids.every((id, i) => id === wrong[i])
}

module.exports = {
  COLLECTION,
  DEFAULT_PAID_LEVELS,
  LEGACY_PACKAGE_IDS,
  WRONG_500_PACKAGE_IDS,
  normalizeDiscountRate,
  formatDiscountLabel,
  formatDiscountShort,
  buildDefaultPackagesFromLevels,
  getDefaultLevelPackages,
  loadPaidLevels,
  matchLevelForPayFen,
  enrichPackageWithLevel,
  enrichPackages,
  looksLikeLegacyDefaultPackages,
  looksLikeWrong500Packages,
  looksLikeWrong500Ladder
}
