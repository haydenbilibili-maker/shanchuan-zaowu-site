/**
 * 祈福墙玩法注册表（需求 28 · 玩法第一批）
 *
 * 为什么要有注册表：玩法从 2 个（点灯 / 木鱼）长到 6 个只是时间问题，若像现在这样
 * 每个玩法都在 WXML 里手写一张卡、在 JS 里手写一段分支，加第 7 个时必然漏接线。
 * 这里只声明**事实**（名字、入口文案、需要哪个资料字段、内容池、回声文案），
 * 页面按注册表渲染、按注册表取内容 —— 新玩法**只改本文件 + 内容池**（页面不动）。
 *
 * 与 `config/easterEggs.js` 同一套思路：注册表声明，页面只报事实。
 *
 * 字段口径：
 *   - `id`       唯一键，埋点与内容 seed 都用它（改 id = 改历史数据口径，不要改）
 *   - `mark`     瓦片上的字标（单字，铜色圆底）—— 不用图标素材，本页本来就没有图标资产
 *   - `name`     瓦片标题
 *   - `hint`     瓦片副文案（一句话说清"点了会得到什么"）
 *   - `cta`      结果卡上的按钮文案
 *   - `pool`     内容池 id（见 config/ritualPlayContent.js）
 *   - `needs`    需要用户的哪个资料字段（读不到 → 引导去补，而不是给个假结果）
 *   - `echo`     抽到之后在**弹幕墙上**回的那一句：必须第一人称 + ≤14 字（守卫断言）
 *   - `daily`    是否"一天一次结果"（确定性：同一天同一人同一玩法结果相同）
 */
const RITUAL_PLAYS = [
  {
    id: 'qian',
    mark: '签',
    name: '今日一签',
    hint: '摇一支，看今天宜做什么',
    cta: '摇一签',
    pool: 'QIAN',
    needs: [],
    echo: '我摇了今日一签',
    daily: true
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
    daily: true
  },
  {
    id: 'zodiac',
    mark: '座',
    name: '星座签',
    hint: '按你的星座给一句',
    cta: '看一看',
    pool: 'ZODIAC',
    needs: ['zodiac'],
    echo: '我领了今天的星座签',
    daily: true
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
    daily: true
  }
]

/** 需要资料字段的玩法：字段 → 资料页的落点与标签（引导文案用，不写死中文在页面里） */
const NEED_PROFILE_FIELDS = {
  zodiac: { label: '星座', anchor: 'field-zodiac', gain: '完善奖励 +7' },
  mbti: { label: 'MBTI', anchor: 'field-mbti', gain: '完善奖励 +8' }
}

/** 资料页路径（引导补资料时跳这里；锚点见 profile 页自己的 checklist 常量） */
const PROFILE_PAGE = '/subpackages/extra/user/profile/index'

function findPlay(id) {
  const key = String(id || '')
  return RITUAL_PLAYS.find((p) => p.id === key) || null
}

function playIds() {
  return RITUAL_PLAYS.map((p) => p.id)
}

module.exports = {
  RITUAL_PLAYS,
  NEED_PROFILE_FIELDS,
  PROFILE_PAGE,
  findPlay,
  playIds
}
