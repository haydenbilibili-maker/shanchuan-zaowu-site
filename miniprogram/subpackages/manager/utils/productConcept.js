/**
 * 爆品概念生成器 · 与 Admin productConcept.js 对齐（小程序端）
 */

const PRODUCT_TYPES = [
  { value: 'profit', name: '利润款', desc: '中高客单价，核心营收', priceRange: '500-2000', margin: '55', badge: '核心主力' },
  { value: 'traffic', name: '引流款', desc: '低单价，高复购', priceRange: '50-500', margin: '40', badge: '高频消费' },
  { value: 'premium', name: '形象款', desc: '极高单价，品牌调性', priceRange: '2000-10000', margin: '60', badge: '镇店之宝' },
  { value: 'gift', name: '礼赠款', desc: '礼盒 / 节日场景', priceRange: '198-1280', margin: '50', badge: '礼遇叙事' },
  { value: 'edu', name: '教育款', desc: '课程 / 亲子联动', priceRange: '128-880', margin: '48', badge: '研学转化' },
  { value: 'subscribe', name: '订阅款', desc: '复购包 / 季订', priceRange: '99-699/季', margin: '45', badge: '持续陪伴' },
  { value: 'collab', name: '联名限定', desc: 'IP / 季节限定', priceRange: '268-3680', margin: '55', badge: '稀缺窗口' }
]

const CATEGORY_OPTIONS = [
  { value: 'insect', label: '昆虫 / 蝴蝶（合规可售）' },
  { value: 'plant_fungi', label: '植物 / 菌类藏品' },
  { value: 'mineral', label: '矿物 / 晶体陈列' },
  { value: 'marine', label: '海洋生物（合规可售）' },
  { value: 'feather', label: '鸟类羽毛（合规可售向）' },
  { value: 'resin', label: '树脂 / 封存工艺品' },
  { value: 'scene', label: '综合生态场景' },
  { value: 'mixed', label: '混合文创组合' }
]

const INNOVATION_OPTIONS = [
  { value: 'design', label: '设计创新' },
  { value: 'craft', label: '材料与工艺' },
  { value: 'narrative', label: '场景叙事' },
  { value: 'channel_pack', label: '渠道包装' },
  { value: 'experience', label: '交互体验' },
  { value: 'sustain', label: '可持续 / 循环' },
  { value: 'ip_collab', label: 'IP / 联名' },
  { value: 'function', label: '功能延伸' }
]

const CHANNEL_OPTIONS = [
  { value: 'store', label: '线下门店体验' },
  { value: 'ecommerce', label: '电商 / 直播' },
  { value: 'gift', label: '礼赠渠道' },
  { value: 'b2b_edu', label: 'B 端教育 / 研学' },
  { value: 'exhibition', label: '展陈 / 快闪' }
]

const AUDIENCE_OPTIONS = [
  { value: 'family', label: '亲子家庭' },
  { value: 'designer', label: '设计师 / 美学向' },
  { value: 'collector', label: '收藏向爱好者' },
  { value: 'corp_gift', label: '企业礼赠' },
  { value: 'educator', label: '教育机构 / 导师' }
]

const CONCEPT_EXAMPLES = [
  {
    id: 'ex-steam-insect',
    label: '翅脉与金属画',
    productType: 'profit',
    category: 'insect',
    innovation: 'design',
    channel: 'ecommerce',
    audience: 'designer',
    notes: '金属与翅脉细节结合，适合都市家居陈列'
  },
  {
    id: 'ex-resin-traffic',
    label: '树脂果壳铃',
    productType: 'traffic',
    category: 'resin',
    innovation: 'experience',
    channel: 'store',
    audience: 'family',
    notes: '低门槛伴手礼，可衔接门店体验课'
  },
  {
    id: 'ex-gift-plant',
    label: '节气植物礼盒',
    productType: 'gift',
    category: 'plant_fungi',
    innovation: 'narrative',
    channel: 'gift',
    audience: 'corp_gift',
    notes: '二十四节气叙事，附产地故事卡'
  }
]

const STORAGE_KEY = 'sc_product_concepts_mp_v1'
const PREFILL_KEY = 'artisan_concept_prefill'

function labelOf(options, value) {
  const hit = (options || []).find((o) => o.value === value)
  return (hit && hit.label) || value || ''
}

function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) return null
  return list[Math.floor(Math.random() * list.length)]
}

function randomFilterCombo() {
  const type = pickRandom(PRODUCT_TYPES)
  return {
    productType: (type && type.value) || 'profit',
    category: (pickRandom(CATEGORY_OPTIONS) || {}).value || 'insect',
    innovation: (pickRandom(INNOVATION_OPTIONS) || {}).value || 'design',
    channel: (pickRandom(CHANNEL_OPTIONS) || {}).value || 'store',
    audience: (pickRandom(AUDIENCE_OPTIONS) || {}).value || 'family',
    notes: ''
  }
}

function filterOptionTags(concept) {
  const o = (concept && concept.options) || {}
  return [o.categoryLabel, o.innovationLabel, o.channelLabel, o.audienceLabel].filter(Boolean)
}

function conceptToPlainText(concept) {
  if (!concept) return ''
  const sp = (concept.sellingPoints || []).map((s, i) => `${i + 1}. ${s}`).join('\n')
  const channels = (concept.channels || []).map((s) => `- ${s}`).join('\n')
  const risks = (concept.risks || []).map((s) => `- ${s}`).join('\n')
  const actions = (concept.nextActions || []).map((s) => `- ${s}`).join('\n')
  const tags = filterOptionTags(concept)
  return [
    `# ${concept.name || '概念'}`,
    `定位：${concept.position || ''} · 建议价 ¥${concept.price || ''}`,
    `价格带：${concept.priceBand || ''} · 毛利 ${concept.margin || ''}%`,
    tags.length ? `条件：${tags.join(' · ')}` : '',
    '',
    '## 材质与工艺',
    concept.materials || '',
    '',
    '## 卖点',
    sp,
    '',
    '## 客群',
    concept.targetAudience || '',
    '',
    '## 策略',
    concept.strategy || '',
    '',
    '## 渠道建议',
    channels,
    '',
    '## 风险',
    risks,
    '',
    '## 下一步',
    actions
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function buildDescriptionFromConcept(concept) {
  if (!concept) return ''
  const parts = []
  if (concept.materials) parts.push(String(concept.materials).trim())
  const sp = (concept.sellingPoints || []).filter(Boolean)
  if (sp.length) parts.push(sp.map((s) => `· ${s}`).join('\n'))
  if (concept.targetAudience) parts.push(`适合：${String(concept.targetAudience).trim()}`)
  if (concept.strategy) parts.push(String(concept.strategy).trim())
  return parts.join('\n\n')
}

/** 带入上传藏品的结构化草案 */
function buildPrefillDraft(concept) {
  if (!concept) return null
  const priceNum = Number(String(concept.price || '').replace(/[^\d.]/g, ''))
  const tags = (concept.sellingPoints || [])
    .map((s) => String(s || '').replace(/^[\d.、．\s]+/, '').trim())
    .filter(Boolean)
    .map((s) => (s.length > 12 ? s.slice(0, 12) : s))
    .slice(0, 4)
  const o = concept.options || {}
  const notesBits = []
  if (o.categoryLabel) notesBits.push(o.categoryLabel)
  if (o.innovationLabel) notesBits.push(o.innovationLabel)
  return {
    title: String(concept.name || '').trim(),
    price: Number.isFinite(priceNum) && priceNum > 0 ? String(priceNum) : '',
    description: buildDescriptionFromConcept(concept),
    tags,
    origin: notesBits.join(' · '),
    giftEligible: o.productType === 'gift' || o.channel === 'gift',
    conceptId: concept.id || '',
    at: Date.now()
  }
}

function filterHistoryList(list, { filter, query } = {}) {
  const rows = Array.isArray(list) ? list : []
  const q = String(query || '').trim().toLowerCase()
  return rows.filter((c) => {
    if (filter === 'fav' && !c.favorite) return false
    if (!q) return true
    const o = c.options || {}
    const hay = [
      c.name,
      c.position,
      c.targetAudience,
      c.materials,
      c.strategy,
      ...(c.sellingPoints || []),
      o.categoryLabel,
      o.innovationLabel,
      o.channelLabel,
      o.audienceLabel
    ]
      .join(' ')
      .toLowerCase()
    return hay.indexOf(q) !== -1
  })
}

function friendlyClientError(err) {
  const msg = String((err && err.message) || err || '')
  if (/timeout|超时|TIMEOUT/i.test(msg)) {
    return '生成超时，请稍后重试'
  }
  if (/network|fail|request:fail/i.test(msg)) {
    return '网络异常，请检查后重试'
  }
  if (msg.length > 40) return `${msg.slice(0, 38)}…`
  return msg || '生成失败'
}

module.exports = {
  PRODUCT_TYPES,
  CATEGORY_OPTIONS,
  INNOVATION_OPTIONS,
  CHANNEL_OPTIONS,
  AUDIENCE_OPTIONS,
  CONCEPT_EXAMPLES,
  STORAGE_KEY,
  PREFILL_KEY,
  labelOf,
  randomFilterCombo,
  filterOptionTags,
  conceptToPlainText,
  buildDescriptionFromConcept,
  buildPrefillDraft,
  filterHistoryList,
  friendlyClientError
}
