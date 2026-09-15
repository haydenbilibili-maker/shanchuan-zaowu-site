// 物种识别结果卡片
const { toChineseTaxonomy, translateTaxonValue } = require('../../utils/taxonomyZh')

function buildTaxTags(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return []
  const zh = toChineseTaxonomy(taxonomy)
  const order = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']
  const labels = { kingdom: '界', phylum: '门', class: '纲', order: '目', family: '科', genus: '属' }
  const out = []
  order.forEach((key) => {
    const v = translateTaxonValue(zh[key])
    if (v) out.push(`${labels[key]} · ${v}`)
  })
  return out
}

function confidencePct(conf) {
  const n = Number(conf)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(4, Math.min(100, Math.round(n * 100)))
}

function confidenceLabel(level) {
  if (level === 'high') return '较高 · 可作为参考'
  if (level === 'medium') return '中等 · 建议对照细节'
  return '偏低 · 建议重新拍摄'
}

Component({
  properties: {
    imageUrl: { type: String, value: '' },
    speciesInfo: { type: Object, value: {} },
    aiContent: { type: Object, value: {} },
    confidenceLevel: { type: String, value: 'high' },
    showConfidence: { type: Boolean, value: true },
    rootCategoryTag: { type: String, value: '' },
    protectionTags: { type: Array, value: [] },
    protectionEmpty: { type: Boolean, value: false },
    protectionEmptyLabel: { type: String, value: '暂无等级' },
    protectionSummary: { type: String, value: '' },
    showProtection: { type: Boolean, value: false }
  },

  data: {
    displayImage: '',
    taxTags: [],
    confPct: 0,
    confTone: 'high',
    expanded: false,
    warningText: '',
    confidenceDesc: '',
    showPhotoTips: false
  },

  observers: {
    'speciesInfo, imageUrl, confidenceLevel': function (speciesInfo, imageUrl, confidenceLevel) {
      const tax = speciesInfo && speciesInfo.taxonomy
      const tags = buildTaxTags(tax)
      const conf = speciesInfo && speciesInfo.confidence
      const confPct = confidencePct(conf)
      let warningText = ''
      let showPhotoTips = false
      if (speciesInfo && speciesInfo.is_specimen === false) {
        warningText = '未检测到生物标本，请拍摄标本或动植物照片'
        showPhotoTips = true
      } else if (confidenceLevel === 'low' || (typeof conf === 'number' && conf < 0.85 && conf > 0)) {
        warningText = '识别不太确定，建议按下方提示重新拍摄'
        showPhotoTips = true
      }
      this.setData({
        displayImage: imageUrl || '',
        taxTags: tags,
        confPct,
        confTone: confidenceLevel || 'high',
        warningText,
        showPhotoTips,
        confidenceDesc: confidenceLabel(confidenceLevel)
      })
    }
  },

  methods: {
    toggleExpand() {
      this.setData({ expanded: !this.data.expanded })
    }
  }
})
