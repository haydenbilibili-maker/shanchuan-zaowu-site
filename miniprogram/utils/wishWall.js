// 「注记 X」长注释原文见 miniprogram/docs/源码注记_A流主包.md
const { resolveBlessTags } = require('../config/blessTags')
// 字数口径的**唯一实现**（按「字」= grapheme，emoji/ZWJ 序列算 1）。
// 与服务端 `manageWishWall` 内嵌的那份**逐字节相同**；端上任何"算几个字"的地方都必须走它。
const { wishTextCount } = require('./wishTextCount')
/** 需求 28：「马上有」弹幕祈福墙 —— 客户端纯函数基座（注记 W1） */

/** 与云函数 manageWishWall 保持一致（客户端先校验一次，省一次无效请求） */
const TEXT_MIN = 2
const TEXT_MAX = 30

/**
 * 弹幕轨道数。
 * ⚠️ 改这个数必须同时改 `.ww-wall-rail.rail-N` 的条数与百分比（守卫按 LANES 对账）。
 * （注记 W2）
 */
const LANES = 6

/** 祈福墙作用域 key（与云函数 DEFAULT_PRODUCT_KEY 一致） */
const PRODUCT_KEY = 'mashangyou'
/** 2026-10-13「马上有 · 心愿签」重做：true = 入口与旧页都去新页（回退 = 置 false 重传）。蓝图 docs/马上有心愿签_重设计蓝图_2026-10-13.md */
const WISH_LABELS_V2 = true
const WISH_LABELS_PATH = '/subpackages/feature/wish-labels/index'
const WISH_WALL_PATH = '/subpackages/feature/wish-wall/index'
/** 黑马展品实拍（商品 7794572a… images[1]，店内展柜实拍；fileID 直接给 image 用，主包零字节） */
const WISH_EXHIBIT_COVER = 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/products/1788775191533_DSC03810.JPG'

/** 一面墙最多回多少条（与云函数 `manageWishWall` 的 `LIST_MAX` **必须相等**）。（注记 W3） */
const LIST_LIMIT = 30

/** 愿签墙列数：两列瀑布，把 30 条的无尽滚动砍掉一半 */
const TAG_COLUMNS = 2

/** 每人每日可写条数（与云函数 `manageWishWall` 的 `DAILY_LIMIT` **必须相等**）。（注记 W4） */
const DAILY_LIMIT = 5

/** 今日额度：服务端按 **Asia/Shanghai 自然日 + 本面墙** 统计该 openid 的条数，（注记 W5） */
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

/** 视觉速度：rpx/秒。时长 = (屏宽 + 文案宽) / 速度（注记 W6） */
const SPEED_RPX_PER_SEC = 96
const SCREEN_RPX = 750
/**
 * 单字占宽 ≈ 33rpx。
 * ⚠️ 这个数必须跟着 `.ww-danmaku` 的 font-size 走（字号 + 0.02em 字距 ≈ 字号 ×1.03）：
 * （注记 W7）
 */
const CHAR_RPX = 33
/** 挂签条左右垫 + 钉头的固定占宽（rpx）。（注记 W8） */
const SLIP_PAD_RPX = 28

/**
 * 同一轨道内两条弹幕之间的**视觉间隙**（毫秒）。
 * ⚠️ 历史事故：这个常量曾经是「两条弹幕的进场间隔」的全部依据，取值 900ms ——
 * （注记 W9）
 */
const LANE_GAP_MS = 300

/**
 * 非预填条目的「进场错峰台阶」（毫秒）。
 * 旧值 260 在密墙时偏疏；B 站式压到 120，让后段更快灌满空轨。
 */
const LANE_STAGGER_MS = 120

/** 一轮弹幕里，最后一条结束后到重开一轮之间的停顿。（注记 W10） */
const CYCLE_PAUSE_MS = 1100

/** 归一化祈福文案（与云函数同口径）。（注记 W11） */
function normalizeWishText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 归一化作用域 key（与云函数 `normalizeProductKey` 同口径）。（注记 W12） */
function normalizeProductKey(raw, fallback) {
  const key = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40)
  if (key) return key
  return fallback == null ? PRODUCT_KEY : fallback
}

/** 该藏品所属的祈福墙作用域。（注记 W13） */
function resolveWishWallKey(product) {
  const p = product || {}
  if (p.wishWallKey) return normalizeProductKey(p.wishWallKey)
  return PRODUCT_KEY
}

/** 构建祈福墙跳转 URL（入口组件唯一出口）。（注记 W14） */
function buildWishWallUrl(product, opts) {
  const o = opts || {}
  const p = product || {}
  const params = [
    `productId=${encodeURIComponent(p._id || '')}`,
    `productKey=${encodeURIComponent(resolveWishWallKey(p))}`,
    `title=${encodeURIComponent(p.title || p.name || '马上有')}`,
    `from=${encodeURIComponent(o.from || 'unknown')}`
  ]
  // 祈运标签随入口带过去（详情页手上就有商品对象，**不必为这一件事多发一个请求**）：
  // 祈福墙据此把玩法瓦片按"这面墙求什么"重排、并显示一句祈运提示。
  // ⚠️ 用 `resolveBlessTags` 而不是直接读 `p.blessTags`：存量商品大多只填了礼赠场景，
  // 显式标签为空时由场景兜底推导（映射写死在 config/blessTags.js，永不写库）。
  const bless = resolveBlessTags(p).join(',')
  if (bless) params.push(`bless=${encodeURIComponent(bless)}`)
  return `${WISH_LABELS_V2 ? WISH_LABELS_PATH : WISH_WALL_PATH}?${params.join('&')}`
}

/** 解析**门店 / 物料小程序码**带进来的 `scene`（wxacode.getUnlimited，≤32 字符）。（注记 W15） */
function parseWishWallScene(scene) {
  const out = { from: '', productKey: '' }
  const raw = String(scene == null ? '' : scene)
  if (!raw) return out
  let text = raw
  try {
    text = decodeURIComponent(raw)
  } catch (e) {
    text = raw
  }
  const grab = (key) => {
    const m = new RegExp(`(?:^|[&?])${key}=([^&]*)`).exec(text)
    return m && m[1] ? m[1] : ''
  }
  // 严进：scene 来自**我们自己印出去的码**，出现异常字符只可能是码坏了/被改过。
  // 这种情况宁可回落到默认墙（返回空），也不要拿一串垃圾去查一面不存在的墙 ——
  // 码是印刷品，静默指向"另一面墙"是最难发现的一类故障（守卫用超长/脏值用例钉住）。
  const from = grab('from')
  if (/^[a-zA-Z0-9_]{1,24}$/.test(from)) out.from = from
  const rawKey = grab('k') || grab('productKey')
  if (/^[a-zA-Z0-9_-]{1,40}$/.test(rawKey)) out.productKey = normalizeProductKey(rawKey)
  return out
}

/** 上海自然日的日期键 `YYYY-MM-DD`（与云函数 `shanghaiDayKey` 同口径）。（注记 W16） */
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

/** 连续点灯天数（含今日）。（注记 W17） */
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

/** 灯位层级：连续点灯天数 → 点亮的盏数与称号。（注记 W18） */
const LAMP_TIERS = [
  { min: 7, tier: 3, lamps: 5, label: '长明' },
  { min: 3, tier: 2, lamps: 3, label: '守夜' },
  { min: 1, tier: 1, lamps: 1, label: '初见' }
]

/** @param {number} streak 连续点灯天数（0 = 今日未点灯）（注记 W19） */
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
 * ⚠️ 这是**公历近似日**（每年可能差 ±1 天，精确值需天文历）。用途是"今天是不是节气"的
 * （注记 W20）
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

/** 用「我的心愿」（`mine` 接口）给公开列表打标。（注记 W21） */
function markMine(items, mine) {
  const ids = mine instanceof Set
    ? mine
    : new Set((Array.isArray(mine) ? mine : []).map((r) => String((r && r._id) || '')).filter(Boolean))
  return (Array.isArray(items) ? items : []).map((it) => Object.assign({}, it, {
    isMine: !!it && ids.has(String(it._id || ''))
  }))
}

/** 「我的心愿」视图的数据：把 `mine` 的记录装饰成与公开列表同构的形状。（注记 W22） */
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
  // ⚠️ 必须按「字」算（`wishTextCount`），**不能**用 `text.length`（UTF-16 码元）：
  //    后者把 emoji 算成 2、把 ZWJ 序列算成 8 → 端上会把服务端本来接受的文案**误拒**。
  //    2026-09-21 夜班修：当时只把**服务端**（`manageWishWall` 的 `validateWishText`，
  //    用的是同一份口径的内嵌副本）改成了按「字」，端上这一处**漏了** —— 因为它在 `utils/` 里、
  //    不在那个子代理的文件白名单内。修后端上预校验与**服务端逐字一致**（同为归一化后按字计）。
  const count = wishTextCount(text)
  if (count < TEXT_MIN) return { ok: false, msg: `至少 ${TEXT_MIN} 个字` }
  if (count > TEXT_MAX) return { ok: false, msg: `最多 ${TEXT_MAX} 个字` }
  return { ok: true, text }
}

/** 该藏品是否挂祈福墙。（注记 W23） */
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
  const w = textWidthRpx(text)
  const width = SCREEN_RPX + w
  const ms = Math.round((width / SPEED_RPX_PER_SEC) * 1000)
  // 上下限兜底：过短一闪而过，过长霸屏
  return Math.max(6000, Math.min(26000, ms))
}

/** 文案估算宽度（rpx）：字宽 × 字数 + 挂签条固定垫宽 */
function textWidthRpx(text) {
  return normalizeWishText(text).length * CHAR_RPX + SLIP_PAD_RPX
}

/** 上一条的**尾部离开右边缘**所需时间 —— 这才是同一轨道下一条可以进场的时刻。（注记 W24） */
function danmakuClearMs(text) {
  const w = textWidthRpx(text)
  const d = danmakuDurationMs(text)
  if (!w) return 0
  return Math.round(d * (w / (SCREEN_RPX + w)))
}

/** 弹幕布局：确定性分配轨道 + **按轨道占用**排期。（注记 W25） */
// 弹幕配色档位与 emoji（2026-09-19）：**必须确定性** —— 用 FNV-1a(rotateIndex) 按 id 取，
// 绝不能用随机数（否则每次 setData 跳色，且与守卫「确定性布局」铁律冲突 ✗）
const DANMAKU_TONES = 6
const DANMAKU_EMOJIS = ['', '🌿', '✨', '🐚', '🌸', '🕯️', '🌙', '🍀']

/** 一条心愿该配哪个 emoji（**唯一规则**）。（注记 W26） */
function danmakuEmoji(seedId) {
  const id = String(seedId == null ? '' : seedId)
  return DANMAKU_EMOJIS[rotateIndex('e:' + id, DANMAKU_EMOJIS.length)] || ''
}

/** 在仍空的轨道里取「最早可进场」的那一条（B 站式错峰；确定性，不用随机） */
function pickEarliestLane(laneNextAt, lanes) {
  let best = 0
  for (let L = 1; L < lanes; L += 1) {
    if (laneNextAt[L] < laneNextAt[best]) best = L
  }
  return best
}

function buildDanmakuRows(items, opts) {
  const list = Array.isArray(items) ? items : []
  const o = opts || {}
  const lanes = Math.max(1, Math.min(LANES, o.lanes || LANES))
  const gapMs = o.gapMs == null ? LANE_GAP_MS : Math.max(0, Number(o.gapMs) || 0)
  const cycle = Math.max(0, Math.round(Number(o.cycle) || 0))
  const boostId = String(o.boostId || '')
  const laneNextAt = new Array(lanes).fill(0)
  const rows = []
  list.forEach((item, i) => {
    const raw = item && typeof item === 'object' ? item : {}
    const text = normalizeWishText(raw.text)
    if (!text) return
    const seedId = String(raw._id || `w${i}`)
    const isBoost = !!(boostId && seedId === boostId)
    // ── 首屏预填（2026-09-19）────────────────────────────────────────────
    // 真机问题：弹幕是 `left:100%` + 全屏横穿 + **正 delay**，所以 t=0 时墙面**必然是空的**。
    // 修法：前 `lanes` 条各占一轨、负 delay 预填。
    // 预填之后改「最早空轨」分配（B 站式错峰灌轨），仍确定性、同轨不重叠公式不变。
    const prefill = i < lanes
    const lane = prefill ? (i % lanes) : pickEarliestLane(laneNextAt, lanes)
    const durationMs = danmakuDurationMs(text)
    const clearMs = danmakuClearMs(text)
    // 2026-09-24：0.85→0.15 改成 0.62→0.22。
    // 2026-09-26：刚落愿 boost 用 0.28 —— 落在屏中偏右，像「高级弹幕」刚发出。
    let delayMs
    if (isBoost) {
      delayMs = -Math.round(durationMs * 0.28)
    } else if (prefill) {
      delayMs = -Math.round(durationMs * (0.62 - 0.08 * i))
    } else {
      delayMs = Math.max(laneNextAt[lane], Math.round(i * LANE_STAGGER_MS))
    }
    // 非预填必须尊重同轨占用；预填（含刚落愿 boost）用负 delay，不与 laneNextAt 取 max
    if (!prefill) {
      delayMs = Math.max(delayMs, laneNextAt[lane])
    }
    laneNextAt[lane] = delayMs + clearMs + gapMs
    rows.push({
      key: `${String(raw._id || `w${i}`)}#${cycle}`,
      // 配色与 emoji：按 id 稳定取（emoji 用不同盐，避免与颜色绑定成固定搭配）
      tone: rotateIndex(seedId, DANMAKU_TONES),
      emoji: danmakuEmoji(seedId),
      // 墙面不只是装饰：带上身份与状态，弹幕才能标注记、点开愿签
      id: String(raw._id || ''),
      pinned: raw.pinned === true,
      // ⚠️ 保留字段、**不再渲染**：2026-09-18 产品决定去掉「馆方」徽章（基线内容全是馆方发的，
      // 盖章不传递信息）。字段留着是为了以后能区分"真人馆方回复"与"AI 基线"而不必做数据迁移。
      official: !!raw.official,
      isMine: !!raw.isMine,
      hidden: !!raw.hidden,
      boost: isBoost,
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

/** 愿签两列瀑布分列：按下标奇偶（**确定性** —— 两次渲染同一分布，也才能在测试里断言）。（注记 W27） */
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
 * ⚠️ 历史缺陷：这里原本直接 `new Date(value)`，而云函数回包的日期可能是 `{ $date: … }`
 * （注记 W28）
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
  WISH_LABELS_V2,
  WISH_LABELS_PATH,
  WISH_EXHIBIT_COVER,
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
  danmakuEmoji,
  parseWishWallScene,
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
