/**
 * 爆品概念生成器 · 共享定位与金字塔数据
 * 供 ProductConceptGenerator 与战略看板产品金字塔复用
 */

/** 定位 / 价格带类型（概念生成器用；含价格元数据） */
export const PRODUCT_TYPES = [
  {
    value: 'profit',
    name: '利润款',
    icon: '💎',
    desc: '中高客单价，核心营收',
    priceRange: '500-2000',
    margin: '55',
    badge: '核心主力'
  },
  {
    value: 'traffic',
    name: '引流款',
    icon: '🛍️',
    desc: '低单价，高复购',
    priceRange: '50-500',
    margin: '40',
    badge: '高频消费'
  },
  {
    value: 'premium',
    name: '形象款',
    icon: '👑',
    desc: '极高单价，品牌调性',
    priceRange: '2000-10000',
    margin: '60',
    badge: '镇店之宝'
  },
  {
    value: 'gift',
    name: '礼赠款',
    icon: '🎁',
    desc: '礼盒 / 商务 / 节日场景',
    priceRange: '198-1280',
    margin: '50',
    badge: '礼遇叙事'
  },
  {
    value: 'edu',
    name: '教育款',
    icon: '📚',
    desc: '课程 / 亲子 / 教具联动',
    priceRange: '128-880',
    margin: '48',
    badge: '研学转化'
  },
  {
    value: 'subscribe',
    name: '订阅款',
    icon: '🔁',
    desc: '复购包 / 季订会员',
    priceRange: '99-699/季',
    margin: '45',
    badge: '持续陪伴'
  },
  {
    value: 'collab',
    name: '联名限定',
    icon: '✨',
    desc: 'IP 联名、季节限定',
    priceRange: '268-3680',
    margin: '55',
    badge: '稀缺窗口'
  }
]

/**
 * 战略看板「产品金字塔」仍用经典三层（形象 / 利润 / 引流）
 * 勿把礼赠/教育等扩展定位塞进金字塔视觉，以免破坏三层结构
 */
export const PRODUCT_PYRAMID = [
  {
    name: '形象款',
    type: 'premium',
    badge: '镇店之宝',
    icon: '👑',
    description: '极高单价，提升品牌调性',
    priceRange: '2000-10000',
    targetShare: '10',
    margin: '60',
    products: ['大型生态缸', '稀有收藏级标本', '定制作品'],
    strategy: '品牌展示，吸引高端客户，提升品牌溢价'
  },
  {
    name: '利润款',
    type: 'profit',
    badge: '核心主力',
    icon: '💎',
    description: '中高客单价，主要营收来源',
    priceRange: '500-2000',
    targetShare: '40',
    margin: '55',
    products: ['蝴蝶装饰画', '昆虫标本画', '植物标本框'],
    strategy: '核心营收，体现品牌审美，保持高毛利'
  },
  {
    name: '引流款',
    type: 'traffic',
    badge: '高频消费',
    icon: '🛍️',
    description: '低单价，高复购，易标准化',
    priceRange: '50-500',
    targetShare: '50',
    margin: '40',
    products: ['树脂饰品', '果壳铃', '小型标本'],
    strategy: '流量获取，降低购买门槛，提高转化率'
  }
]

/** 产品类别（合规可售标本 / 自然文创语境） */
export const CATEGORY_OPTIONS = [
  { value: 'insect', label: '昆虫 / 蝴蝶（合规可售）' },
  { value: 'plant_fungi', label: '植物 / 菌类标本' },
  { value: 'mineral', label: '矿物 / 晶体陈列' },
  { value: 'marine', label: '海洋生物（合规可售）' },
  { value: 'feather', label: '鸟类羽毛（合规可售向）' },
  { value: 'resin', label: '树脂 / 封存工艺品' },
  { value: 'scene', label: '综合生态场景' },
  { value: 'mixed', label: '混合文创组合' }
]

/** 创新方向 */
export const INNOVATION_OPTIONS = [
  { value: 'design', label: '设计创新' },
  { value: 'craft', label: '材料与工艺' },
  { value: 'narrative', label: '场景叙事' },
  { value: 'channel_pack', label: '渠道包装' },
  { value: 'experience', label: '交互体验' },
  { value: 'sustain', label: '可持续 / 循环' },
  { value: 'ip_collab', label: 'IP / 联名' },
  { value: 'function', label: '功能延伸' }
]

/** 渠道场景 */
export const CHANNEL_OPTIONS = [
  { value: 'store', label: '线下门店体验' },
  { value: 'ecommerce', label: '电商 / 直播' },
  { value: 'gift', label: '礼赠渠道' },
  { value: 'b2b_edu', label: 'B 端教育 / 研学' },
  { value: 'exhibition', label: '展陈 / 快闪' }
]

/** 目标客群 */
export const AUDIENCE_OPTIONS = [
  { value: 'family', label: '亲子家庭' },
  { value: 'designer', label: '设计师 / 美学向' },
  { value: 'collector', label: '收藏向爱好者' },
  { value: 'corp_gift', label: '企业礼赠' },
  { value: 'educator', label: '教育机构 / 导师' }
]

/** 一键填入示例（覆盖新类型与筛选项） */
export const CONCEPT_EXAMPLES = [
  {
    id: 'ex-steam-insect',
    label: '蒸汽朋克昆虫装饰画',
    productType: 'profit',
    category: 'insect',
    innovation: 'design',
    channel: 'ecommerce',
    audience: 'designer',
    notes: '面向都市家居礼赠，金属齿轮与蝴蝶翅脉结合，适合小红书种草'
  },
  {
    id: 'ex-resin-traffic',
    label: '树脂果壳铃引流款',
    productType: 'traffic',
    category: 'resin',
    innovation: 'experience',
    channel: 'store',
    audience: 'family',
    notes: '低门槛伴手礼，门店体验课转化入口，强调可触摸与拍照打卡'
  },
  {
    id: 'ex-marine-premium',
    label: '深海标本形象款',
    productType: 'premium',
    category: 'marine',
    innovation: 'craft',
    channel: 'exhibition',
    audience: 'collector',
    notes: '高端收藏与门店形象展陈，强调稀缺叙事与合规来源证明'
  },
  {
    id: 'ex-gift-plant',
    label: '节气植物礼盒',
    productType: 'gift',
    category: 'plant_fungi',
    innovation: 'narrative',
    channel: 'gift',
    audience: 'corp_gift',
    notes: '二十四节气叙事礼盒，商务与节日双场景，附可扫码产地故事卡'
  },
  {
    id: 'ex-edu-insect',
    label: '亲子昆虫研学套装',
    productType: 'edu',
    category: 'insect',
    innovation: 'experience',
    channel: 'b2b_edu',
    audience: 'family',
    notes: '标本观察 + 课程手册 + 门店导览二维码，仅使用合规可售标本品类'
  },
  {
    id: 'ex-sub-mineral',
    label: '矿物季订会员包',
    productType: 'subscribe',
    category: 'mineral',
    innovation: 'channel_pack',
    channel: 'ecommerce',
    audience: 'collector',
    notes: '每季一盒主题晶体与养护指南，强调复购节奏与社群拆箱仪式'
  },
  {
    id: 'ex-collab-scene',
    label: '季节限定生态场景',
    productType: 'collab',
    category: 'scene',
    innovation: 'ip_collab',
    channel: 'store',
    audience: 'designer',
    notes: '与自然主题 IP 联名的可陈列微型生态场景，窗口期 6–8 周'
  }
]

export const STORAGE_KEY = 'sc_product_concepts_v1'
export const BRIDGE_KEY = 'sc_product_concept_for_strategy'
export const MODULE_TAB_ID = '58'

export function labelOf(options, value) {
  return options.find((o) => o.value === value)?.label || value || ''
}

export function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) return null
  return list[Math.floor(Math.random() * list.length)]
}

/** 随机组合：定位 + 类别 + 创新 + 渠道 + 客群 */
export function randomFilterCombo() {
  const type = pickRandom(PRODUCT_TYPES)
  return {
    productType: type?.value || 'profit',
    category: pickRandom(CATEGORY_OPTIONS)?.value || 'insect',
    innovation: pickRandom(INNOVATION_OPTIONS)?.value || 'design',
    channel: pickRandom(CHANNEL_OPTIONS)?.value || 'store',
    audience: pickRandom(AUDIENCE_OPTIONS)?.value || 'family',
    notes: ''
  }
}
