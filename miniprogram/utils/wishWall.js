/**
 * 需求 28：「马上有」弹幕祈福墙 —— 客户端纯函数基座
 *
 * 单独成模块的原因：弹幕布局、文案校验、商品命中判定都是**可测的纯逻辑**，
 * 混在 Page 里就只能靠肉眼在真机上确认。三类逻辑各有历史坑：
 *   1. 轨道分配若随机，同一屏两条会重叠 → 必须确定性分配 + 轨道内错开；
 *   2. 时长若固定，长文案会跑得比短文案快 → 必须按字数换算，保持**视觉匀速**；
 *   3. 商品命中若只看标题子串，未来任一标题含「马上有」的藏品都会长出祈福墙
 *      → 优先看显式字段 `wishWallEnabled`，子串只作过渡兜底。
 */

/** 与云函数 manageWishWall 保持一致（客户端先校验一次，省一次无效请求） */
const TEXT_MIN = 2
const TEXT_MAX = 30

/** 弹幕轨道数：超过 4 条轨道在竖屏上会糊成一片 */
const LANES = 4

/** 祈福墙作用域 key（与云函数 DEFAULT_PRODUCT_KEY 一致） */
const PRODUCT_KEY = 'mashangyou'

/**
 * 一面墙最多回多少条（与云函数 `manageWishWall` 的 `LIST_MAX` **必须相等**）。
 *
 * 两处用途：① 请求 `limit`；② 列表到底时判断该说「共 N 条」还是「仅展示最近 N 条」。
 * 所以它必须与服务端同源 —— 守卫会直接读云函数源码比对，防漂移。
 */
const LIST_LIMIT = 30

/** 愿签墙列数：两列瀑布，把 30 条的无尽滚动砍掉一半 */
const TAG_COLUMNS = 2

/**
 * 每人每日可写条数（与云函数 `manageWishWall` 的 `DAILY_LIMIT` **必须相等**）。
 * 客户端只用它做「还能写几条」的预告，**不做拦截** —— 最终判定始终在服务端。
 * 守卫会直接读云函数源码比对，防漂移。
 */
const DAILY_LIMIT = 5

/**
 * 今日额度：服务端按 **Asia/Shanghai 自然日 + 本面墙** 统计该 openid 的条数，
 * 且**不分可见 / 已收起**（被馆方收起的也算当天用量）。客户端按同一口径预告。
 */
function dailyQuota(rows, nowMs, limit) {
  // ⚠️ 不能写 `Number(limit) || DAILY_LIMIT`：显式传 0（"今日不可写"）会被 falsy 吞掉变成 5
  const raw = limit == null ? DAILY_LIMIT : Number(limit)
  const cap = Math.max(0, Number.isFinite(raw) ? raw : DAILY_LIMIT)
  const dayKey = shanghaiDayKey(Number.isFinite(nowMs) ? nowMs : Date.now())
  const used = (Array.isArray(rows) ? rows : []).filter((r) => {
    const t = wishTimeMs(r && r.createTime)
    return t > 0 && shanghaiDayKey(t) === dayKey
  }).length
  const left = Math.max(0, cap - used)
  return { used, left, cap, exhausted: used >= cap }
}

/** 视觉速度：rpx/秒。时长 = (屏宽 + 文案宽) / 速度 */
const SPEED_RPX_PER_SEC = 90
const SCREEN_RPX = 750
/** 单字约 28rpx（26rpx 字号 + 字距），用于估算文案占宽 */
const CHAR_RPX = 28

/**
 * 同一轨道内两条弹幕之间的**视觉间隙**（毫秒）。
 *
 * ⚠️ 历史事故：这个常量曾经是「两条弹幕的进场间隔」的全部依据，取值 900ms ——
 * 而单条弹幕穿越要 6–26 秒，于是同一条轨道上后面 3 条在前一条还在屏内时就冲进来，
 * 4 条轨道各叠 4 条，整面墙糊成一坨（业务方原话：灾难现场）。
 * 正确口径：下一条必须等**上一条的尾部离开右边缘**才可进场（见 danmakuClearMs），
 * 这个常量只负责「尾部离开后再留一点空白」。
 */
const LANE_GAP_MS = 520

/**
 * 一轮弹幕里，最后一条结束后到重开一轮之间的停顿。
 * 弹幕墙不能一轮播完就死；由页面用定时器重开（纯逻辑只提供这个时刻）。
 */
const CYCLE_PAUSE_MS = 1400

/**
 * 归一化祈福文案（与云函数同口径）。
 * 弹幕是单行滚动：换行会撑破轨道，零宽字符能让内容在审核视图里「看起来不一样」。
 */
function normalizeWishText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 归一化作用域 key（与云函数 `normalizeProductKey` 同口径）。
 *
 * 这是「全站拓展」的支点：每面祈福墙由一个字符串作用域隔离，
 * 第二面墙 = 藏品记录上多一个 `wishWallKey`，**不需要改任何代码**。
 * 非 `[a-z0-9_-]` 一律剔除以防注入，超长截断到 40（与集合字段约定一致）。
 */
function normalizeProductKey(raw, fallback) {
  const key = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40)
  if (key) return key
  return fallback == null ? PRODUCT_KEY : fallback
}

/**
 * 该藏品所属的祈福墙作用域。
 *
 * 优先显式 `wishWallKey`；没有就落到「马上有」这面墙 ——
 * 与 `isWishWallProduct` 同一思路：显式字段优先，不给未来的墙留隐式耦合。
 */
function resolveWishWallKey(product) {
  const p = product || {}
  if (p.wishWallKey) return normalizeProductKey(p.wishWallKey)
  return PRODUCT_KEY
}

/**
 * 构建祈福墙跳转 URL（入口组件唯一出口）。
 * 带上 `productKey` 是「全站拓展」的关键：页面据此决定读哪面墙，而不是写死 mashangyou。
 */
function buildWishWallUrl(product, opts) {
  const o = opts || {}
  const p = product || {}
  const params = [
    `productId=${encodeURIComponent(p._id || '')}`,
    `productKey=${encodeURIComponent(resolveWishWallKey(p))}`,
    `title=${encodeURIComponent(p.title || p.name || '马上有')}`,
    `from=${encodeURIComponent(o.from || 'unknown')}`
  ]
  return `/subpackages/feature/wish-wall/index?${params.join('&')}`
}

/**
 * 上海自然日的日期键 `YYYY-MM-DD`（与云函数 `shanghaiDayKey` 同口径）。
 * 仪式彩蛋按天复现：同一天进来看到同一句，跨天才换。
 */
function shanghaiDayKey(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now()
  const sh = new Date(t + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${pad(sh.getUTCMonth() + 1)}-${pad(sh.getUTCDate())}`
}

/** FNV-1a：把日期键稳定地映射到 [0, length) */
function rotateIndex(dayKey, length) {
  const n = parseInt(length, 10) || 0
  if (n <= 0) return 0
  let hash = 2166136261
  const key = String(dayKey == null ? '' : dayKey)
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash % n
}

/**
 * 每日一句（点灯仪式）。
 * 不用随机数：同一盏灯在同一天必须亮出同一句话，否则「仪式」会变成抽奖。
 */
function pickDailyLine(lines, dayKey) {
  const all = (Array.isArray(lines) ? lines : [])
    .map((s) => String(s == null ? '' : s).trim())
    .filter(Boolean)
  if (!all.length) return ''
  return all[rotateIndex(dayKey, all.length)]
}

/** 前一日的日期键（`YYYY-MM-DD`）。按 UTC 减一天，避开本地时区与夏令时。 */
function previousDayKey(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey == null ? '' : dayKey))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * 连续点灯天数（含今日）。
 * 今日未点灯即返回 0 —— 「连续」不能靠昨天充数，否则断了也显示连续，仪式就失去反馈。
 *
 * @param {string[]|object} litDays 已点灯的日期键数组，或 { 'YYYY-MM-DD': ... } 映射
 * @param {string} todayKey
 * @returns {number}
 */
function lampStreak(litDays, todayKey) {
  const has = Array.isArray(litDays)
    ? (k) => litDays.indexOf(k) !== -1
    : (k) => !!(litDays && litDays[k])
  if (!has(todayKey)) return 0
  let count = 0
  let cursor = todayKey
  // 上限 400：防止存储被写入畸形键时死循环
  while (cursor && has(cursor) && count < 400) {
    count += 1
    cursor = previousDayKey(cursor)
  }
  return count
}

/* ============================ 仪式升级：灯位层级 ============================ */

/**
 * 灯位层级：连续点灯天数 → 点亮的盏数与称号。
 *
 * 为什么要有层级：只有"点亮/没点亮"两种状态时，连续多天来的人得到的反馈和第一天一模一样，
 * 仪式就没有累积感。层级把"坚持"变成看得见的东西（1 盏 → 3 盏 → 5 盏长明）。
 *
 * 阈值刻意低（1/3/7 天）：祈福墙不是养成游戏，第 7 天就该给到顶格反馈。
 */
const LAMP_TIERS = [
  { min: 7, tier: 3, lamps: 5, label: '长明' },
  { min: 3, tier: 2, lamps: 3, label: '守夜' },
  { min: 1, tier: 1, lamps: 1, label: '初见' }
]

/**
 * @param {number} streak 连续点灯天数（0 = 今日未点灯）
 * @returns {{tier:number, lamps:number, label:string, nextAt:number, daysToNext:number}}
 *   `nextAt` = 下一层级所需天数（0 = 已到顶格），`daysToNext` = 还差几天
 */
function lampTier(streak) {
  const n = Math.max(0, parseInt(streak, 10) || 0)
  const hit = LAMP_TIERS.find((t) => n >= t.min)
  if (!hit) return { tier: 0, lamps: 0, label: '未点', nextAt: 1, daysToNext: 1 }
  // 升序取下一条门槛（LAMP_TIERS 是降序，故取比当前 min 大的最小者）
  const higher = LAMP_TIERS.filter((t) => t.min > n).sort((a, b) => a.min - b.min)[0]
  return {
    tier: hit.tier,
    lamps: hit.lamps,
    label: hit.label,
    nextAt: higher ? higher.min : 0,
    daysToNext: higher ? higher.min - n : 0
  }
}

/* ============================ 仪式升级：二十四节气 ============================ */

/**
 * 二十四节气（常用日期表）。
 *
 * ⚠️ 这是**公历近似日**（每年可能差 ±1 天，精确值需天文历）。用途是"今天是不是节气"的
 * 仪式提示，不是历法计算 —— 所以固定表就够，且**确定性**（可在测试里断言）。
 * 逐条写出来而不是算：节气算法（太阳黄经）在这个量级上得不偿失。
 */
const SOLAR_TERMS = [
  { name: '小寒', month: 1, day: 5, season: 'winter' },
  { name: '大寒', month: 1, day: 20, season: 'winter' },
  { name: '立春', month: 2, day: 4, season: 'spring' },
  { name: '雨水', month: 2, day: 19, season: 'spring' },
  { name: '惊蛰', month: 3, day: 5, season: 'spring' },
  { name: '春分', month: 3, day: 20, season: 'spring' },
  { name: '清明', month: 4, day: 4, season: 'spring' },
  { name: '谷雨', month: 4, day: 20, season: 'spring' },
  { name: '立夏', month: 5, day: 5, season: 'summer' },
  { name: '小满', month: 5, day: 21, season: 'summer' },
  { name: '芒种', month: 6, day: 5, season: 'summer' },
  { name: '夏至', month: 6, day: 21, season: 'summer' },
  { name: '小暑', month: 7, day: 7, season: 'summer' },
  { name: '大暑', month: 7, day: 22, season: 'summer' },
  { name: '立秋', month: 8, day: 7, season: 'autumn' },
  { name: '处暑', month: 8, day: 23, season: 'autumn' },
  { name: '白露', month: 9, day: 7, season: 'autumn' },
  { name: '秋分', month: 9, day: 23, season: 'autumn' },
  { name: '寒露', month: 10, day: 8, season: 'autumn' },
  { name: '霜降', month: 10, day: 23, season: 'autumn' },
  { name: '立冬', month: 11, day: 7, season: 'winter' },
  { name: '小雪', month: 11, day: 22, season: 'winter' },
  { name: '大雪', month: 12, day: 7, season: 'winter' },
  { name: '冬至', month: 12, day: 22, season: 'winter' }
]

/** 节气名 → 索引（1..24，0 = 不是节气日） */
function solarTermIndex(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey == null ? '' : dayKey))
  if (!m) return 0
  const month = Number(m[2])
  const day = Number(m[3])
  const i = SOLAR_TERMS.findIndex((t) => t.month === month && t.day === day)
  return i < 0 ? 0 : i + 1
}

/**
 * 当天是不是节气日。
 * @returns {{name:string, index:number, season:string}|null}
 */
function solarTermOn(dayKey) {
  const index = solarTermIndex(dayKey)
  if (!index) return null
  const term = SOLAR_TERMS[index - 1]
  return { name: term.name, index, season: term.season }
}

/** 距离当天最近的一个节气（含当天；用于"下一个节气还有几天"这类文案） */
function solarTermGap(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey == null ? '' : dayKey))
  if (!m) return null
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  let best = null
  for (let i = 0; i < SOLAR_TERMS.length; i += 1) {
    const t = SOLAR_TERMS[i]
    for (const yearOffset of [0, 1]) {
      const at = Date.UTC(Number(m[1]) + yearOffset, t.month - 1, t.day)
      const diffDays = Math.round((at - base) / 86400000)
      if (diffDays < 0) continue
      if (!best || diffDays < best.inDays) best = { name: t.name, index: i + 1, season: t.season, inDays: diffDays, on: diffDays === 0 }
    }
  }
  return best
}

/* ============================ 祈福升级：我的心愿 ============================ */

/**
 * 用「我的心愿」（`mine` 接口）给公开列表打标。
 *
 * 为什么要这样做：公开列表**刻意不返回 openid**（最小暴露），所以 C 端无法自己判断
 * 「哪条是我写的」。`mine` 返回的是我自己的记录（含 `_id`），用 `_id` 集合去标记就够了 ——
 * 不必为了一句"我的"把 openid 暴露到公开列表里。
 *
 * @param {Array<object>} items 公开列表（已装饰）
 * @param {Array<object>|Set<string>} mine 我的记录数组，或我的 _id 集合
 * @returns {Array<object>} 带 `isMine` 的新数组（不改原对象）
 */
function markMine(items, mine) {
  const ids = mine instanceof Set
    ? mine
    : new Set((Array.isArray(mine) ? mine : []).map((r) => String((r && r._id) || '')).filter(Boolean))
  return (Array.isArray(items) ? items : []).map((it) => Object.assign({}, it, {
    isMine: !!it && ids.has(String(it._id || ''))
  }))
}

/**
 * 「我的心愿」视图的数据：把 `mine` 的记录装饰成与公开列表同构的形状。
 * 含被馆方收起的（`status === 'hidden'`），这样用户能看见"我的哪条没公开"。
 */
function decorateMineRows(mine, now) {
  const base = Number.isFinite(now) ? now : Date.now()
  return (Array.isArray(mine) ? mine : []).map((row) => ({
    _id: String((row && row._id) || ''),
    text: normalizeWishText(row && row.text),
    nickname: String((row && row.nickname) || '我'),
    avatar: String((row && row.avatar) || ''),
    pinned: !!(row && row.pinned === true),
    official: false,
    isMine: true,
    hidden: !!(row && row.status === 'hidden'),
    timeText: formatWishTime(row && row.createTime, base)
  }))
}

/** 我的心愿里「已上墙 / 被收起 / 共几条」的计数（文案要用，避免页面各算一遍） */
function mineSummary(mine) {
  const rows = Array.isArray(mine) ? mine : []
  const hidden = rows.filter((r) => r && r.status === 'hidden').length
  return {
    total: rows.length,
    visible: rows.length - hidden,
    hidden
  }
}

/**
 * 客户端预校验。
 * @returns {{ok:boolean, text?:string, msg?:string}}
 */
function validateWishText(raw) {
  const text = normalizeWishText(raw)
  if (!text) return { ok: false, msg: '写点想说的吧' }
  if (text.length < TEXT_MIN) return { ok: false, msg: `至少 ${TEXT_MIN} 个字` }
  if (text.length > TEXT_MAX) return { ok: false, msg: `最多 ${TEXT_MAX} 个字` }
  return { ok: true, text }
}

/**
 * 该藏品是否挂祈福墙。
 *
 * 优先显式字段（ERP 侧后续可加 `wishWallEnabled`），标题子串只作过渡兜底 ——
 * 否则任何标题带「马上有」的藏品都会长出祈福墙，且改名即失效。
 */
function isWishWallProduct(product) {
  const p = product || {}
  if (p.wishWallEnabled === true) return true
  if (p.wishWallEnabled === false) return false
  const title = String(p.title || p.name || '')
  return title.indexOf('马上有') !== -1
}

/**
 * 弹幕时长：按「屏宽 + 文案宽」与固定速度换算，长文案跑得久，观感才匀速。
 * @returns {number} ms
 */
function danmakuDurationMs(text) {
  const len = normalizeWishText(text).length
  const width = SCREEN_RPX + len * CHAR_RPX
  const ms = Math.round((width / SPEED_RPX_PER_SEC) * 1000)
  // 上下限兜底：过短一闪而过，过长霸屏
  return Math.max(6000, Math.min(26000, ms))
}

/** 文案估算宽度（rpx）：26rpx 字号 + 字距 ≈ 每字 28rpx */
function textWidthRpx(text) {
  return normalizeWishText(text).length * CHAR_RPX
}

/**
 * 上一条的**尾部离开右边缘**所需时间 —— 这才是同一轨道下一条可以进场的时刻。
 *
 * 几何：弹幕从「头部贴着右边缘」起步，走完全程 (屏宽 + 文案宽) 用 durationMs；
 * 尾部进屏只需要头部走完「文案宽」这一段，故时间为 duration × 文案宽 / (屏宽 + 文案宽)。
 */
function danmakuClearMs(text) {
  const w = textWidthRpx(text)
  const d = danmakuDurationMs(text)
  if (!w) return 0
  return Math.round(d * (w / (SCREEN_RPX + w)))
}

/**
 * 弹幕布局：确定性分配轨道 + **按轨道占用**排期。
 *
 * 两条硬约束（都有过事故）：
 *   1. 同一轨道内，下一条的进场时刻 ≥ 上一条的进场时刻 + clearMs + LANE_GAP_MS
 *      （旧实现只加了 900ms 固定间隔 → 同轨叠 4 条）；
 *   2. 同屏轨道均匀分布且不贴边（避免顶部被导航栏裁、底部被舞台边裁）。
 *
 * 不使用随机数：同一份数据两次渲染必须得到同一布局（否则每次 setData 都会跳位置），
 * 也才能在测试里断言。
 *
 * @param {Array<{_id?:string,text?:string}>} items
 * @param {{lanes?:number, gapMs?:number, cycle?:number}} [opts]
 *        cycle：重开轮次。会进 key，从而让 DOM 重建、动画重播（同 key 不会重播）。
 * @returns {Array<object>} 每项含 key/text/lane/topPercent/durationMs/delayMs/clearMs/endAt/isCycleEnd
 */
// 弹幕配色档位与 emoji（2026-09-19）：**必须确定性** —— 用 FNV-1a(rotateIndex) 按 id 取，
// 绝不能用随机数（否则每次 setData 跳色，且与守卫「确定性布局」铁律冲突 ✗）
const DANMAKU_TONES = 6
const DANMAKU_EMOJIS = ['', '🌿', '✨', '🐚', '🌸', '🕯️', '🌙', '🍀']

function buildDanmakuRows(items, opts) {
  const list = Array.isArray(items) ? items : []
  const o = opts || {}
  const lanes = Math.max(1, Math.min(LANES, o.lanes || LANES))
  const gapMs = o.gapMs == null ? LANE_GAP_MS : Math.max(0, Number(o.gapMs) || 0)
  const cycle = Math.max(0, Math.round(Number(o.cycle) || 0))
  const laneNextAt = new Array(lanes).fill(0)
  const rows = []
  list.forEach((item, i) => {
    const raw = item && typeof item === 'object' ? item : {}
    const text = normalizeWishText(raw.text)
    if (!text) return
    const lane = i % lanes
    const durationMs = danmakuDurationMs(text)
    const clearMs = danmakuClearMs(text)
    // 首屏错开：第 i 条至少等 i*260ms，避免整批同时冲进来（不替代轨道占用约束）
    const delayMs = Math.max(laneNextAt[lane], Math.round(i * 260))
    laneNextAt[lane] = delayMs + clearMs + gapMs
    const seedId = String(raw._id || `w${i}`)
    rows.push({
      key: `${String(raw._id || `w${i}`)}#${cycle}`,
      // 配色与 emoji：按 id 稳定取（emoji 用不同盐，避免与颜色绑定成固定搭配）
      tone: rotateIndex(seedId, DANMAKU_TONES),
      emoji: DANMAKU_EMOJIS[rotateIndex('e:' + seedId, DANMAKU_EMOJIS.length)] || '',
      // 墙面不只是装饰：带上身份与状态，弹幕才能标注记、点开愿签
      id: String(raw._id || ''),
      pinned: raw.pinned === true,
      official: !!raw.official,
      isMine: !!raw.isMine,
      hidden: !!raw.hidden,
      text,
      lane,
      // 轨道垂直分布：顶部 8% 起，末轨落在 84%（26rpx 字高约再占 6%，仍留安全区）
      topPercent: lanes > 1
        ? Math.round((8 + lane * (76 / (lanes - 1))) * 10) / 10
        : 46,
      durationMs,
      delayMs,
      clearMs,
      endAt: delayMs + durationMs
    })
  })
  // 一轮里最后结束的那条：页面据此重开一轮
  const endAt = rows.reduce((max, r) => Math.max(max, r.endAt), 0)
  rows.forEach((r) => { r.isCycleEnd = r.endAt === endAt && rows.length > 0 })
  return rows
}

/** 一轮弹幕播完的时刻（毫秒，相对本轮起点）。空轮返回 0。 */
function danmakuCycleEndMs(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((max, r) => Math.max(max, Number(r && r.endAt) || 0), 0)
}

/**
 * 愿签两列瀑布分列：按下标奇偶（**确定性** —— 两次渲染同一分布，也才能在测试里断言）。
 *
 * 为什么不用 flex-wrap 两列：文案长度 2–30 字差异大，按行对齐会留出成片空洞；
 * 瀑布列内纵向堆叠才贴得住。
 */
function splitTagColumns(items, columns) {
  const n = Math.max(1, Math.min(4, Number(columns) || TAG_COLUMNS))
  const out = Array.from({ length: n }, () => [])
  ;(Array.isArray(items) ? items : []).forEach((it, i) => { out[i % n].push(it) })
  return out
}

/** 是否已打到「一面墙最多回 LIST_LIMIT 条」的上限 —— 决定文案说「共 N 条」还是「仅展示最近 N 条」 */
function isTagListCapped(count, limit) {
  const n = Number(count) || 0
  return n >= (Number(limit) || LIST_LIMIT)
}

/**
 * 时间解析：兼容云函数回包里出现过的全部形态。
 *
 * ⚠️ 历史缺陷：这里原本直接 `new Date(value)`，而云函数回包的日期可能是 `{ $date: … }`
 * （本仓已有 4 处按此兼容：couponHelper / storeLedger / member-crm / live studio）。
 * 该形态下 `new Date(obj)` = Invalid Date → **愿签的时间静默变成空串**，
 * 且「今日额度」会数成 0（明明写满了还提示"还可写 5 条"）——
 * 后者是本轮新增能力，故必须先把这个口径修对。
 */
function wishTimeMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof value === 'object') {
    if (value.$date != null) return wishTimeMs(value.$date)
    if (typeof value.getTime === 'function') {
      const t = value.getTime()
      return Number.isNaN(t) ? 0 : t
    }
    return 0
  }
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 相对时间：弹幕墙只关心「刚刚 / n 分钟前 / n 小时前 / 日期」 */
function formatWishTime(value, now) {
  if (!value) return ''
  const t = wishTimeMs(value)
  if (!t) return ''
  const base = Number.isFinite(now) ? now : Date.now()
  const diff = Math.max(0, base - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} 天前`
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

module.exports = {
  TEXT_MIN,
  TEXT_MAX,
  LANES,
  CYCLE_PAUSE_MS,
  LIST_LIMIT,
  DAILY_LIMIT,
  TAG_COLUMNS,
  PRODUCT_KEY,
  normalizeWishText,
  normalizeProductKey,
  resolveWishWallKey,
  buildWishWallUrl,
  shanghaiDayKey,
  rotateIndex,
  pickDailyLine,
  previousDayKey,
  lampStreak,
  LAMP_TIERS,
  lampTier,
  SOLAR_TERMS,
  solarTermIndex,
  solarTermOn,
  solarTermGap,
  markMine,
  decorateMineRows,
  mineSummary,
  validateWishText,
  isWishWallProduct,
  danmakuDurationMs,
  textWidthRpx,
  danmakuClearMs,
  buildDanmakuRows,
  danmakuCycleEndMs,
  splitTagColumns,
  isTagListCapped,
  formatWishTime,
  wishTimeMs,
  dailyQuota
}
