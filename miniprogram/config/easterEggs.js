/**
 * 山海经彩蛋注册表
 *
 * 加新彩蛋：
 * 1. 在 EGGS 追加一条（id 稳定、勿复用）
 * 2. 配 triggers：
 *    - `secretKeyword` 搜索提交时自动匹配（无需页面配合）
 *    - `longPress` / `tapCount` 需在目标页留钩子（data-egg-id + onEasterEggLongPress）
 *    - `pageEnter` / `wishPosted` **自动触发**：页面调用
 *      `easterEgg.tryPageEnter({ page: this })` / `tryWishPosted({ page: this })`，
 *      由本表的 `pages` 决定命中。自动触发**只弹一次**（已拾得不再重复），
 *      用户主动触发则允许重看。
 * 3. 目标页放入 <easter-egg-note id="easterEggNote" />，并挂 `easterEggHost` behavior
 *
 * 不要把彩蛋挂到支付、下单、退款路径。
 *
 * 之所以让注册表（而不是页面）持有 `pages`：全站拓展时新页面只要在自己的
 * onLoad/onShow 里报一次事件即可，不必回到 easterEgg.js 改匹配逻辑。
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
  },
  {
    // 需求 28：「马上有」祈福墙 · 进页彩蛋
    // 选吉量而非"天马"：吉量是《山海经》里"乘之寿千岁"的文马，与"祈福"同义，
    // 且与藏品（黑马标本）同科，进这面墙的人第一眼就能把彩蛋和藏品连起来。
    id: 'jiliang',
    title: '吉量',
    latin: 'Jiliang',
    source: '《山海经·海内北经》',
    excerpt: '犬戎国有文马，缟身朱鬣，目若黄金，名曰吉量，乘之寿千岁。你把心愿挂上墙，像替它系一根缰绳——不必立刻应验，先让它有个去处。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'pageEnter', pages: ['subpackages/feature/wish-wall/index'] }
    ]
  },
  {
    // 需求 28：祈福成功后的第二个彩蛋，形成「进门—落愿」两段式仪式
    id: 'bo',
    title: '驳',
    latin: 'Bo',
    source: '《山海经·西山经》',
    excerpt: '中曲之山有兽焉，其状如马而白身黑尾，一角，虎牙爪，音如鼓音，其名曰驳，是食虎豹，可以御兵。第一句心愿写下去，是替自己挡开一点什么。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'wishPosted', pages: ['subpackages/feature/wish-wall/index'] }
    ]
  },
  {
    // 需求 28 升级：**连续三天**来点灯才遇得到 —— 门槛型彩蛋，奖励"坚持"而不是"来过"
    id: 'taotu',
    title: '騊駼',
    latin: 'Taotu',
    source: '《山海经·海外北经》',
    excerpt: '北海内有兽，其状如马，名曰騊駼。它不认路，只认常来的脚印——你连着三天替自己点灯，它就从北边慢慢走回来了。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'lampStreak', minStreak: 3, pages: ['subpackages/feature/wish-wall/index'] }
    ]
  },
  {
    // 需求 28 升级：写下第三条心愿时触发。鹿蜀「佩之宜子孙」是《山海经》里少见的吉语
    id: 'lushu',
    title: '鹿蜀',
    latin: 'Lushu',
    source: '《山海经·南山经》',
    excerpt: '杻阳之山有兽焉，其状如马而白首，其文如虎而赤尾，其音如谣，其名曰鹿蜀，佩之宜子孙。写到第三条，你大概已经知道自己真正想要什么了。',
    once: true,
    rewardNote: '收入博物笔记',
    triggers: [
      { type: 'wishCount', minCount: 3, pages: ['subpackages/feature/wish-wall/index'] }
    ]
  }
]

module.exports = {
  STORAGE_KEY,
  LOCAL_ACHIEVEMENT,
  EGGS
}
