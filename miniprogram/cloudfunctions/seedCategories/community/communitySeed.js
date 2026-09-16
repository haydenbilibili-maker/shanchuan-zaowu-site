const { MEDIA } = require('./cdn')
const { sectionsToHtml, pick } = require('./seedHelpers')
const { EXTENDED_ARTICLES, EXTENDED_EXHIBITIONS } = require('./communitySeedExtended')
const { REWRITE_ARTICLES, REWRITE_EXHIBITIONS } = require('./rewrite2026')
const { REPOST_ARTICLES } = require('./repostSeeds2026')

const SEED_VERSION = 'community_seed_v5'

/**
 * 应用 AI 重写叠加层（与 seedCommunityContent 共用同一份 rewrite2026.js）。
 *
 * 本函数的 communitySeed/communityClear 与 seedCommunityContent 写的是**同一批**
 * 线上文档（都以 _seedSource: 'seedCommunityContent' 归集），若两边内容不一致，
 * 谁后执行谁覆盖——所以两边必须应用同一份叠加层，否则会出现"跑一次 seedCategories
 * 就把重写内容改回旧版"的静默回退。
 */
function applyRewrite(doc, rw, { topicTag = false } = {}) {
  if (!rw) return doc
  const next = { ...doc }
  if (rw.title) next.title = rw.title
  if (rw.brief) next.brief = rw.brief
  if (Array.isArray(rw.tags) && rw.tags.length) {
    const tags = rw.tags.slice()
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
    relatedProductIds: fields.relatedProductIds || []
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
    brief: '从翅面结构色到制框细节，一次看尽「蓝」的层次。',
    coverImage: MEDIA.insectCover,
    tags: ['昆虫', '专题', '闪蝶'],
    content: sectionsToHtml([
      {
        title: '策展语',
        body: '蓝色不是被涂上去的。本专题围绕闪蝶结构色、制框工艺与家居陈列，呈现「柜中一翼」的完整观看路径。',
        images: [MEDIA.insectCover, MEDIA.insectImages[1]]
      }
    ])
  }),
  exhibitionDoc('exhibition_museum_night', {
    title: '博物馆之夜：暖光下的标本柜',
    latinName: 'Curated Evening',
    brief: '闭店后的标本柜视角——安静、暖光、留白。',
    coverImage: MEDIA.bannerMuseum,
    tags: ['专题', '品牌', '博物学'],
    content: sectionsToHtml([
      {
        title: '策展语',
        body: '山海造物的空间，像一间可以走进去的奇珍柜。暖光压低对比，让黄铜、木纹与标本本体成为唯一主角。',
        images: [MEDIA.bannerMuseum, MEDIA.storeCover]
      }
    ])
  })
]


/**
 * 转载类种子：正文已是最终稿，**不过 rewrite 叠加层**；配图沿用现有云存储资源。
 * 来源/许可字段供文章详情页渲染「来源与许可」块。
 */
function repostDoc(raw) {
  const {
    _media, sections, sourceName, sourceTitle, sourceUrl, sourceAuthor,
    sourceLicense, sourceLicenseUrl, sourceNote, ...rest
  } = raw
  return articleDoc(raw._seedKey, {
    ...rest,
    coverImage: pick(_media, 0, 2)[0],
    images: pick(_media, 0, 2, 4),
    // 生成稿的小节用 paragraphs；sectionsToHtml 认 paras（或历史 body），此处归一化。
    // 若直接透传 paragraphs，正文会被静默丢弃、只剩小节标题。
    content: sectionsToHtml((sections || []).map((sec) => ({
      title: sec.title,
      paras: sec.paras || sec.paragraphs || (sec.body ? [sec.body] : []),
      tips: sec.tips
    }))),
    sourceName, sourceTitle, sourceUrl, sourceAuthor,
    sourceLicense, sourceLicenseUrl, sourceNote
  })
}

const ARTICLES = [
  ...[
    ...LEGACY_ARTICLES,
    ...EXTENDED_ARTICLES.map(({ _seedKey, ...rest }) => articleDoc(_seedKey, rest))
  ].map((doc) => applyRewrite(doc, REWRITE_ARTICLES[doc._seedKey])),
  // 转载类：已是终稿，直接入列
  ...REPOST_ARTICLES.map(repostDoc)
]

const EXHIBITIONS = [
  ...LEGACY_EXHIBITIONS,
  ...EXTENDED_EXHIBITIONS.map(({ _seedKey, ...rest }) => exhibitionDoc(_seedKey, rest))
].map((doc) => applyRewrite(doc, REWRITE_EXHIBITIONS[doc._seedKey], { topicTag: true }))

module.exports = {
  SEED_VERSION,
  ARTICLES,
  EXHIBITIONS
}
