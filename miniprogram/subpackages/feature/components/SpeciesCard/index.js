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
    showProtection: { type: Boolean, value: false },
    // 仪式感（2026-10-18）：true = 刚鉴定完，中文名墨迹晕开、学名逐字敲出、置信度随后填满；点标本牌可跳过
    typewriter: { type: Boolean, value: false }
  },

  data: {
    displayImage: '',
    taxTags: [],
    confPct: 0,
    confTone: 'high',
    expanded: false,
    warningText: '',
    confidenceDesc: '',
    showPhotoTips: false,
    latinShown: '',
    latinTyping: false,
    confReady: true,
    inkIn: false
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
      this._syncLatin(speciesInfo)
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

  lifetimes: {
    detached() {
      this._stopTyping()
    }
  },

  methods: {
    /** 学名展示：typewriter 时只在第一次拿到学名时逐字敲出；其余情况直接全文 */
    _syncLatin(speciesInfo) {
      const latin = String((speciesInfo && speciesInfo.species_name_latin) || '')
      if (!this.data.typewriter || !latin || this._typedFor === latin) {
        if (!this._typing) this.setData({ latinShown: latin, latinTyping: false, confReady: true })
        return
      }
      this._typedFor = latin
      this._stopTyping()
      this._typing = true
      this.setData({ latinShown: '', latinTyping: true, confReady: false, inkIn: true })
      const step = Math.max(35, Math.min(75, Math.round(1300 / latin.length)))
      let i = 0
      this._typeTimer = setTimeout(() => {
        this._typeTimer = setInterval(() => {
          i += 1
          this.setData({ latinShown: latin.slice(0, i) })
          if (i >= latin.length) this._finishTyping()
        }, step)
      }, 520)
    },

    _stopTyping() {
      if (this._typeTimer) {
        clearTimeout(this._typeTimer)
        clearInterval(this._typeTimer)
        this._typeTimer = null
      }
    },

    _finishTyping() {
      this._stopTyping()
      this._typing = false
      this.setData({ latinShown: this._typedFor || this.data.latinShown, latinTyping: false, confReady: true })
    },

    /** 点标本牌：跳过打字，直接全文 */
    skipTyping() {
      if (this._typing) this._finishTyping()
    },

    toggleExpand() {
      this.setData({ expanded: !this.data.expanded })
    }
  }
})
