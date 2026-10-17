/**
 * 祈福墙玩法注册表（需求 28 · 玩法第一批）
 *
 * 为什么要有注册表：玩法从 2 个（点灯 / 木鱼）长到 6 个只是时间问题，若像现在这样
 * 每个玩法都在 WXML 里手写一张卡、在 JS 里手写一段分支，加第 7 个时必然漏接线。
 * 这里只声明**事实**（名字、入口形态、进行态文案、需要哪个资料字段、内容池、回声文案、
 * 独立页路径），页面按注册表渲染、按注册表取内容、按注册表跳转。
 *
 * 2026-09-21 口径变更（PRD v1.4 §11.1 R1 / §11.4）：玩法**各开一页**。
 *   · 主页面退化为**入口区**：只渲染入口形态 + "今天玩过没有"，不再承载进行态/结果/推荐/分享；
 *   · 每个玩法页自带完整闭环：专属进行态 → 专属结果 → 留档 → 下一步。
 * 新增字段就是为这条口径服务的：
 *   - `page`      该玩法的兼容独立页路径（2026-09-27 起入口改开墙内弹层 PlaySheet，不再跳它）
 *   - `kind`      结果纸面语言（qian/cookie/zodiac/mbti/solar/coin —— 各玩法结果长得不一样）
 *   - `form`      入口形态（card/shell/ring/axis/leaf/coin —— 各玩法入口长得不一样）
 *   - `spinMs`    进行态时长（毫秒；各玩法的"发生感"节奏不同）
 *   - `spinText`  进行态那一句（摇签中 / 掰开中 / 转星盘 / 对齐中 / 时令在落 / 铜钱在转）
 *   - `entryNote` 今天还没玩时的状态句 / `doneNote` 今天玩过之后的再入口句
 *
 * 字段口径：
 *   - `id`       唯一键，埋点与内容 seed 都用它（改 id = 改历史数据口径，不要改）
 *   - `mark`     字标（单字，铜色圆底）—— 不用图标素材，本页本来就没有图标资产
 *   - `name`     玩法标题
 *   - `hint`     副文案（一句话说清"点了会得到什么"）
 *   - `cta`      玩法页上那枚开始按钮的文案
 *   - `pool`     内容池 id（见 config/ritualPlayContent.js）
 *   - `needs`    需要用户的哪个资料字段（读不到 → 引导去补，而不是给个假结果）
 *   - `echo`     抽到之后在**弹幕墙上**回的那一句：必须第一人称 + ≤14 字（守卫断言）
 *   - `daily`    是否"一天一次结果"（确定性：同一天同一人同一玩法结果相同）
 *   - `variant`  是否允许同一天"换一个"（星座 12 / MBTI 16，见 §11.2-4）
 */
const RITUAL_PLAYS = [
  {
    id: 'qian',
    mark: '签',
    name: '今日一签',
    // 2026-09-22：11 字在 2×2 入口卡里会折行并掉一个孤字「么」（把第一张卡撑高、网格不齐）。
    // 收到 9 字，并改用结果页本来就在用的「宜忌」措辞（同一套语言，读起来也更准）。
    hint: '摇一支，看今日宜忌',
    cta: '摇一支',
    pool: 'QIAN',
    needs: [],
    echo: '我摇了今日一签',
    daily: true,
    kind: 'qian',
    form: 'card',
    page: '/subpackages/plays/play-qian/index',
    spinMs: 1000,
    spinText: '签筒在摇…',
    entryNote: '今天还没摇',
    // 2026-09-27：入口 2×3 格状态句上限 8 字（含中点号）—— 长尾「再进去看这×」会折行，
    // 六格行高参差。中点号后只留短再入口（再看 / 可换），与 entryNote 同档单行。
    doneNote: '今天已摇 · 再看'
  },
  {
    id: 'cookie',
    mark: '饼',
    name: '拆签饼',
    hint: '拆开今天的签饼',
    cta: '拆开',
    pool: 'COOKIE',
    needs: [],
    echo: '我拆开了今天的签饼',
    daily: true,
    kind: 'cookie',
    form: 'shell',
    page: '/subpackages/plays/play-cookie/index',
    spinMs: 800,
    spinText: '在拆了…',
    entryNote: '今天还没拆',
    doneNote: '今天已拆 · 再看'
  },
  {
    id: 'zodiac',
    mark: '座',
    name: '星座签',
    hint: '按你的星座给一句',
    cta: '转星盘',
    pool: 'ZODIAC',
    needs: ['zodiac'],
    echo: '我领了今天的星座签',
    daily: true,
    kind: 'zodiac',
    form: 'ring',
    page: '/subpackages/plays/play-zodiac/index',
    spinMs: 1100,
    spinText: '在转星盘…',
    entryNote: '今天还没转',
    doneNote: '今天已转 · 可换'
  },
  {
    id: 'mbti',
    mark: '我',
    name: 'MBTI 贴士',
    hint: '顺着你的性子来一句',
    cta: '读一句',
    pool: 'MBTI',
    needs: ['mbti'],
    echo: '我读了今天的 MBTI 贴士',
    daily: true,
    kind: 'mbti',
    form: 'axis',
    page: '/subpackages/plays/play-mbti/index',
    spinMs: 900,
    spinText: '在对齐…',
    entryNote: '今天还没读',
    doneNote: '今天已读 · 可换'
  },
  {
    id: 'solar',
    mark: '节',
    name: '节气签',
    hint: '按时令领一句提醒',
    cta: '领时令',
    pool: 'SOLAR',
    needs: [],
    echo: '我领了今天的节气签',
    daily: true,
    kind: 'solar',
    form: 'leaf',
    page: '/subpackages/plays/play-solar/index',
    spinMs: 1000,
    spinText: '时令在落…',
    entryNote: '今天还没领',
    doneNote: '今天已领 · 再看'
  },
  {
    id: 'coin',
    mark: '钱',
    name: '铜钱签',
    hint: '摇一枚，领今日一句',
    cta: '摇一枚',
    pool: 'COIN',
    needs: [],
    echo: '我摇了今天的铜钱签',
    daily: true,
    kind: 'coin',
    form: 'coin',
    page: '/subpackages/plays/play-coin/index',
    spinMs: 960,
    spinText: '铜钱在转…',
    entryNote: '今天还没摇',
    doneNote: '今天已摇 · 再看'
  }
]

/** `variant:true` 的玩法允许同一天换一个维度看（星座 12 / MBTI 16，见 PRD §11.2-4） */
const VARIANT_PLAYS = { zodiac: 'zodiac', mbti: 'mbti' }

/** 需要资料字段的玩法：字段 → 资料页的落点与标签（引导文案用，不写死中文在页面里） */
const NEED_PROFILE_FIELDS = {
  zodiac: { label: '星座', anchor: 'field-zodiac', gain: '完善奖励 +7' },
  mbti: { label: 'MBTI', anchor: 'field-mbti', gain: '完善奖励 +8' }
}

/** 资料页路径（引导补资料时跳这里；锚点见 profile 页自己的 checklist 常量） */
const PROFILE_PAGE = '/subpackages/extra/user/profile/index'

/** 祈福墙页路径（玩法页「写成心愿」把文案带回这里；降级用 reLaunch 也走它） */
// 「写成心愿」的回落页 = 心愿签（2026-10-17 旧祈福墙退场；旧路径只剩转跳薄壳，不再作为目的地）
const WISH_WALL_PAGE = '/subpackages/feature/wish-labels/index'

function findPlay(id) {
  const key = String(id || '')
  return RITUAL_PLAYS.find((p) => p.id === key) || null
}

function playIds() {
  return RITUAL_PLAYS.map((p) => p.id)
}

/** 玩法页路径（按注册表取，页面不写死；没有登记 page 的玩法返回空串） */
function playPage(id) {
  const play = findPlay(id)
  return (play && play.page) || ''
}

module.exports = {
  RITUAL_PLAYS,
  VARIANT_PLAYS,
  NEED_PROFILE_FIELDS,
  PROFILE_PAGE,
  WISH_WALL_PAGE,
  findPlay,
  playIds,
  playPage
}
