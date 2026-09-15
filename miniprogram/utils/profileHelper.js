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
  return !!(url && String(url).startsWith('cloud://'))
}

/** 微信占位/游客昵称：不可当作正式藏家代号 */
const INVALID_NICKNAMES = {
  微信用户: 1,
  未登录用户: 1,
  藏家: 1,
  用户: 1
}

/**
 * 清洗昵称：去空白、截断；无效占位返回空串
 */
function sanitizeNickName(raw) {
  const nick = String(raw || '').trim()
  if (!nick || INVALID_NICKNAMES[nick]) return ''
  return nick.slice(0, 20)
}

/**
 * 注册/礼赠预填：从 globalData → session → 会员卡快照带出有效昵称
 * （微信已无法静默 getUserProfile；正式回填依赖 input type=nickname 用户点选）
 */
function resolvePrefillNickName(appInstance) {
  try {
    const app = appInstance || (typeof getApp === 'function' ? getApp() : null)
    const gd = (app && app.globalData) || {}
    const fromUser = sanitizeNickName(
      (gd.userInfo && (gd.userInfo.nickName || gd.userInfo.nickname)) || ''
    )
    if (fromUser) return fromUser
    const su = (gd.userSession && gd.userSession.user) || null
    const fromSession = sanitizeNickName(su && (su.nickName || su.nickname))
    if (fromSession) return fromSession
    try {
      const snap = wx.getStorageSync('member_vip_card_snapshot_v1')
      const fromSnap = sanitizeNickName(snap && snap.nickName)
      if (fromSnap) return fromSnap
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
  return ''
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
      subline: '解锁生日礼券与专属祝福',
      isToday: false
    }
  }
  const parts = String(birthday).split('-')
  if (parts.length < 3) {
    return { hasBirthday: false, daysLeft: null, headline: '填写生日', subline: '解锁生日礼券与专属祝福', isToday: false }
  }
  const month = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return { hasBirthday: false, daysLeft: null, headline: '填写生日', subline: '解锁生日礼券与专属祝福', isToday: false }
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
    subline = '生日快乐 · 生日礼券已备好'
  } else if (daysLeft === 1) {
    headline = '明天'
    subline = `生日礼券即将送达 · ${dateLabel}`
  } else if (daysLeft <= 7) {
    subline = `生日将近 · 礼券将于当天送达`
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
  6: '/assets/icons/medal_gold.png',
  99: '/assets/icons/medal_gold.png'
}

/**
 * 六档标本元素 emoji（与 pages/user/index.js 的 CARD_SPECIMENS 保持一致）。
 * 用于会员等级阶梯每一档的元素标识。
 */
const LEVEL_SPECIMEN_EMOJI = {
  1: '🍀',
  2: '🦀',
  3: '🐞',
  4: '🦋',
  5: '🦎',
  6: '💎',
  99: '🏵'
}

function formatDiscount(rate) {
  if (!rate || rate >= 1) return '无折扣'
  const text = (rate * 10).toFixed(1).replace(/\.0$/, '')
  return `${text}折`
}

function isDrinkPerk(perk) {
  const blob = [
    perk && perk.title,
    perk && perk.label,
    perk && perk.desc,
    perk && perk.icon,
    typeof perk === 'string' ? perk : ''
  ].join(' ')
  return /饮品|咖啡|coffee|\bdrink\b|drink\.png/i.test(blob)
}

function normalizePerk(perk, index) {
  const n = String(index + 1).padStart(2, '0')
  if (!perk) {
    return { index: n, title: '', label: '', desc: '', icon: '/assets/icons/done.png' }
  }
  if (typeof perk === 'string') {
    return { index: n, title: perk, label: perk, desc: '', icon: '/assets/icons/done.png' }
  }
  const title = perk.title || perk.label || ''
  const label = perk.label || title
  return {
    index: n,
    title,
    label,
    desc: perk.desc || '',
    icon: perk.icon || '/assets/icons/done.png'
  }
}

/** 弹窗卡面明暗：浅底（纸/金属）用深字；深底（木/蟒皮）用浅字 */
function resolveSkinToneClass(level) {
  const n = Number(level)
  if (n === 3 || n === 4 || n === 99) return 'skin-tone-dark'
  return 'skin-tone-light'
}

function buildLevelBenefitsUI(levelBenefits) {
  return (levelBenefits || [])
    .filter((item) => item.level !== 99)
    .map((item) => {
      const perkItems = (item.perks || [])
        .filter((perk) => !isDrinkPerk(perk))
        .map((perk, index) => normalizePerk(perk, index))
      const levelNum = item.level === 99 ? 99 : Math.min(Math.max(Number(item.level) || 1, 1), 6)
      return {
        level: item.level,
        name: item.name,
        threshold: item.threshold,
        discount: formatDiscount(item.discount),
        discountRate: item.discount,
        benefits: perkItems.map((perk) => perk.label || perk.title).filter(Boolean),
        perkItems,
        icon: LEVEL_ICONS[item.level] || LEVEL_ICONS[1],
        specimenEmoji: LEVEL_SPECIMEN_EMOJI[item.level] || '',
        // 会员卡六档皮肤 class（完整字符串，供 wxml 直接绑定 .level-skin-N 规则）
        skinClass: `level-skin-${levelNum}`,
        toneClass: resolveSkinToneClass(levelNum)
      }
    })
}

/** 当前等级已解锁权益（含更低等级；折扣只保留当前档） */
function collectCurrentPerkItems(levelBenefits, level) {
  const list = buildLevelBenefitsUI(levelBenefits)
  const includeAll = Number(level) === 99
  const seen = {}
  const others = []
  let discountPerk = null
  list.forEach((row) => {
    if (!includeAll && row.level > level) return
    ;(row.perkItems || []).forEach((perk) => {
      const key = perk.label || perk.title
      if (!key || seen[key] || isDrinkPerk(perk)) return
      seen[key] = true
      if (/折/.test(key) || /折/.test(perk.title || '')) discountPerk = perk
      else others.push(perk)
    })
  })
  if (includeAll) {
    const honorary = (levelBenefits || []).find((item) => item.level === 99)
    ;(honorary && honorary.perks ? honorary.perks : []).forEach((perk) => {
      if (isDrinkPerk(perk)) return
      const item = normalizePerk(perk, others.length)
      const key = item.label || item.title
      if (!key || seen[key] || /全等级|全档/.test(key) || /全等级|全档/.test(item.title || '')) return
      seen[key] = true
      others.push(item)
    })
  }
  const items = discountPerk ? [discountPerk, ...others] : others
  return items.map((perk, index) => ({
    ...perk,
    index: String(index + 1).padStart(2, '0')
  }))
}

function getLevelBenefit(levelBenefits, level) {
  return (levelBenefits || []).find((item) => item.level === level) || null
}

function getNextLevelBenefit(levelBenefits, level) {
  const list = (levelBenefits || []).filter((item) => item.level !== 99 && item.level > level)
  return list.length ? list[0] : null
}

/** 云端占位名（等级6 / Lv6 等）→ 应用本地正式名 */
function isPlaceholderLevelName(name, level) {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^等级\s*\d+$/.test(n)) return true
  if (/^Lv\.?\s*\d+$/i.test(n)) return true
  if (/^Level\s*\d+$/i.test(n)) return true
  if (level != null && n === String(level)) return true
  // 已更名旧称，按占位处理以便 resolveDisplayLevelName / merge 落到正式名
  if (n === '琥珀·博物官') return true
  return false
}

/** 已知更名：旧本地名 → 以 defaults / Admin 新名为准 */
function isOutdatedLevelAlias(name, defName) {
  const n = String(name || '').trim()
  const d = String(defName || '').trim()
  if (!n || !d || n === d) return false
  if (n === '琥珀·博物官' && d === '星耀·博物官') return true
  return false
}

/**
 * 合并云端 ladder 与本地正式名：保留云端门槛/折扣；占位名与旧别名用 defaults；空权益补 defaults。
 * @param {Array} ladder 云端 levelLadder
 * @param {Array} defaults 本地 LEVEL_BENEFITS
 */
function mergeLevelLadderWithDefaults(ladder, defaults) {
  if (!Array.isArray(ladder) || !ladder.length) return ladder || []
  const defByLevel = {}
  ;(defaults || []).forEach((row) => {
    if (row && row.level != null) defByLevel[row.level] = row
  })
  return ladder.map((row) => {
    if (!row || row.level == null) return row
    const def = defByLevel[row.level]
    if (!def) return row
    const next = { ...row }
    if (
      def.name &&
      (isPlaceholderLevelName(row.name, row.level) || isOutdatedLevelAlias(row.name, def.name))
    ) {
      next.name = def.name
    }
    if ((!row.perks || !row.perks.length) && def.perks && def.perks.length) {
      next.perks = def.perks
    }
    return next
  })
}

/** 下一档专属权益短标签（排除折扣类，供会员卡一行提示） */
function pickNextExclusivePerkLabel(nextPreview) {
  if (!nextPreview) return ''
  const fromItems = (nextPreview.perkItems || [])
    .map((item) => item.label || item.title || '')
    .filter((label) => label && !/折/.test(label))
  const fromBenefits = (nextPreview.benefits || []).filter(
    (label) => label && !/折/.test(label)
  )
  const raw = fromItems[0] || fromBenefits[0] || ''
  if (!raw) return ''
  return raw.length > 8 ? `${raw.slice(0, 8)}…` : raw
}

/**
 * 会员卡成长里程提示（Museum Mode，一两行）
 * 数据来自 levelLadder / nextLevelPreview，勿写死档位。
 */
function buildGrowthMilestoneHint({
  level,
  discountRate,
  discountText,
  nextThreshold,
  growthGapDisplay,
  nextPreview
}) {
  const isHonorary = Number(level) === 99
  const hasNext = !isHonorary && Number(nextThreshold) > 0

  if (!hasNext) {
    return {
      growthIsMax: true,
      growthNextName: '',
      growthGapLine: '已达当前最高成长档',
      growthPerkDelta: ''
    }
  }

  const nextName = String((nextPreview && nextPreview.name) || '').trim()
  const gap = growthGapDisplay || '0'
  const currentDisc = discountText || formatDiscount(discountRate)
  let perkDelta = ''

  if (nextPreview) {
    const nextDisc = nextPreview.discount || formatDiscount(nextPreview.discountRate)
    const curRate = Number(discountRate)
    const nextRate = Number(nextPreview.discountRate)
    if (Number.isFinite(nextRate) && Number.isFinite(curRate) && nextRate < curRate) {
      perkDelta = currentDisc === '无折扣' ? `解锁${nextDisc}` : `${currentDisc}→${nextDisc}`
    } else {
      const exclusive = pickNextExclusivePerkLabel(nextPreview)
      if (exclusive) perkDelta = `解锁${exclusive}`
    }
  }

  return {
    growthIsMax: false,
    growthNextName: nextName,
    growthGapLine: nextName ? `距「${nextName}」还需 ${gap}` : `还需 ${gap}`,
    growthPerkDelta: perkDelta
  }
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
  sanitizeNickName,
  resolvePrefillNickName,
  formatDiscount,
  buildLevelBenefitsUI,
  resolveSkinToneClass,
  collectCurrentPerkItems,
  getLevelBenefit,
  getNextLevelBenefit,
  isPlaceholderLevelName,
  mergeLevelLadderWithDefaults,
  pickNextExclusivePerkLabel,
  buildGrowthMilestoneHint,
  buildInterestChips,
  LEVEL_ICONS
}
