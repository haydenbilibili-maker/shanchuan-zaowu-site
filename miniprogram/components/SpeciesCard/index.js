// 物种识别结果卡片
function buildTaxTags(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return []
  const order = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']
  const labels = { kingdom: '界', phylum: '门', class: '纲', order: '目', family: '科', genus: '属' }
  const out = []
  order.forEach((key) => {
    const v = taxonomy[key]
    if (v) out.push(`${labels[key]} · ${v}`)
  })
  return out
}

function starsFromConfidence(c) {
  const n = Math.max(0, Math.min(5, Math.round((Number(c) || 0) * 5)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

function confidenceLabel(level, conf) {
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
    rootCategoryTag: { type: String, value: '' }
  },

  data: {
    displayImage: '',
    taxTags: [],
    starText: '',
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
      const starText = starsFromConfidence(conf)
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
        starText,
        warningText,
        showPhotoTips,
        confidenceDesc: confidenceLabel(confidenceLevel, conf)
      })
    }
  },

  methods: {
    toggleExpand() {
      this.setData({ expanded: !this.data.expanded })
    }
  }
})
