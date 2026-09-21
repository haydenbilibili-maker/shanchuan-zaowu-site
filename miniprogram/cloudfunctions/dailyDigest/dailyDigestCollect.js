/**
 * 每日日报 · 取数层（只读，不写）
 *
 * 所有集合名与时间字段都来自 reportCatalog 的 `sources[]`；
 * 本文件是那份目录的**执行体**：目录说查什么，这里就查什么。
 * 本地守卫 check-daily-digest 会静态核对两边的集合集合是否一致（防口径漂移）。
 */
const { METRICS } = require('./reportCatalog')
const { toNumber } = require('./dailyDigestCore')

/** 取某个 kind 的指标清单 */
function metricsOfKind (kind) {
  return METRICS.filter((m) => m.kind === kind)
}

/**
 * @param {object} db  cloud.database()
 * @param {string} dayKey 'YYYY-MM-DD'（东八日；analytics_daily 用同一字符串但其语义是 UTC 日）
 * @param {object} opts { metrics?: string[] 只取这些指标（角色切片用） }
 */
async function collectRaw (db, dayKey, opts = {}) {
  const only = Array.isArray(opts.metrics) && opts.metrics.length ? new Set(opts.metrics) : null
  const want = (m) => !only || only.has(m.id)

  const analyticsMetrics = metricsOfKind('analytics').filter(want)
  const orderMetrics = metricsOfKind('orderDay').filter(want)
  const dateKeyedMetrics = metricsOfKind('dateKeyed').filter((m) => m.phase === 1).filter(want)
  const simpleDayMetrics = metricsOfKind('simpleDay').filter((m) => m.phase === 1).filter(want)

  const [analytics, orderDays, dateKeyedRows, simpleDay] = await Promise.all([
    collectAnalytics(db, dayKey, analyticsMetrics),
    collectOrderDays(db, dayKey, orderMetrics),
    collectDateKeyed(db, dayKey, dateKeyedMetrics),
    collectSimpleDay(db, dayKey, simpleDayMetrics)
  ])

  return { dayKey, analytics, orderDays, dateKeyedRows, simpleDay }
}

/** analytics_daily：一次 action __in 查询取回当日全部聚合行 */
async function collectAnalytics (db, dayKey, metrics) {
  const out = {}
  if (!metrics.length) return out
  const actions = Array.from(new Set(metrics.map((m) => m.action).filter(Boolean)))
  try {
    const res = await db.collection('analytics_daily')
      .where({ dateKey: dayKey, action: db.command.in(actions) })
      .limit(200)
      .get()
    for (const row of (res.data || [])) {
      // 同一 action 理论上只有一行；若出现 module 维度多行，合并计数与 uv 去重
      const key = String(row.action || '')
      if (!key) continue
      if (!out[key]) {
        out[key] = { action: key, count: 0, uv: [] }
      }
      out[key].count += toNumber(row.count)
      const uv = Array.isArray(row.uv) ? row.uv : []
      for (const id of uv) {
        if (out[key].uv.indexOf(id) === -1) out[key].uv.push(id)
      }
    }
  } catch (e) {
    console.warn('dailyDigest collect analytics_daily failed:', e && e.message)
  }
  return out
}

/**
 * orders：按某个 Date 字段做**东八归日**，逐指标聚合。
 *
 * ⚠️ 2026-09-21 集成官修复（线上真调用抓到的 P0）：
 *   原实现用的是 `db.collection().aggregate().append(pipeline)` —— **`append` 不是
 *   `wx-server-sdk` 的 API**（那是 manager-node / @cloudbase/node-sdk 的形态）。
 *   后果：线上 7 个订单指标**全部** `append is not a function`，而 buildDigest 又把
 *   "取数失败"混成"当日无数据"，于是日报平静地报"订单当日无数据" —— 顾客看不到任何异常。
 *   （本地用 `tcb db nosql` / manager-node 验过是绿的：**换了个 SDK 就全错**，
 *    这正是本仓"静态分析 ≠ 事实"的另一面 —— "本地验过 ≠ 线上能跑"。）
 *
 * 现在两条路：
 *   ① 主路：`wx-server-sdk` 的 **fluent 聚合**（仓内已有可用先例：manageWishWall.staffWalls）；
 *   ② 兜底：聚合不可用时，用 JS 算出**东八日边界**做普通 `where` 查询（当日单量小，代价可接受）。
 *   两条路都要能出数；走哪条会记在 `path` 上，便于核对。
 */

/** 东八日 [start, end) 两个绝对时刻（JS 构造，无时区歧义） */
function beijingDayRange (dayKey) {
  const start = new Date(`${dayKey}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 24 * 3600 * 1000)
  return { start, end }
}

async function collectOneOrderDay (db, dayKey, field, sumField) {
  const $ = db.command && db.command.aggregate
  // ① 主路：fluent 聚合
  if ($ && typeof $.dateToString === 'function' && typeof $.sum === 'function') {
    try {
      const group = { count: $.sum(1) }
      if (sumField) group.sum = $.sum(`$${sumField}`)
      group._id = $.dateToString({ format: '%Y-%m-%d', date: `$${field}`, timezone: 'Asia/Shanghai' })
      const res = await db.collection('orders')
        .aggregate()
        .group(group)
        .match({ _id: String(dayKey) })
        .project({ _id: 0, count: 1, ...(sumField ? { sum: 1 } : {}) })
        .end()
      const row = ((res && res.list) || [])[0]
      return row
        ? { found: true, count: toNumber(row.count), sum: row.sum == null ? null : toNumber(row.sum), path: 'agg' }
        : { found: true, count: 0, sum: sumField ? 0 : null, path: 'agg' }
    } catch (e) {
      console.warn(`dailyDigest orders aggregate failed (${field}), fallback to where:`, e && e.message)
    }
  }
  // ② 兜底：东八日边界 + 普通 where（聚合不可用/不支持的运算符时仍能出数）
  const _ = db.command
  const { start, end } = beijingDayRange(dayKey)
  const where = { [field]: _.gte(start).and(_.lt(end)) }
  if (!sumField) {
    const res = await db.collection('orders').where(where).count()
    return { found: true, count: toNumber(res && res.total), sum: null, path: 'where' }
  }
  // 求和需要取回字段：当日单量有限，分页取满（上限 1000 条，超出会标记 truncated）
  const MAX = 1000
  let skip = 0
  let count = 0
  let sum = 0
  let truncated = false
  for (;;) {
    const res = await db.collection('orders')
      .where(where)
      .field({ [sumField]: true })
      .skip(skip)
      .limit(100)
      .get()
    const rows = (res && res.data) || []
    rows.forEach((r) => {
      count += 1
      sum += toNumber(r && r[sumField])
    })
    if (rows.length < 100) break
    skip += rows.length
    if (skip >= MAX) { truncated = true; break }
  }
  return { found: true, count, sum, path: 'where', truncated }
}

async function collectOrderDays (db, dayKey, metrics) {
  const out = {}
  for (const metric of metrics) {
    const field = metric.orderField
    if (!field) continue
    try {
      out[metric.id] = await collectOneOrderDay(db, dayKey, field, metric.sumField || '')
    } catch (e) {
      console.warn(`dailyDigest orders collect failed (${metric.id}):`, e && e.message)
      out[metric.id] = { found: false, count: 0, sum: null, error: (e && e.message) || 'collect failed' }
    }
  }
  return out
}

/** dateKeyed：按集合分组，一次查回当日所有行 */
async function collectDateKeyed (db, dayKey, metrics) {
  const out = {}
  const byCollection = new Map()
  for (const m of metrics) {
    const col = (m.sources && m.sources[0] && m.sources[0].collection) || ''
    if (!col) continue
    if (!byCollection.has(col)) byCollection.set(col, [])
    byCollection.get(col).push(m)
  }
  for (const [col, list] of byCollection) {
    const timeField = (list[0].sources[0].timeField) || 'date'
    try {
      const res = await db.collection(col).where({ [timeField]: dayKey }).limit(200).get()
      out[col] = res.data || []
    } catch (e) {
      console.warn(`dailyDigest ${col} query failed:`, e && e.message)
      out[col] = null
    }
  }
  return out
}

/** simpleDay：直接按日期字段计数 */
async function collectSimpleDay (db, dayKey, metrics) {
  const out = {}
  for (const metric of metrics) {
    const col = metric.collection
    const field = metric.dayField
    if (!col || !field) continue
    try {
      const res = await db.collection(col).where({ [field]: dayKey }).count()
      out[metric.id] = toNumber(res && res.total)
    } catch (e) {
      console.warn(`dailyDigest ${col} count failed:`, e && e.message)
      out[metric.id] = null
    }
  }
  return out
}

module.exports = {
  metricsOfKind,
  collectRaw,
  collectAnalytics,
  collectOrderDays,
  collectDateKeyed,
  collectSimpleDay
}
