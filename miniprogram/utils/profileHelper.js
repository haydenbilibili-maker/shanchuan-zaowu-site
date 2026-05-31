/**
 * 藏家档案 — 客户端工具
 */

const ZODIAC_RANGES = [
  { key: 'capricorn', start: [12, 22], end: [1, 19] },
  { key: 'aquarius', start: [1, 20], end: [2, 18] },
  { key: 'pisces', start: [2, 19], end: [3, 20] },
  { key: 'aries', start: [3, 21], end: [4, 19] },
  { key: 'taurus', start: [4, 20], end: [5, 20] },
  { key: 'gemini', start: [5, 21], end: [6, 21] },
  { key: 'cancer', start: [6, 22], end: [7, 22] },
  { key: 'leo', start: [7, 23], end: [8, 22] },
  { key: 'virgo', start: [8, 23], end: [9, 22] },
  { key: 'libra', start: [9, 23], end: [10, 23] },
  { key: 'scorpio', start: [10, 24], end: [11, 22] },
  { key: 'sagittarius', start: [11, 23], end: [12, 21] }
]

function isCloudFileId(url) {
  return url && (String(url).startsWith('cloud://') || String(url).startsWith('wxfile://'))
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return ''
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return 'MT-0000-0000'
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

function zodiacFromBirthday(birthday) {
  if (!birthday) return ''
  const parts = birthday.split('-')
  if (parts.length < 3) return ''
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)
  if (!month || !day) return ''

  for (let i = 0; i < ZODIAC_RANGES.length; i++) {
    const z = ZODIAC_RANGES[i]
    const [sm, sd] = z.start
    const [em, ed] = z.end
    if (sm === em) {
      if (month === sm && day >= sd && day <= ed) return z.key
    } else if (sm > em) {
      if ((month === sm && day >= sd) || (month === em && day <= ed)) return z.key
    } else if (month === sm && day >= sd) return z.key
    else if (month === em && day <= ed) return z.key
  }
  return ''
}

function calcProfileScore(user) {
  if (!user) return 0
  let score = 0
  if (user.avatarUrl && isCloudFileId(user.avatarUrl)) score += 15
  else if (user.avatarUrl) score += 8
  if (user.nickName && user.nickName !== '未登录用户' && user.nickName !== '藏家') score += 10
  if (user.phone) score += 25
  if (user.birthday) score += 15
  if (Array.isArray(user.interests) && user.interests.length > 0) score += 15
  if (user.gender) score += 5
  if (user.mbti) score += 8
  if (user.zodiac) score += 7
  return Math.min(100, score)
}

function resolveAuthState(user) {
  if (!user || !user.nickName) return 'guest'
  if (!user.onboardingDone && calcProfileScore(user) < 25) return 'guest'
  if (!user.phone) return 'registered'
  if (calcProfileScore(user) >= 60) return 'enriched'
  return 'verified_phone'
}

function getInterestLabels(keys, options) {
  const map = {}
  ;(options || []).forEach((o) => { map[o.key] = o.label })
  return (keys || []).map((k) => map[k] || k).slice(0, 3)
}

function getInterestTags(keys, options) {
  const map = {}
  ;(options || []).forEach((o) => { map[o.key] = o })
  return (keys || []).slice(0, 5).map((k) => {
    const item = map[k]
    return {
      key: k,
      label: item ? item.label : k,
      color: item ? item.color : '#C4A76C'
    }
  })
}

function birthdayCountdown(birthday) {
  if (!birthday) {
    return {
      hasBirthday: false,
      daysLeft: null,
      headline: '填写生日',
      subline: '解锁生日礼遇与专属祝福',
      isToday: false
    }
  }
  const parts = String(birthday).split('-')
  if (parts.length < 3) {
    return { hasBirthday: false, daysLeft: null, headline: '填写生日', subline: '解锁生日礼遇与专属祝福', isToday: false }
  }
  const month = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return { hasBirthday: false, daysLeft: null, headline: '填写生日', subline: '解锁生日礼遇与专属祝福', isToday: false }
  }

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), month, day)
  if (next < todayStart) {
    next = new Date(now.getFullYear() + 1, month, day)
  }

  const diffMs = next.getTime() - todayStart.getTime()
  const daysLeft = Math.round(diffMs / 86400000)
  const isToday = daysLeft === 0
  const dateLabel = `${parseInt(parts[1], 10)} 月 ${parseInt(parts[2], 10)} 日`

  let headline = `${daysLeft} 天`
  let subline = `距下次生日 · ${dateLabel}`
  if (isToday) {
    headline = '今天'
    subline = '生日快乐，藏家'
  } else if (daysLeft === 1) {
    headline = '明天'
    subline = `生日礼遇即将开启 · ${dateLabel}`
  }

  return { hasBirthday: true, daysLeft, headline, subline, isToday, dateLabel }
}

function formatCompactMoney(value) {
  const n = parseFloat(value)
  if (Number.isNaN(n) || n <= 0) return '¥0'
  if (n >= 100000) return `¥${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  if (n >= 10000) return `¥${(n / 10000).toFixed(2).replace(/\.?0+$/, '')}万`
  return `¥${n.toFixed(n >= 100 ? 0 : 2).replace(/\.?0+$/, '')}`
}

function formatCompactCount(value) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n <= 0) return '0'
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return String(n)
}

/** 成长值千分位展示 */
function formatGrowthDisplay(value) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 0) return '0'
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function zodiacLabelFromKey(key, zodiacOptions) {
  if (!key) return ''
  const item = (zodiacOptions || []).find((z) => z.key === key)
  return item ? item.label : ''
}

const LEVEL_ICONS = {
  1: '/assets/icons/knowledge.png',
  2: '/assets/icons/star.png',
  3: '/assets/icons/star-active.png',
  4: '/assets/icons/medal_gold.png',
  5: '/assets/icons/medal_gold.png',
  99: '/assets/icons/medal_gold.png'
}

function formatDiscount(rate) {
  if (!rate || rate >= 1) return '无折扣'
  const text = (rate * 10).toFixed(1).replace(/\.0$/, '')
  return `${text}折`
}

function buildLevelBenefitsUI(levelBenefits) {
  return (levelBenefits || [])
    .filter((item) => item.level !== 99)
    .map((item) => ({
      level: item.level,
      name: item.name,
      threshold: item.threshold,
      discount: formatDiscount(item.discount),
      discountRate: item.discount,
      benefits: item.perks || [],
      icon: LEVEL_ICONS[item.level] || LEVEL_ICONS[1]
    }))
}

function getLevelBenefit(levelBenefits, level) {
  return (levelBenefits || []).find((item) => item.level === level) || null
}

function getNextLevelBenefit(levelBenefits, level) {
  const list = (levelBenefits || []).filter((item) => item.level !== 99 && item.level > level)
  return list.length ? list[0] : null
}

/** 兴趣 Chip 展示列表（避免 WXML 内 indexOf 在真机失效） */
function buildInterestChips(interests, options) {
  const selectedSet = {}
  ;(interests || []).forEach((key) => {
    selectedSet[key] = true
  })
  return (options || []).map((opt) => {
    const selected = !!selectedSet[opt.key]
    const color = opt.color || '#C4A76C'
    return {
      ...opt,
      selected,
      activeStyle: selected
        ? `color:${color};border-color:${color};background-color:${color}22;font-weight:600;`
        : ''
    }
  })
}

module.exports = {
  maskPhone,
  buildMemberNo,
  zodiacFromBirthday,
  calcProfileScore,
  resolveAuthState,
  getInterestLabels,
  getInterestTags,
  birthdayCountdown,
  zodiacLabelFromKey,
  formatCompactMoney,
  formatCompactCount,
  formatGrowthDisplay,
  isCloudFileId,
  formatDiscount,
  buildLevelBenefitsUI,
  getLevelBenefit,
  getNextLevelBenefit,
  buildInterestChips,
  LEVEL_ICONS
}
