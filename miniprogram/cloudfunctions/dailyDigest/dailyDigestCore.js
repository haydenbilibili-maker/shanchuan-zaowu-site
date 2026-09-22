/**
 * 每日日报 · 计算内核（**无副作用、可本地真跑**）
 *
 * 分层理由（错题本 E18-b：注入必须打到实现真源）：
 *   · 本文件只做「给定行数据 → 日报结构」，不 import wx-server-sdk、不连库；
 *   · 取数在 dailyDigestCollect.js，写消息在 dailyDigestStore.js，入口在 index.js；
 *   · 因此 admin/scripts/check-daily-digest.mjs 可以用构造好的行**真跑**一遍本文件，
 *     而不是只做静态断言。数字类口径必须真跑（AGENTS.md「静态分析 ≠ 事实」）。
 *
 * 单位纪律（错题本 E18/E21）：
 *   字段名自带单位。`*Fen` 一律是**分**（整数），`*Yuan` 一律是**元**（浮点/数值），
 *   `*Count` 是笔数。日报 payload 里每个金额都同时带 `unit`，展示层只按 `unit` 换算。
 */

const { METRICS, ROLE_SLICES, SECTIONS, ROLES } = require('./reportCatalog')

const BJ_OFFSET_MS = 8 * 60 * 60 * 1000

/** 东八日键：给定毫秒（或空 = 现在），返回 'YYYY-MM-DD'（北京时间） */
function beijingDayKey (ms) {
  const t = ms == null ? Date.now() : Number(ms)
  if (!Number.isFinite(t)) return ''
  return new Date(t + BJ_OFFSET_MS).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 东八日 00:00:00 的 epoch ms */
function beijingDayStartMs (dayKey) {
  const s = String(dayKey || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN
  const t = Date.parse(`${s}T00:00:00.000Z`)
  return Number.isFinite(t) ? t - BJ_OFFSET_MS : NaN
}

/** 昨日（相对于给定毫秒）的东八日键 */
function previousDayKey (ms) {
  const today = beijingDayKey(ms)
  return beijingDayKey(beijingDayStartMs(today) - 1)
}

/** 校验日键格式 */
function assertDayKey (dayKey) {
  const s = String(dayKey || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return s
}

/**
 * Mogo 聚合管道：orders 按某个 Date 字段做东八归日。
 * 为什么要显式 `$dateToString{timezone:'Asia/Shanghai'}`：
 *   云函数运行在 UTC，用 `$gte/$lt` 手算边界容易差一天（实测踩过：`$gte` 边界查不到，
 *   而 `$dateToString` 分桶正确）。时区交给 Mongo，边界就只存在于一个地方。
 *
 * ⚠️ 对象展开顺序是有语义的：`{ _id: X, ...group }` 会让 group 里的 `_id` **覆盖** X。
 *    第一版正是这么写的，于是 `$group: { _id: null }` 把日期桶丢掉，
 *    后面的 `$match: { _id: dayKey }` 永远匹配不上 → 所有订单指标静默为「未取到」。
 *    实测（真跑，不是读代码）才暴露：`orderDayPipeline('2026-09-20','createTime','')`
 *    的第二段输出是 `{"$group":{"_id":null,...}}`。
 */
function orderDayPipeline (dayKey, dateField, sumField) {
  const group = { count: { $sum: 1 } }
  if (sumField) group.sum = { $sum: `$${sumField}` }
  return [
    { $match: { [dateField]: { $type: 'date' } } },
    {
      $group: {
        ...group,
        // ← 必须放在展开**之后**，否则被 group 覆盖（见上方 ⚠️）
        _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'Asia/Shanghai' } }
      }
    },
    { $match: { _id: String(dayKey) } },
    { $project: { _id: 0, count: 1, ...(sumField ? { sum: 1 } : {}) } }
  ]
}

/** 数值归一：Mogo 的 $numberInt/$numberDouble/$numberLong 包一层对象 */
function toNumber (v) {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'object') {
    if (v.$numberInt != null) return Number(v.$numberInt) || 0
    if (v.$numberDouble != null) return Number(v.$numberDouble) || 0
    if (v.$numberLong != null) return Number(v.$numberLong) || 0
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 从一行 analytics_daily 取 count 与 uv 人数 */
function readAnalyticsRow (row) {
  if (!row || typeof row !== 'object') return { count: 0, uvCount: 0, found: false }
  const uv = Array.isArray(row.uv) ? row.uv : []
  return { count: toNumber(row.count), uvCount: uv.length, found: true }
}

/**
 * 汇总「原始行 → 日报指标值」。
 *
 * @param {object} raw
 * @param {string} raw.dayKey         目标东八日 'YYYY-MM-DD'
 * @param {object} raw.analytics      { [action]: analytics_daily 行 }
 * @param {object} raw.orderDays      { [metricId]: { count, sum } }
 * @param {object} raw.dateKeyedRows  { [collection]: [行] }
 * @param {object} raw.simpleDay      { [metricId]: count }
 * @param {string} raw.role           渲染切片
 */
function buildDigest (raw = {}) {
  const dayKey = assertDayKey(raw.dayKey)
  const role = String(raw.role || ROLES.SUPER_ADMIN)
  const slice = ROLE_SLICES[role] || ROLE_SLICES[ROLES.SUPER_ADMIN]
  const picked = new Set(slice.metrics || [])
  const analytics = raw.analytics || {}
  const orderDays = raw.orderDays || {}
  const dateKeyedRows = raw.dateKeyedRows || {}
  const simpleDay = raw.simpleDay || {}

  const rows = []
  for (const metric of METRICS) {
    if (!picked.has(metric.id)) continue
    if (metric.section && slice.sections && slice.sections.indexOf(metric.section) === -1) continue
    rows.push(readMetric(metric, { analytics, orderDays, dateKeyedRows, simpleDay }))
  }

  const sections = (slice.sections || []).map((key) => ({
    key,
    label: SECTION_LABELS[key] || key,
    metrics: rows.filter((r) => r.section === key)
  })).filter((s) => s.metrics.length)

  return {
    dayKey,
    role,
    roleLabel: slice.label || role,
    title: `${dayKey} 日报`,
    sections,
    metrics: rows,
    metricsCount: rows.length,
    /** 当日**确实没有数据**（不是取数失败） */
    missing: rows.filter((r) => r.value == null && !r.error).map((r) => r.id),
    /** **取数失败**（聚合报错等）：必须与"当日无数据"分开，且要把原因带回给调用方 */
    failed: rows.filter((r) => r.error).map((r) => ({ id: r.id, label: r.label, error: r.error }))
  }
}

const SECTION_LABELS = {
  [SECTIONS.MINIAPP]: '小程序数据',
  [SECTIONS.ORDERS]: '订单数据',
  [SECTIONS.STORE]: '门店营收'
}

function readMetric (metric, bag) {
  const base = {
    id: metric.id,
    section: metric.section,
    label: metric.label,
    unit: metric.unit,
    source: metric.source,
    sources: metric.sources || [],
    caveat: metric.caveat || '',
    value: null
  }

  if (metric.kind === 'analytics') {
    const row = bag.analytics[metric.action]
    // P1-4：取数失败（analytics_daily 查询抛错）必须分流到 failed —— 见 collectAnalytics 的 catch。
    if (row && row.error) {
      base.value = null
      base.error = String(row.error).slice(0, 240)
      return base
    }
    const { count, uvCount, found } = readAnalyticsRow(row)
    // 「访问人数 / 新注册」按 uv[] 去重人数；其余按 count
    const useUv = metric.id === 'mini_visitors' || metric.id === 'mini_register'
    base.value = found ? (useUv ? uvCount : count) : null
    base.detail = found ? { count, uvCount } : null
    return base
  }

  if (metric.kind === 'orderDay') {
    const got = bag.orderDays[metric.id]
    if (!got || got.found !== true) {
      base.value = null
      /* ⚠️ 2026-09-21 集成官修复：**取数失败 ≠ 当日无数据**。
       * 原来 `found !== true` 一律当成"当日没有数据"，于是聚合抛错时（实测线上 orders 全部聚合失败）
       * 日报会平静地写「未取到」，读的人以为"那天真的没订单" —— 这正是本仓反复禁止的
       * 「把故障说成事实」。现在把适配器带回来的 error 原样挂上，由 buildDigest 分流。 */
      if (got && got.error) base.error = String(got.error).slice(0, 240)
      return base
    }
    base.value = metric.sumField ? toNumber(got.sum) : toNumber(got.count)
    base.detail = { count: toNumber(got.count) }
    return base
  }

  if (metric.kind === 'dateKeyed' || metric.kind === 'simpleDay') {
    if (metric.kind === 'simpleDay') {
      const got = bag.simpleDay[metric.id]
      // P1-4：取数失败（count 抛错）→ failed，与"当日确实没有行"（null/undefined → missing）分开。
      if (got && typeof got === 'object' && got.error) {
        base.value = null
        base.error = String(got.error).slice(0, 240)
        return base
      }
      base.value = got == null ? null : toNumber(got)
      return base
    }
    // 集合名一律从目录 `sources[0].collection` 取（不是按 id 猜，也不散落在别处）
    const col = (metric.sources && metric.sources[0] && metric.sources[0].collection) || metric.collection
    const rows = bag.dateKeyedRows[col]
    if (!Array.isArray(rows)) {
      base.value = null
      // P1-4：取数失败（dateKeyed 查询抛错）带 error 对象；"当日无行"是空数组，二者必须分开。
      if (rows && rows.error) base.error = String(rows.error).slice(0, 240)
      return base
    }
    // 求和字段来自目录登记（`sumField`），不从 id 猜 —— 字段与指标的对应必须一眼可查（错题本 E20）
    const field = metric.sumField
    if (!field) {
      base.value = null
      base.unsupported = `dateKeyed 指标 ${metric.id} 未登记 sumField`
      return base
    }
    base.value = rows.reduce((acc, r) => acc + toNumber(r && r[field]), 0)
    base.detail = { rowCount: rows.length, field, collection: col }
    if (!rows.length) base.value = null // 「当日无行」显式区别于「合计为 0」
    return base
  }

  base.unsupported = metric.kind
  return base
}

/** 金额展示：分 → 元（两位小数），元 → 原样两位小数 */
function formatValue (metric) {
  const v = metric.value
  if (v == null) return '未取到'
  const n = toNumber(v)
  if (metric.unit === 'fen') return `¥${(n / 100).toFixed(2)}`
  if (metric.unit === 'yuan') return `¥${n.toFixed(2)}`
  if (metric.unit === 'count') return `${n} 人/次`
  return `${n}`
}

/** 站内信正文（用户看到的纯文本；结构化数据在 payload.metrics 里） */
function buildMessageText (digest) {
  const lines = [`${digest.dayKey} · ${digest.roleLabel}`, '']
  for (const s of digest.sections) {
    lines.push(`【${s.label}】`)
    for (const m of s.metrics) {
      lines.push(`· ${m.label}：${formatValue(m)}`)
    }
    lines.push('')
  }
  const missing = digest.missing.length
  if (missing) lines.push(`（${missing} 项当日无数据）`)
  const failed = (digest.failed || []).length
  // 失败必须单独说，且**不能**混进"当日无数据" —— 那会让读者以为那天真的没生意
  // ⚠️ 2026-09-21 P3-21：正文是**纯文本**（站内信不渲染 markdown），原先写的 `**取数失败**`
  //    会把星号原样显示给读者 —— 已去掉星号，只留 ⚠️ 前缀做视觉强调。
  if (failed) lines.push(`⚠️ ${failed} 项取数失败（数据可能不准，请联系技术）：${(digest.failed || []).map((f) => f.label).join('、')}`)
  lines.push('', '口径与来源见详情页「数据口径」。')
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 去重键：同一天同一人同一角色只发一条（relatedId 用日期，天然幂等） */
function digestDedupeKey (dayKey, role, openid) {
  return `daily_digest:${role}:${dayKey}:${openid}`
}

module.exports = {
  BJ_OFFSET_MS,
  SECTION_LABELS,
  beijingDayKey,
  beijingDayStartMs,
  previousDayKey,
  assertDayKey,
  orderDayPipeline,
  toNumber,
  readAnalyticsRow,
  buildDigest,
  formatValue,
  buildMessageText,
  digestDedupeKey
}
