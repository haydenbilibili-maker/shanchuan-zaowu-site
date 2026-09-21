/**
 * 每日日报 · 取数层（只读，不写）
 *
 * 所有集合名与时间字段都来自 reportCatalog 的 `sources[]`；
 * 本文件是那份目录的**执行体**：目录说查什么，这里就查什么。
 * 本地守卫 check-daily-digest 会静态核对两边的集合集合是否一致（防口径漂移）。
 */
const { METRICS } = require('./reportCatalog')
const { orderDayPipeline, toNumber } = require('./dailyDigestCore')

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

/** orders：每个指标一次归日聚合（字段不同，不能合并成一次查询） */
async function collectOrderDays (db, dayKey, metrics) {
  const out = {}
  for (const metric of metrics) {
    const field = metric.orderField
    if (!field) continue
    try {
      const res = await db.collection('orders')
        .aggregate()
        .append(orderDayPipeline(dayKey, field, metric.sumField || ''))
        .end()
      const rows = (res && res.list) || []
      const row = rows[0]
      out[metric.id] = row
        ? { found: true, count: toNumber(row.count), sum: row.sum == null ? null : toNumber(row.sum) }
        : { found: false, count: 0, sum: null }
    } catch (e) {
      console.warn(`dailyDigest orders aggregate failed (${metric.id}):`, e && e.message)
      out[metric.id] = { found: false, count: 0, sum: null, error: (e && e.message) || 'aggregate failed' }
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
