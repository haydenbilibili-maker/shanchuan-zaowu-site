/**
 * 商品「祈运标签」—— `miniprogram/config/blessTags.js` 的**副本**（云函数 manageProducts）。
 * ⚠️ 副本无法共享代码，必须与唯一事实源逐字同源：由 `miniprogram/scripts/check-bless-tags-sync.mjs` 守卫对账。
 */


/** 一个商品最多挂几个祈运标签（标签一多就等于没标签） */
const MAX_BLESS_TAGS = 3

const BLESS_TAGS = [
  {
    key: 'fortune',
    label: '求财',
    guide: '这面墙偏「求财」：摇一签，把想要的那件事写具体。',
    plays: ['qian', 'cookie']
  },
  {
    key: 'peace',
    label: '求安',
    guide: '这面墙偏「求安」：敲一下木鱼，把心先放下来。',
    plays: ['qian']
  },
  {
    key: 'study',
    label: '求学',
    guide: '这面墙偏「求学」：读一句贴士，顺着自己的性子来。',
    plays: ['mbti', 'qian']
  },
  {
    key: 'bond',
    label: '求缘',
    guide: '这面墙偏「求缘」：拆个签饼，看看今天该对谁好一点。',
    plays: ['cookie', 'zodiac']
  },
  {
    key: 'journey',
    label: '求行',
    guide: '这面墙偏「求行」：看一眼星座签，今天适合往外走。',
    plays: ['zodiac', 'cookie']
  },
  {
    key: 'success',
    label: '求成',
    guide: '这面墙偏「求成」：摇一签，把要做的那件事记下来。',
    plays: ['qian', 'mbti']
  }
]

/** 受控 key（顺序即展示顺序） */
const BLESS_TAG_KEYS = BLESS_TAGS.map((t) => t.key)

/**
 * 墙级默认祈运标签（P2-6 选项 B · 2026-09-24 产品点名会默认）
 *
 * 门店码 scene 只有 `k=mashangyou`、不带 bless 参数时，推荐行原先整块不渲染。
 * 不重印门店码（否决 A）、不接受「推荐只在商品页生效」（否决 C）—— 按 productKey
 * 在客户端推导墙级标签；**永不写库**，与 SCENE_BLESS 同形态。
 *
 * 假设：「马上有」默认墙语义偏「求财」（品牌名）；其它墙未登记则不兜底。
 */
const WALL_DEFAULT_BLESS = {
  mashangyou: ['fortune']
}

/**
 * @param {string} productKey
 * @returns {string[]} 受控标签；未知墙返回 []
 */
function wallDefaultBlessTags(productKey) {
  const key = String(productKey || '').trim() || 'mashangyou'
  const raw = WALL_DEFAULT_BLESS[key]
  return sanitizeBlessTags(raw || [])
}

/**
 * 礼赠场景 → 祈运标签（**写死的映射**，不是推断）。
 *
 * 为什么可以这样做：`giftScenes` 本身就是**人工策展**的字段（8 个场景，见 utils/giftScenes.js），
 * 语义上与"求什么"很近；映射表放在这里、逐条可评审，且只作为**兜底**（显式 `blessTags` 永远优先）。
 * 好处：存量商品没有 `blessTags` 也能立刻用上祈运提示与推荐，不必先做一轮数据回填。
 *
 * 映射理由（逐条）：乔迁→求安（安顿）；新婚/纪念日→求缘；生日/感恩→求安（愿平安）；
 * 升学→求学；毕业/新工作→求成（一程的收尾与开局）。
 */
const SCENE_BLESS = {
  housewarming: 'peace',
  wedding: 'bond',
  birthday: 'peace',
  anniversary: 'bond',
  enrollment: 'study',
  graduation: 'success',
  new_job: 'success',
  gratitude: 'peace'
}

/** 祈运标签 → 该标签对应的礼赠场景（云函数按场景兜底查询时用） */
const BLESS_SCENES = BLESS_TAG_KEYS.reduce((acc, key) => {
  acc[key] = Object.keys(SCENE_BLESS).filter((scene) => SCENE_BLESS[scene] === key)
  return acc
}, {})

/** 从礼赠场景推导祈运标签（受控、去重、按 SSOT 顺序） */
function blessTagsFromScenes(scenes) {
  const list = Array.isArray(scenes) ? scenes : String(scenes || '').split(',')
  const hit = list.map((x) => SCENE_BLESS[String(x || '').trim()]).filter(Boolean)
  return sanitizeBlessTags(hit)
}

/**
 * 商品祈运标签（**唯一入口**）：显式 `blessTags` 优先，没有就用礼赠场景兜底推导。
 * 页面 / 入口 / 云函数都用这一个函数，保证三端算出来的是同一组标签。
 */
function resolveBlessTags(product) {
  const explicit = sanitizeBlessTags(product && product.blessTags)
  if (explicit.length) return explicit
  return blessTagsFromScenes(product && product.giftScenes)
}

/** 某个祈运标签对应的礼赠场景（云函数查询兜底用） */
function scenesForBless(key) {
  return (BLESS_SCENES[String(key || '')] || []).slice()
}

function getBlessTag(key) {
  const k = String(key || '').trim().toLowerCase()
  return BLESS_TAGS.find((t) => t.key === k) || null
}

/**
 * 归一化祈运标签：只留受控 key、去重、**按 SSOT 顺序输出**（不是输入顺序 —— 确定性优先，
 * 否则同一件商品在不同端保存后的顺序不同，diff 与守卫都没法比）。
 * @param {Array|string} list 数组，或逗号分隔的字符串（URL 参数用）
 */
function sanitizeBlessTags(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(',')
  const picked = BLESS_TAG_KEYS.filter((key) => raw.map((x) => String(x || '').trim().toLowerCase()).includes(key))
  return picked.slice(0, MAX_BLESS_TAGS)
}

/** 从商品行读祈运标签（字段缺失/脏数据都容错，返回合法数组） */
function readBlessTags(row) {
  return sanitizeBlessTags(row && row.blessTags)
}

function blessLabel(key) {
  const t = getBlessTag(key)
  return t ? t.label : ''
}

/**
 * 祈运标签 → 推荐玩法顺序（保序去重）。
 * 页面据此把玩法瓦片按"这面墙求什么"重排：**只重排，不隐藏** ——
 * 玩法是给用户的自由，标签只影响"先看到哪个"（隐藏玩法等于替用户做决定，也更难解释）。
 */
function blessPlayIds(keys) {
  const out = []
  sanitizeBlessTags(keys).forEach((key) => {
    const t = getBlessTag(key)
    if (!t) return
    t.plays.forEach((id) => {
      if (!out.includes(id)) out.push(id)
    })
  })
  return out
}

/** 这面墙的一句祈运提示（取第一个标签；没有标签就返回空串，页面不显示） */
function blessGuide(keys) {
  const first = sanitizeBlessTags(keys)[0]
  const t = getBlessTag(first)
  return t ? t.guide : ''
}

module.exports = {
  MAX_BLESS_TAGS,
  BLESS_TAGS,
  BLESS_TAG_KEYS,
  SCENE_BLESS,
  BLESS_SCENES,
  WALL_DEFAULT_BLESS,
  wallDefaultBlessTags,
  blessTagsFromScenes,
  resolveBlessTags,
  scenesForBless,
  getBlessTag,
  sanitizeBlessTags,
  readBlessTags,
  blessLabel,
  blessPlayIds,
  blessGuide
}
