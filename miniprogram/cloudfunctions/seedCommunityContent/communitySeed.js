const { MEDIA } = require('./cdn')
const { sectionsToHtml } = require('./seedHelpers')
const { applyExhibitionCopy } = require('./exhibitionCopy')
const { EXTENDED_ARTICLES, EXTENDED_EXHIBITIONS } = require('./communitySeedExtended')
const { REWRITE_ARTICLES, REWRITE_EXHIBITIONS } = require('./rewrite2026')

const SEED_VERSION = 'community_seed_v4'

/**
 * 应用 AI 重写叠加层（rewrite2026.js）。
 *
 * 只覆盖 brief / tags / 正文；seedKey、封面与正文内配图、stats、author、createTime、
 * 关联藏品与文章一律沿用原种子。传入的 rw 为 undefined 时原样返回，因此
 * 删掉 rewrite2026.js 里的某个 key 即可单独回滚那一条。
 */
function applyRewrite(doc, rw, { topicTag = false } = {}) {
  if (!rw) return doc
  const next = { ...doc }
  if (rw.brief) next.brief = rw.brief
  if (Array.isArray(rw.tags) && rw.tags.length) {
    const tags = rw.tags.slice()
    // 沿用 assistExhibitionCopy 的约定：展览标签必须含「专题」
    if (topicTag && !tags.includes('专题')) tags.unshift('专题')
    next.tags = tags
  }
  if (Array.isArray(rw.sections) && rw.sections.length) {
    next.content = sectionsToHtml(rw.sections)
  }
  return next
}

function articleDoc(seedKey, fields) {
  return {
    _seedKey: seedKey,
    _seedVersion: SEED_VERSION,
    _seedSource: 'seedCommunityContent',
    status: 'published',
    author: fields.author || '山海造物',
    isUGC: !!fields.isUGC,
    ...fields
  }
}

function exhibitionDoc(seedKey, fields) {
  return {
    _seedKey: seedKey,
    _seedVersion: SEED_VERSION,
    _seedSource: 'seedCommunityContent',
    type: 'exhibition',
    status: 'published',
    tags: fields.tags || ['专题'],
    ...fields,
    cover: fields.coverImage,
    relatedProductIds: fields.relatedProductIds || [],
    relatedSkus: fields.relatedSkus || [],
    relatedArticleSeedKeys: fields.relatedArticleSeedKeys || []
  }
}

const BASE = Date.now()

/** 早期基础内容（已去除测试字样，保留门店养护向笔记） */
const LEGACY_ARTICLES = [
  articleDoc('article_blue_morpho_light', {
    title: '蓝色闪蝶：翅面的光从哪里来',
    brief: '不是颜料，是结构色。走近一只 Morpho，你会看见光在翅鳞上被「筛」成蓝色。',
    category: 'knowledge',
    coverImage: MEDIA.insectCover,
    images: [MEDIA.insectCover, MEDIA.insectImages[0]],
    tags: ['昆虫', '闪蝶', '结构色'],
    author: '未晚 · 昆虫与植物',
    isUGC: true,
    stats: { views: 1280, likes: 86, comments: 12 },
    createTime: BASE - 86400000 * 2,
    content: sectionsToHtml([
      {
        title: '第一眼',
        body: '最常见的一问：「这蓝色是染上去的吗？」不是。闪蝶的翅面颜色，来自微观结构对光线的反射与干涉，而非化学色素。',
        tips: ['侧光观察时，蓝色会随角度变化', '避免长时间直射，结构色也会随时间变淡']
      },
      {
        title: '如何在家观赏',
        body: '把框画放在散射光环境，离南向窗有一定距离。偶尔换角度，翅面会像缓慢转动的金属片。',
        tips: ['不要用湿布擦拭翅面', '展柜内可放干燥剂，勿接触标本本体']
      }
    ])
  }),
  articleDoc('article_dry_cabinet_env', {
    title: '标本框里的干燥环境',
    brief: '干处、避晒、少碰——三件事说简单，做起来需要一点耐心。',
    category: 'knowledge',
    coverImage: MEDIA.insectImages[0],
    images: [MEDIA.insectImages[0], MEDIA.insectImages[1]],
    tags: ['养护', '环境'],
    author: '藏家 · 阿竹',
    isUGC: true,
    stats: { views: 960, likes: 54, comments: 8 },
    createTime: BASE - 86400000 * 4,
    content: sectionsToHtml([
      {
        title: '适宜湿度',
        body: '室内相对湿度 45–60% 较为稳妥。浴室、厨房旁、外墙内侧，都不适合长期挂框。',
        tips: ['梅雨季注意除湿', '空调直吹会让局部过干，框体可能轻微胀缩']
      }
    ])
  }),
  articleDoc('video_workshop_tour', {
    title: '工坊巡礼：制框日常',
    brief: '记录标本工坊里的一天——安静、细活、重复检查。',
    category: 'craft',
    coverImage: MEDIA.insectImages[4],
    images: [MEDIA.insectImages[4], MEDIA.insectImages[3]],
    tags: ['视频', '工坊', '制作'],
    author: '山海造物 · 工坊',
    isUGC: true,
    videoUrl: 'https://wxsnsdy.wxs.qq.com/105/0000000000000000000000000000000/0000000000000000000000000000000.mp4',
    stats: { views: 2340, likes: 156, comments: 28 },
    createTime: BASE - 86400000 * 3,
    content: sectionsToHtml([
      {
        title: '一日流程',
        body: '从干燥箱到框体组装，再到背板压合与终检。视频记录的是真实节奏——慢，但每一步都不可逆。',
        images: [MEDIA.insectImages[2]]
      }
    ])
  }),
  articleDoc('video_morpho_macro', {
    title: '闪蝶翅膀的微观世界',
    brief: '更高倍率下，翅面像排列整齐的微小镜片。',
    category: 'knowledge',
    coverImage: MEDIA.insectCover,
    images: [MEDIA.insectCover, MEDIA.insectImages[1]],
    tags: ['视频', '昆虫', '微观'],
    author: '陈野 · 博物插画',
    isUGC: true,
    videoUrl: 'https://wxsnsdy.wxs.qq.com/105/0000000000000000000000000000000/0000000000000000000000000000001.mp4',
    stats: { views: 1890, likes: 134, comments: 19 },
    createTime: BASE - 86400000 * 5,
    content: sectionsToHtml([
      {
        title: '微观结构',
        body: '翅鳞的脊与沟构成光栅，不同角度呈现不同波长。微观摄影建议固定机位，微调角度而非移动标本。',
        images: [MEDIA.insectImages[0]]
      }
    ])
  }),
  articleDoc('article_ugc_collector_note', {
    title: '我的书架上，第一格留给标本',
    brief: '分享一个真实的安放角落：散射光、少尘、刚好看见。',
    category: 'story',
    coverImage: MEDIA.plantImages[1],
    images: [MEDIA.plantImages[1], MEDIA.plantImages[0]],
    tags: ['收藏', '居家', '标本'],
    author: '藏家 · 阿竹',
    isUGC: true,
    stats: { views: 1320, likes: 145, comments: 18 },
    createTime: BASE - 86400000 * 1,
    content: sectionsToHtml([
      {
        title: '为什么是第一格',
        body: '进门能看见，但不直射。书架上混放书、押花与一只昆虫框，每天路过都会停一秒——这一秒就是标本存在的理由。',
        images: [MEDIA.plantImages[0]]
      }
    ])
  })
]

const LEGACY_EXHIBITIONS = [
  exhibitionDoc('exhibition_blue_morpho', {
    title: '蓝色闪蝶特展',
    latinName: 'Morpho menelaus',
    coverImage: MEDIA.insectCover,
    ...applyExhibitionCopy('exhibition_blue_morpho')
  }),
  exhibitionDoc('exhibition_museum_night', {
    title: '博物馆之夜：暖光下的标本柜',
    latinName: 'Curated Evening',
    coverImage: MEDIA.bannerMuseum,
    ...applyExhibitionCopy('exhibition_museum_night')
  })
]

const ARTICLES = [
  ...LEGACY_ARTICLES,
  ...EXTENDED_ARTICLES.map(({ _seedKey, ...rest }) => articleDoc(_seedKey, rest))
].map((doc) => applyRewrite(doc, REWRITE_ARTICLES[doc._seedKey]))

const EXHIBITIONS = [
  ...LEGACY_EXHIBITIONS,
  ...EXTENDED_EXHIBITIONS.map(({ _seedKey, ...rest }) => exhibitionDoc(_seedKey, rest))
].map((doc) => applyRewrite(doc, REWRITE_EXHIBITIONS[doc._seedKey], { topicTag: true }))

module.exports = {
  SEED_VERSION,
  ARTICLES,
  EXHIBITIONS
}
