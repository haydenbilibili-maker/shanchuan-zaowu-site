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
 *   1. 只取 `blessTags` 命中该 tag 且**未下架**的商品；
 *   2. 同品类优先 → 销量 → 较新上架 → 价格适中优先 → _id（**全确定性，不用随机**：
 *      玩法的结果是一天一支，推荐也跟着一天一件，不会刷一次变一个）；
 *   3. **不做兜底**：没有命中的商品就返回空列表。
 *      为什么不做"热门兜底"：那会把"求安"推成任意一件热卖，推荐与标签脱钩 = 乱推，
 *      比不推更糟（见 docs/需求28_…交付记录 §26.6）。
 */
const cloud = require('wx-server-sdk')
const { sanitizeBlessTags, getBlessTag, scenesForBless } = require('./blessTags')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 6

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

/** 同组排序：同品类优先 → 销量 → 较新 → 价格适中优先（全确定性） */
function sortPool(rows, category) {
  const list = (rows || []).slice()
  const prices = list.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0)
  const mid = prices.length ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0
  const wantCat = String(category || '').trim()
  return list.sort((a, b) => {
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
  // 多取一些再过滤：排除项在库里过滤不掉，只能取回来再筛
  const rows = await queryByTag(tag, Math.min(MAX_LIMIT * 4, limit + exclude.size + 4))
  // ⚠️ matchSource 必须**逐行**判定：显式打了这个标签 = 'tag'，靠礼赠场景兜底命中 = 'scene'。
  // 第一版对所有行都写 'tag'，于是客户端一律显示「同好也在看」—— 而场景兜底的商品
  // **根本没有任何"同好"数据**，那是编出来的社会证明（本仓最忌"看起来像真的"）。
  const explicitIds = new Set(
    rows
      .filter((r) => sanitizeBlessTags(r && r.blessTags).includes(tag))
      .map((r) => String(r._id))
  )
  const list = sortPool(rows.filter((r) => isOnShelf(r) && !exclude.has(String(r._id))), e.category)
    .slice(0, limit)
    .map((r) => leanProduct(r, explicitIds.has(String(r._id)) ? 'tag' : 'scene'))
  return { success: true, tag, scenes: scenesForBless(tag), list, total: list.length }
}
