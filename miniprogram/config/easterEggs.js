/**
 * 山海经彩蛋注册表
 *
 * 加新彩蛋：
 * 1. 在 EGGS 追加一条（id 稳定、勿复用）
 * 2. 配 triggers（secretKeyword 会在搜索提交时自动匹配；longPress / tapCount 需在目标页留钩子）
 * 3. 目标页放入 <easter-egg-note id="easterEggNote" />，longPress 用 data-egg-id + onEasterEggLongPress
 *
 * 不要把彩蛋挂到支付、下单、退款路径。
 */
const STORAGE_KEY = 'shanhai_easter_eggs_v1'

const LOCAL_ACHIEVEMENT = {
  id: 'shanhai_relics',
  name: '山海拾遗',
  enName: 'RELICS',
  desc: '在馆中偶遇五页山海笔记',
  threshold: 5
}

const EGGS = [
  {
    id: 'zhulong',
    title: '烛龙',
    latin: 'Zhulong',
    source: '《山海经·大荒北经》',
    excerpt: '人面蛇身而赤，直目正乘。其瞑乃晦，其视乃明。传说它衔烛照耀北方幽冥——馆里的暖光，大约也是这样来的。不必一次点亮所有柜子。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['pages/index/index'] },
      { type: 'secretKeyword', keywords: ['烛龙', '烛九阴'] }
    ]
  },
  {
    id: 'jingwei',
    title: '精卫',
    latin: 'Jingwei',
    source: '《山海经·北山经》',
    excerpt: '发鸠之山，有鸟焉，文首、白喙、赤足，名曰精卫。常衔西山之木石，以堙于东海。你搜到这个名字，像从档案柜抽出一张旧笺。填海不必一次完成，收藏也是。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'secretKeyword', keywords: ['精卫', '精卫填海', '炎帝少女', '发鸠'] }
    ]
  },
  {
    id: 'xiwangmu',
    title: '西王母',
    latin: 'Xi Wangmu',
    source: '《山海经·西山经》',
    excerpt: '玉山，是西王母所居也。其状如人，豹尾虎齿而善啸。柜门背后的铭牌，原是给藏家留的位置——名字与生日，都像铜牌上的一行小字。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['pages/user/index'] }
    ]
  },
  {
    id: 'qingniao',
    title: '青鸟',
    latin: 'Qingniao',
    source: '《山海经·西山经》',
    excerpt: '三青鸟，为西王母取食。翅上的鳞光最像柜中的虫。在昆虫馆多停留一会，像有青鸟从格架里探出头来，问你要不要跟它走一遭。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      {
        type: 'tapCount',
        count: 5,
        windowMs: 4500,
        pages: ['pages/category/index'],
        matchCategory: ['昆虫']
      }
    ]
  },
  {
    id: 'kuafu',
    title: '夸父',
    latin: 'Kuafu',
    source: '《山海经·海外北经》',
    excerpt: '夸父与日逐走，入日。渴欲得饮，饮于河渭。弃其杖，化为邓林。养护藏品，有点像照看那片树林——不是追上光，是让一片叶子停在玻璃里。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['subpackages/feature/care/index'] }
    ]
  },
  {
    id: 'dijiang',
    title: '帝江',
    latin: 'Dijiang',
    source: '《山海经·西山经》',
    excerpt: '天山有神焉，其状如黄囊，赤如丹火，六足四翼，浑敦无面目，是识歌舞，实惟帝江。社区里的笔记不必先有脸，先有声音就够。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['subpackages/feature/community/index'] }
    ]
  },
  {
    id: 'kunlun',
    title: '昆仑',
    latin: 'Kunlun',
    source: '《山海经·西山经》',
    excerpt: '昆仑之丘，是实惟帝之下都，百神之所在。店名写在门口，像把山川写进目录——你若愿意，可以当作一处下都。欢迎到店里坐坐。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['subpackages/business/about/index'] },
      { type: 'secretKeyword', keywords: ['昆仑', '昆仑丘', '帝之下都'] }
    ]
  },
  {
    id: 'lingyu',
    title: '陵鱼',
    latin: 'Lingyu',
    source: '《山海经·海内北经》',
    excerpt: '陵鱼人面，手足，鱼身，在海中。鉴定一张照片，有时像隔着水去认一张脸。认错也无妨，档案可以再写一笔。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'longPress', pages: ['subpackages/feature/identify/index'] }
    ]
  }
]

module.exports = {
  STORAGE_KEY,
  LOCAL_ACHIEVEMENT,
  EGGS
}
