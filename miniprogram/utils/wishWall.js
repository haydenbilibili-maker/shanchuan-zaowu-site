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
    rows.push({
      key: `${String(raw._id || `w${i}`)}#${cycle}`,
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

/** 相对时间：弹幕墙只关心「刚刚 / n 分钟前 / n 小时前 / 日期」 */
function formatWishTime(value, now) {
  if (!value) return ''
  const t = new Date(value).getTime()
  if (!t || Number.isNaN(t)) return ''
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
  validateWishText,
  isWishWallProduct,
  danmakuDurationMs,
  textWidthRpx,
  danmakuClearMs,
  buildDanmakuRows,
  danmakuCycleEndMs,
  splitTagColumns,
  isTagListCapped,
  formatWishTime
}
