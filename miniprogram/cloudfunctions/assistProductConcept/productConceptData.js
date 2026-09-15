/** 与 Admin productConcept.js 对齐（爆品概念生成器） */

const PRODUCT_TYPES = [
  { value: 'profit', name: '利润款', desc: '中高客单价，核心营收', priceRange: '500-2000', margin: '55' },
  { value: 'traffic', name: '引流款', desc: '低单价，高复购', priceRange: '50-500', margin: '40' },
  { value: 'premium', name: '形象款', desc: '极高单价，品牌调性', priceRange: '2000-10000', margin: '60' },
  { value: 'gift', name: '礼赠款', desc: '礼盒 / 商务 / 节日场景', priceRange: '198-1280', margin: '50' },
  { value: 'edu', name: '教育款', desc: '课程 / 亲子 / 教具联动', priceRange: '128-880', margin: '48' },
  { value: 'subscribe', name: '订阅款', desc: '复购包 / 季订会员', priceRange: '99-699/季', margin: '45' },
  { value: 'collab', name: '联名限定', desc: 'IP 联名、季节限定', priceRange: '268-3680', margin: '55' }
]

const CATEGORY_OPTIONS = [
  { value: 'insect', label: '昆虫 / 蝴蝶（合规可售）' },
  { value: 'plant_fungi', label: '植物 / 菌类标本' },
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

function labelOf(options, value) {
  const hit = (options || []).find((o) => o.value === value)
  return (hit && hit.label) || value || ''
}

function typeMeta(value) {
  return PRODUCT_TYPES.find((t) => t.value === value) || null
}

function snapshotFromEvent(event) {
  const e = event || {}
  const productType = String(e.productType || 'profit').trim()
  const category = String(e.category || 'insect').trim()
  const innovation = String(e.innovation || 'design').trim()
  const channel = String(e.channel || 'store').trim()
  const audience = String(e.audience || 'family').trim()
  const notes = String(e.notes || '').trim()
  const pt = typeMeta(productType)
  return {
    productType,
    category,
    innovation,
    channel,
    audience,
    notes,
    productTypeLabel: pt ? pt.name : '',
    categoryLabel: labelOf(CATEGORY_OPTIONS, category),
    innovationLabel: labelOf(INNOVATION_OPTIONS, innovation),
    channelLabel: labelOf(CHANNEL_OPTIONS, channel),
    audienceLabel: labelOf(AUDIENCE_OPTIONS, audience)
  }
}

function buildPrompt(snap, opts) {
  const productType = typeMeta(snap.productType)
  if (!productType) throw new Error('无效产品定位')
  const randomSeed = Math.floor(Math.random() * 10000)
  const notes = snap.notes
  const variantOf = opts && opts.variantOfName ? String(opts.variantOfName).trim() : ''
  const batchIndex = opts && opts.batchIndex != null ? Number(opts.batchIndex) : null
  const baseHint = variantOf
    ? `\n这是基于「${variantOf}」的变体方案，请保留定位与客群方向，但品名、卖点与材质必须明显不同。`
    : ''
  const batchHint =
    batchIndex != null && Number.isFinite(batchIndex)
      ? `\n这是同条件批量生成的第 ${batchIndex + 1} 个变体，请与同批其他方案在品名、叙事角度、材质组合上明显区分。`
      : ''

  return `你是山海造物（Nature's Creations）标本艺术馆的产品设计师。品牌气质是「维多利亚博物学家的奇珍柜」：克制、具体、有触感细节，像铜牌档案而非电商话术。

文案禁忌：
- 禁止「爆款必买」「打卡必去」「全网最低」「限时秒杀」等直播/促销话术
- 禁止 emoji、夸张感叹号堆砌、空洞形容词堆叠
- 仅使用合规可售的标本 / 自然文创品类，勿建议违法采集或禁售物种

请基于以下信息，生成一个可立项的 SKU 概念方案（随机种子 ${randomSeed}，内容需独特）：

产品定位：${productType.name}（${productType.desc}）
价格区间：¥${productType.priceRange}
目标毛利率：${productType.margin}%
产品类别：${snap.categoryLabel}
创新方向：${snap.innovationLabel}
渠道场景：${snap.channelLabel}
目标客群筛选项：${snap.audienceLabel}
${notes ? `补充约束：${notes}` : ''}
${baseHint}${batchHint}

卖点、材质、策略用朋友式语气：事实 → 感受 → 连接。各字段宜短：品名≤16字，卖点每条≤28字，材质≤80字，客群/策略各≤60字。

仅返回 JSON（无 markdown）：
{
  "name": "品名",
  "position": "${productType.name}",
  "price": "数字",
  "priceBand": "¥${productType.priceRange}",
  "margin": "数字",
  "materials": "材质工艺",
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "targetAudience": "客群（呼应「${snap.audienceLabel}」）",
  "strategy": "策略（呼应「${snap.channelLabel}」）",
  "channels": ["渠道1", "渠道2"],
  "risks": ["风险1", "风险2"],
  "nextActions": ["动作1", "动作2", "动作3"]
}`
}

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function normalizeConcept(raw, meta) {
  const snap = meta.optionsSnapshot || {}
  const productType = typeMeta(snap.productType)
  const price = String(raw.price ?? '').replace(/[^\d.]/g, '') || String(raw.price || '')
  return {
    id: meta.id || `concept_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name: String(raw.name || '').trim() || '未命名概念',
    position: String(raw.position || (productType && productType.name) || '').trim(),
    price,
    priceBand: String(raw.priceBand || (productType ? `¥${productType.priceRange}` : '')).trim(),
    margin: String(raw.margin ?? (productType && productType.margin) ?? '').replace(/%/g, ''),
    materials: String(raw.materials || '').trim(),
    sellingPoints: asList(raw.sellingPoints).slice(0, 6),
    targetAudience: String(raw.targetAudience || '').trim(),
    strategy: String(raw.strategy || '').trim(),
    channels: asList(raw.channels).slice(0, 5),
    risks: asList(raw.risks).slice(0, 5),
    nextActions: asList(raw.nextActions).slice(0, 5),
    favorite: Boolean(meta.favorite),
    createdAt: meta.createdAt || Date.now(),
    options: snap,
    variantOf: meta.variantOf || null
  }
}

module.exports = {
  PRODUCT_TYPES,
  CATEGORY_OPTIONS,
  INNOVATION_OPTIONS,
  CHANNEL_OPTIONS,
  AUDIENCE_OPTIONS,
  snapshotFromEvent,
  buildPrompt,
  normalizeConcept,
  typeMeta
}
