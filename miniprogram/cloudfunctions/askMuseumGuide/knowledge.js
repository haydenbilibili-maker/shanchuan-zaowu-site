/**
 * 博物君 · 馆方知识（2026-11-23）
 *
 * 只写**已在小程序里公开**的事实，口径与对应页面同源：
 *   - 品牌名 / 品牌语：docs/品牌专项/01_品牌资产盘点与Logo概念对照.md §4
 *   - 1% 承诺：subpackages/business/donations/donationCopy.js、subpackages/feature/utils/onePercentPledge.js
 *   - 馆内功能：「我的」页与各功能页现状
 * 没公开的（门店地址、营业时间、价格、库存、活动、捐赠对象）一律不写 —— 让博物君指向页面，而不是编。
 *
 * 图鉴物种不在这里：按问题里提到的名字从 atlasDigest.js 现取（matchSpecies），省 token 也更准。
 */
const ATLAS = require('./atlasDigest')

const FUND_NAME = '山海造物公益基金'

const BRAND_FACTS = [
  '品牌：山海造物（英文 Nature\'s Creations），品牌语「把山海带回家」（Bring Nature Home）。',
  '山海造物是一座以自然标本为核心的博物馆式品牌：蝴蝶与昆虫、贝壳与海洋、矿物与化石、植物等标本的收藏、陈列与零售，也做自然教育与到馆参观。',
  '审美：克制、安静、像博物馆的标本签 —— 黄铜、墨色、纸面。',
  `1% 承诺：顾客在小程序的累计实付金额（扣券后、含运费），其 1% 由${FUND_NAME}代为捐赠，不另向顾客收费；退款同步扣回；钱包充值本身不计，余额花出去时才计；线下门店收银暂不计入。`,
  `捐赠去向四个方向：动植物保护、护林员关爱、国家公园建设、自然环境保护。按年度统一拨付，年度捐赠报告通过「山海有信」私信转呈。口号「取自山海，还于自然」。`,
  '标本来源：馆方强调合法来源与可追溯；涉及受保护物种时以国家法规为准。'
]

/** 馆内去处（key 与小程序 guideChat.ACTIONS 一一对应；博物君只能从这里挑） */
const PLACES = [
  { key: 'atlas', name: '山海图鉴', what: `收集馆里的物种页，共 ${ATLAS.species.length} 种、${ATLAS.series.length} 章（${ATLAS.series.map((s) => s.name).join('、')}）；在馆里发现、拍照或收藏都能翻开新的一页` },
  { key: 'identify', name: 'AI 标本鉴定', what: '拍一张标本或动植物照片，识别物种并给出科普，免费' },
  { key: 'care', name: '标本养护', what: '不同品类标本的安放、防潮、防虫、清洁与异常处理指南' },
  { key: 'booking', name: '预约参观', what: '预约到馆参观与课程；门店地址与开放时间以预约页为准' },
  { key: 'donations', name: '我的捐赠', what: '查看自己累计实付对应的 1% 捐赠额与去向' },
  { key: 'achievements', name: '我的成就', what: '浏览、收藏、分享、购买等行为点亮的徽章与积分' },
  { key: 'shop', name: '馆藏', what: '在售的标本与衍生品' }
]

function knowledgeText() {
  return [
    '【馆方事实】',
    ...BRAND_FACTS.map((f) => '- ' + f),
    '【馆内去处（只能推荐这些，用 key）】',
    ...PLACES.map((p) => `- ${p.key}｜${p.name}：${p.what}`),
    '【山海图鉴章节】',
    ...ATLAS.series.map((s) => `- ${s.name}（${s.count} 种）：${s.blurb}`)
  ].join('\n')
}

/**
 * 按问题与最近历史里出现的名字，取图鉴里的物种（最多 limit 个，长名字优先，避免「蝶」命中一切）。
 */
function matchSpecies(text, limit) {
  const t = String(text || '')
  if (!t) return []
  const hits = []
  ATLAS.species.forEach((s) => {
    let best = 0
    s.aliases.forEach((a) => {
      const name = String(a)
      if (name.length >= 2 && t.toLowerCase().indexOf(name.toLowerCase()) >= 0) best = Math.max(best, name.length)
    })
    if (best) hits.push({ s, best })
  })
  hits.sort((a, b) => b.best - a.best)
  return hits.slice(0, limit || 3).map((h) => h.s)
}

function speciesText(list) {
  if (!list.length) return ''
  return ['【图鉴里相关的物种（馆藏事实，可引用）】'].concat(list.map((s) =>
    `- No.${s.no} ${s.zh}（${s.latin}）｜${s.category}｜产地：${s.origin}｜习性：${s.habit}${s.series.length ? '｜图鉴章节：' + s.series.join('、') : ''}｜馆方短文：${s.essay}`
  )).join('\n')
}

module.exports = {
  FUND_NAME,
  BRAND_FACTS,
  PLACES,
  PLACE_KEYS: PLACES.map((p) => p.key),
  knowledgeText,
  matchSpecies,
  speciesText
}
