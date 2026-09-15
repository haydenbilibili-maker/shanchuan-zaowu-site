/**
 * 标本养护 — 云函数拉取 + 本地 fallback
 */
const {
  GUIDES,
  CATEGORY_CARDS,
  GENERAL_TIPS,
  getGuideByCategory,
  normalizeCategory
} = require('./careDefaults')

function normalizeGuideDoc(doc) {
  if (!doc) return null
  const sections = (doc.sections || []).map((s, i) => ({
    key: s.key || `section_${i}`,
    title: s.title || '',
    body: s.body || '',
    tips: s.tips || []
  }))
  return {
    guideId: doc.guideId || '',
    category: normalizeCategory(doc.category),
    title: doc.title || '',
    overline: doc.overline || doc.category || '',
    summary: doc.summary || '',
    disclaimer: doc.disclaimer || '',
    sections,
    framingAddons: doc.framingAddons || []
  }
}

function guidesArrayToMap(guides) {
  const map = { ...GUIDES }
  if (!Array.isArray(guides)) return map
  guides.forEach((g) => {
    const normalized = normalizeGuideDoc(g)
    if (normalized && normalized.category) {
      map[normalized.category] = normalized
    }
  })
  return map
}

async function fetchCareHub() {
  try {
    const res = await wx.cloud.callFunction({ name: 'getCareGuides', data: {} })
    const result = res.result || {}
    if (result.success) {
      const cards = (result.categoryCards && result.categoryCards.length)
        ? result.categoryCards
        : CATEGORY_CARDS
      const tips = (result.generalTips && result.generalTips.length)
        ? result.generalTips
        : GENERAL_TIPS
      const guidesMap = (result.source === 'db' && result.guides && result.guides.length)
        ? guidesArrayToMap(result.guides)
        : GUIDES
      return {
        guidesMap,
        categoryCards: cards,
        generalTips: tips,
        source: result.source || 'default'
      }
    }
  } catch (e) {
    console.warn('fetchCareHub', e)
  }
  return {
    guidesMap: GUIDES,
    categoryCards: CATEGORY_CARDS,
    generalTips: GENERAL_TIPS,
    source: 'default'
  }
}

async function fetchCareGuide(category) {
  const cat = normalizeCategory(category)
  try {
    const res = await wx.cloud.callFunction({
      name: 'getCareGuides',
      data: { category: cat }
    })
    const result = res.result || {}
    if (result.success && result.guide) {
      const guide = normalizeGuideDoc(result.guide) || getGuideByCategory(cat)
      if (guide.sections && guide.sections.length) {
        return { guide, source: result.source || 'default', ok: true }
      }
    }
    if (result.success && result.guides && result.guides.length) {
      const hit = result.guides.find((g) => normalizeCategory(g.category) === cat)
      if (hit) {
        const guide = normalizeGuideDoc(hit)
        if (guide && guide.sections && guide.sections.length) {
          return { guide, source: result.source || 'db', ok: true }
        }
      }
    }
    if (result.success) {
      return { guide: getGuideByCategory(cat), source: result.source || 'default', ok: true }
    }
  } catch (e) {
    console.warn('fetchCareGuide', e)
  }
  return { guide: getGuideByCategory(cat), source: 'default', ok: false }
}

function getSeasonalTip() {
  const month = new Date().getMonth() + 1
  if (month >= 6 && month <= 8) {
    return {
      key: 'summer',
      title: '夏季提醒',
      desc: '空调直吹与车窗高温需留意，运输与陈列请避开长时间暴晒。'
    }
  }
  if (month >= 3 && month <= 5) {
    return {
      key: 'spring',
      title: '春季提醒',
      desc: '回南天与梅雨季前后，注意除湿与框体背板是否受潮。'
    }
  }
  if (month >= 11 || month <= 2) {
    return {
      key: 'winter',
      title: '冬季提醒',
      desc: '暖气与壁炉附近温差大，避免藏品紧贴热源或外墙。'
    }
  }
  return {
    key: 'autumn',
    title: '秋季提醒',
    desc: '换季湿度波动时，适合检查挂钉、干燥剂与展柜通风。'
  }
}

module.exports = {
  fetchCareHub,
  fetchCareGuide,
  normalizeGuideDoc,
  getSeasonalTip
}
