/**
 * 标本定制默认配置（DB 无数据时 fallback）
 */

const STEPS = [
  { id: 1, key: 'specimen', label: '标本', en: 'SPECIMEN', title: '选标本', desc: '从馆藏中挑选可定制标本，每件配有物种信息' },
  { id: 2, key: 'frame', label: '装裱', en: 'FRAMING', title: '选装裱', desc: '框型、规格与标本师，决定装裱气质与交期' },
  { id: 3, key: 'packaging', label: '包装', en: 'PACKAGING', title: '选包装', desc: '标准保护或礼盒包装，随单附品牌物种卡' },
  { id: 4, key: 'gift', label: '赠礼', en: 'GIFTING', title: '赠礼与卡片', desc: '手写祝福与仪式卡，把标本变成可送出的礼物' },
  { id: 5, key: 'preview', label: '确认', en: 'PREVIEW', title: '定制预览', desc: '核对方案与预估价格，满意后下单制作' }
]

const CATEGORY_PILLS = [
  { id: '', label: '全部' },
  { id: 'INSECTA', label: '昆虫' },
  { id: 'PLANTAE', label: '植物' },
  { id: 'MARINE', label: '海洋' },
  { id: 'MINERALS', label: '矿石' }
]

const DEFAULT_FRAMES = [
  {
    id: 'frame_wood_classic',
    type: 'frame',
    name: '经典木框',
    desc: '原木色细框，适合大多数昆虫与植物标本',
    priceDelta: 0,
    sort: 1
  },
  {
    id: 'frame_metal_slim',
    type: 'frame',
    name: '窄边金属框',
    desc: '黄铜色细框，轻量博物馆风格',
    priceDelta: 120,
    sort: 2
  },
  {
    id: 'frame_museum',
    type: 'frame',
    name: '博物馆复刻框',
    desc: '加厚框体与深度衬底，适合珍藏级标本',
    priceDelta: 280,
    sort: 3
  }
]

const DEFAULT_PACKAGING = [
  {
    id: 'pkg_standard',
    type: 'packaging',
    name: '标准包装',
    desc: '品牌手提袋 + 缓冲材 + 品牌胶带',
    priceDelta: 0,
    sort: 1
  },
  {
    id: 'pkg_gift_box',
    type: 'packaging',
    name: '天地盖礼盒',
    desc: '暖灰纸盒 + 绒布内衬，外素内美',
    priceDelta: 68,
    sort: 2
  },
  {
    id: 'pkg_birthday',
    type: 'packaging',
    name: '生日礼盒',
    desc: '限定腰封与贴纸，适合赠礼',
    priceDelta: 98,
    theme: 'birthday',
    sort: 3
  }
]

const DEFAULT_FRAMERS = [
  {
    id: 'framer_store',
    name: '门店标本师',
    type: 'store',
    bio: '由门店按序制作，标准交期',
    priceDelta: 0,
    extraDays: 0
  }
]

const ESTIMATED_DAYS = 7

const PRODUCTION_STATUS_LABELS = {
  pending_make: '待制作',
  framing: '装裱中',
  packing: '包装中',
  shipped: '已发出'
}

module.exports = {
  STEPS,
  CATEGORY_PILLS,
  DEFAULT_FRAMES,
  DEFAULT_PACKAGING,
  DEFAULT_FRAMERS,
  ESTIMATED_DAYS,
  PRODUCTION_STATUS_LABELS
}
