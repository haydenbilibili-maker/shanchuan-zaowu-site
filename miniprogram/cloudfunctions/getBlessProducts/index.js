/**
 * 祈运选品（需求 28 · item 6 的 C 端只读链路）
 *
 * 用途：玩法抽到一句之后，给一条**弱推**——"同好也在看的藏品"，让「抽 → 写 → 上墙」这条路上
 * 多一个回到商品的落点。
 *
 * 入参：
 *   tag        string   祈运标签 key（必填，受控枚举见 blessTags.js）
 *   excludeIds string[] 不重复推荐（客户端会把**当前这面墙的商品**传进来）
 *   limit      number   条数，默认 3，最大 6
 *   category   string   可选：同品类命中排在前面
 *
 * 匹配规则（刻意简单、可解释、可测）：
 *   1. 只取 `blessTags` 命中该 tag 且**未下架**的商品（存量无标签的用 `giftScenes` 场景兜底）；
 *   2. 排序：**显式命中优先** → 同品类 → 销量 → 较新上架 → 价格适中优先 → _id；
 *      再从前若干件里**按天轮换**（同一天固定、跨天会换，见 exports.main 的 2026-09-20 修正）；
 *   3. **不做兜底**：没有命中的商品就返回空列表。
 *      为什么不做"热门兜底"：那会把"求安"推成任意一件热卖，推荐与标签脱钩 = 乱推，
 *      比不推更糟（见 docs/需求28_…交付记录 §26.6）。
 *
 * 入参补充：`dayKey`（上海自然日 `YYYY-MM-DD`）—— 客户端会把它的缓存键日期传进来，
 * 保证「一天一件」两端同源；缺省时云函数自己按 UTC+8 算一份。
 */
const cloud = require('wx-server-sdk')
const { sanitizeBlessTags, getBlessTag, scenesForBless } = require('./blessTags')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 6
/** 候选池上限：取这么多条再在代码里精细排序 —— 要能装下**本标签的全部命中**，否则排序又变成在截断的小池里做（见 queryByTag 的 2026-09-20 修正） */
const POOL_MAX = 100
/** 按天轮换的池子大小：从排序后的前 N 件里挑今天这一件（见 exports.main 的 2026-09-20 修正） */
const ROTATE_POOL = 5

/**
 * 上海自然日键（UTC+8，`YYYY-MM-DD`）—— 与客户端 `utils/wishWall.shanghaiDayKey` 同口径。
 * 客户端会把 dayKey 传进来（它的缓存键本来就用这个），云函数在缺省时自己算一份，
 * 保证「一天一件」这件事**两端用的是同一个日期**。
 */
function shanghaiDayKey(ms) {
  const t = Number(ms)
  const utc8 = (Number.isFinite(t) && t > 0 ? t : Date.now()) + 8 * 3600 * 1000
  return new Date(utc8).toISOString().slice(0, 10)
}

/** 日序号：用于"今天从候选池里取第几件"。连续两天 → 取相邻两件（明天真的会换新的） */
function dayNumber(dayKey) {
  const t = new Date(`${dayKey}T00:00:00Z`).getTime()
  return Number.isFinite(t) ? Math.floor(t / 86400000) : 0
}

function isOnShelf(row) {
  return !(row && row.isOffShelf === true)
}

function leanProduct(row, matchSource) {
  return {
    _id: row._id,
    title: row.title || row.name || '',
    // 双层命名：文艺主题名做主视觉，标准名兜底（与礼赠选品同一口径）
    themeName: row.themeName || '',
    themeNote: row.themeNote || '',
    latinName: row.latinName || '',
    price: row.price,
    images: Array.isArray(row.images) ? row.images.slice(0, 1) : [],
    category: row.category || '',
    rootCategoryName: row.rootCategoryName || '',
    protectionType: row.protectionType || 'none',
    blessTags: sanitizeBlessTags(row && row.blessTags),
    matchSource: matchSource || 'tag',
    sales: Number(row.sales) || 0
  }
}

/**
 * 同组排序：**显式命中优先** → 同品类优先 → 销量 → 较新 → 价格适中优先（全确定性）
 *
 * ⚠️ 2026-09-20 修：`explicitIds` 此前根本不存在 —— `matchSource` 是**排完序之后**才算的，
 * 于是一个仅靠「婚宴 / 纪念日」场景兜底命中的商品，可以压过**显式打了本标签**的商品。
 * 真机反馈「求缘位推的是前程类商品」的直接来源就在这里：显式命中才是真的相关，
 * 场景兜底只是「存量商品还没有标签时别让功能空转」的补丁，不能反客为主。
 *
 * @param {Array} rows
 * @param {string} [category] 同品类优先的品类名
 * @param {Set<string>} [explicitIds] 显式打了本标签的商品 id
 */
function sortPool(rows, category, explicitIds) {
  const list = (rows || []).slice()
  const prices = list.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0)
  const mid = prices.length ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0
  const wantCat = String(category || '').trim()
  const explicit = (r) => (explicitIds && explicitIds.has(String(r && r._id)) ? 0 : 1)
  return list.sort((a, b) => {
    const ea = explicit(a)
    const eb = explicit(b)
    if (ea !== eb) return ea - eb
    if (wantCat) {
      const ca = String(a.category || '') === wantCat ? 0 : 1
      const cb = String(b.category || '') === wantCat ? 0 : 1
      if (ca !== cb) return ca - cb
    }
    const sa = Number(a.sales) || 0
    const sb = Number(b.sales) || 0
    if (sb !== sa) return sb - sa
    const ta = new Date(a.updatedAt || a.updateTime || a.createdAt || a.createTime || 0).getTime() || 0
    const tb = new Date(b.updatedAt || b.updateTime || b.createdAt || b.createTime || 0).getTime() || 0
    if (tb !== ta) return tb - ta
    const pa = Number(a.price)
    const pb = Number(b.price)
    if (Number.isFinite(pa) && Number.isFinite(pb) && mid > 0) {
      const da = Math.abs(pa - mid)
      const db2 = Math.abs(pb - mid)
      if (da !== db2) return da - db2
      return pa - pb
    }
    if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb
    return String(a._id).localeCompare(String(b._id))
  })
}

/**
 * 按标签取商品：**显式命中 或 场景兜底命中**。
 *
 * 为什么要有场景这一支：存量商品大多没有 `blessTags`，但有**人工策展过的** `giftScenes`。
 * 只查 `blessTags` 会让这批商品永远推荐不出来（= 功能空转，见交付记录 §28.4）。
 * 场景 → 标签的映射写在 blessTags.js 里（写死的、可评审的表），这里只负责查。
 *
 * 老库上没有这两个字段时 where 也能正常执行（命中 0 条）；真出错就退化成只查显式标签，
 * 再出错返回空 —— 推荐失败不该影响玩法本身。
 */
async function queryByTag(tag, take) {
  const scenes = scenesForBless(tag)
  const orConds = [{ blessTags: tag }]
  if (scenes.length) orConds.push({ giftScenes: _.in(scenes) })
  const where = _.and([{ isOffShelf: _.neq(true) }, orConds.length > 1 ? _.or(orConds) : orConds[0]])
  try {
    // ⚠️ 2026-09-20 修（真机反馈「只有孔雀标本一个商品」的真因）：
    // 原实现取 `Math.min(24, limit + exclude.size + 4)` ≈ **7 条** —— 数据库按 `_id` 自然序截断，
    // 于是下面 sortPool 排的只是「_id 最靠前的 7 条」，而不是「全部命中里最好的 7 条」。
    // 排序信号（销量 / 新上架 / 价格）因此在**一个与它们无关的固定小池**里生效 → 永远同几件。
    // 修法：把池子放大到能装下**本标签的全部命中**（商品量级远小于 POOL_MAX），再在代码里排序。
    // 有意**不加** `.orderBy('sales')`：那会把「排序」下推给数据库，而本项目明确要求
    // "排序可解释、可测"（见 check-bless-tags-sync：「不做热门兜底」的代理判据也盯着它）。
    const res = await db.collection('products').where(where).limit(take).get()
    return res.data || []
  } catch (e) {
    try {
      // 退一步：只按显式标签查（逻辑运算在个别老环境上不稳）
      const res = await db
        .collection('products')
        .where({ blessTags: tag, isOffShelf: _.neq(true) })
        .limit(take)
        .get()
      return res.data || []
    } catch (err) {
      console.warn('getBlessProducts query', err)
      return []
    }
  }
}

exports.main = async (event) => {
  const e = event || {}
  const tag = sanitizeBlessTags([e.tag || e.tags])[0] || ''
  if (!getBlessTag(tag)) {
    return { success: false, msg: '未知的祈运标签', code: 'BAD_TAG', list: [] }
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(e.limit) || DEFAULT_LIMIT))
  const exclude = new Set(
    (Array.isArray(e.excludeIds) ? e.excludeIds : [e.excludeIds]).filter(Boolean).map((x) => String(x))
  )
  const dayKey = String(e.dayKey || '').trim() || shanghaiDayKey(Date.now())
  // 取一个有界的大池再筛：排除项在库里过滤不掉，只能取回来再筛（POOL_MAX 留足余量）
  const rows = await queryByTag(tag, POOL_MAX)
  // ⚠️ matchSource 必须**逐行**判定：显式打了这个标签 = 'tag'，靠礼赠场景兜底命中 = 'scene'。
  // 第一版对所有行都写 'tag'，于是客户端一律显示「同好也在看」—— 而场景兜底的商品
  // **根本没有任何"同好"数据**，那是编出来的社会证明（本仓最忌"看起来像真的"）。
  const explicitIds = new Set(
    rows
      .filter((r) => sanitizeBlessTags(r && r.blessTags).includes(tag))
      .map((r) => String(r._id))
  )
  const ranked = sortPool(
    rows.filter((r) => isOnShelf(r) && !exclude.has(String(r._id))),
    e.category,
    explicitIds
  )
  // ★ 2026-09-20 修：**按天轮换** —— 让「一天一件」真的"一天换一件"。
  // 此前选品结果与日期**完全无关**（排序全确定性、又没有随机项），所以只要商品数据不变，
  // 客户端缓存键里那个日期等于白写：每天算出来都是同一件（真机反馈「只有孔雀标本一个商品」）。
  // 做法：从排序后的前 ROTATE_POOL 件里按**日序号**取一件并置于列表首位。
  // 仍然**确定性**（同一天同一标签同一人结果固定），只是**跨天会变**。
  const rotate = ranked.slice(0, ROTATE_POOL)
  const offset = rotate.length
    ? (((dayNumber(dayKey) % rotate.length) + rotate.length) % rotate.length)
    : 0
  const ordered = rotate.length > 1 ? rotate.slice(offset).concat(rotate.slice(0, offset)) : rotate
  const list = ordered
    .concat(ranked.slice(rotate.length))
    .slice(0, limit)
    .map((r) => leanProduct(r, explicitIds.has(String(r._id)) ? 'tag' : 'scene'))
  return { success: true, tag, scenes: scenesForBless(tag), dayKey, list, total: list.length }
}

/**
 * **仅供守卫单元断言**的纯函数出口（非业务 API）。
 * 为什么必须暴露：选品会**按天轮换**（见 exports.main），所以从 `main` 的输出**看不到**基础排名
 * —— 而「显式命中优先于场景兜底」这条恰恰只能靠基础排名来验，且不该依赖"今天是几号"。
 * 守卫（test:wish-wall）直接调它，从而把这条口径钉成与日期无关的断言。
 */
exports.__forTest = { sortPool, shanghaiDayKey, dayNumber }
