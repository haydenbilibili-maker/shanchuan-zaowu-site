/**
 * museumGuideMonitor —— 超管工作台「博物君」：开关 / 每日额度 / 使用监测（2026-11-23，产品负责人点名）
 *
 * 动作：
 *   overview  { days: 7 | 30 }            近 N 天按日统计 + 失败分布 + 热门物种 / 去处 / 入口 / 模型 + 当前配置
 *   setConfig { enabled?, dailyLimit? }    改开关与每日额度（先写审计，审计失败即拒绝）
 *
 * 鉴权：staffGuard.assertStaff({ requireSuperAdmin: true })，只认小程序身份。
 * 数据：museum_guide_logs 由 askMuseumGuide 每次提问写一条（**不含问题与回答原文**）；
 *       museum_guide_config/main 是开关与额度（askMuseumGuide 读、getContentDisplayFlags 只读带出 museumGuideOpen）。
 * 蓝图：miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md §6
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { assertStaff } = require('./staffGuard')

const LOGS = 'museum_guide_logs'
const CONFIG = 'museum_guide_config'
const CONFIG_DOC = 'main'
const DAY_MS = 24 * 3600 * 1000
const BJ_OFFSET = 8 * 3600 * 1000
const BATCH = 1000
const MAX_ROWS = 20000
const LIMIT_MIN = 5
const LIMIT_MAX = 200
const DEFAULT_LIMIT = 30

function fail(code, msg) {
  return { success: false, code, msg }
}

/* ------------------------------ 纯函数（守卫直接调） ------------------------------ */

function bjDayText(ts) {
  return new Date(ts + BJ_OFFSET).toISOString().slice(0, 10)
}

function bjDayStart(ts) {
  return Math.floor((ts + BJ_OFFSET) / DAY_MS) * DAY_MS - BJ_OFFSET
}

function normalizeDays(v) {
  return Number(v) === 30 ? 30 : 7
}

/** 配置入参校验：只认布尔开关与 5–200 的整数额度；都没给 / 不合法 → error */
function normalizeConfigInput(event) {
  const out = {}
  if (typeof event.enabled === 'boolean') out.enabled = event.enabled
  if (event.dailyLimit !== undefined) {
    const n = Number(event.dailyLimit)
    if (!Number.isInteger(n) || n < LIMIT_MIN || n > LIMIT_MAX) return { error: `每日额度须为 ${LIMIT_MIN}–${LIMIT_MAX} 的整数` }
    out.dailyLimit = n
  }
  if (!Object.keys(out).length) return { error: '没有要改的设置' }
  return { patch: out }
}

function viewConfig(doc) {
  const d = doc || {}
  const n = parseInt(d.dailyLimit, 10)
  return {
    enabled: d.enabled !== false,
    dailyLimit: Number.isFinite(n) && n >= LIMIT_MIN && n <= LIMIT_MAX ? n : null,
    defaultLimit: DEFAULT_LIMIT,
    updatedAt: d.updatedAt || 0,
    updatedByName: d.updatedByName || ''
  }
}

const ANSWERED = ['ok', 'answer_risky']
/** 计入成功率分母：真正问到模型那一步的（额度满 / 闭馆 / 入参不合法不算） */
const COUNTED = ['ok', 'answer_risky', 'ai_service', 'risky']

function topOf(counter, n) {
  return Object.keys(counter).map((key) => ({ key, n: counter[key] })).sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1)).slice(0, n)
}

function pct(a, b) {
  return b ? Math.round((a / b) * 1000) / 10 : null
}

function p90(arr) {
  if (!arr.length) return null
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]
}

/**
 * 日志 → 报表。days 天（含今天，北京时间），每天一行（没有数据的天也给 0 行，图表不断档）。
 */
function summarize(rows, now, days) {
  const n = normalizeDays(days)
  const today = bjDayStart(now)
  const dayList = []
  for (let i = n - 1; i >= 0; i--) dayList.push(bjDayText(today - i * DAY_MS))
  const byDay = {}
  dayList.forEach((d) => { byDay[d] = { day: d, asks: 0, users: {}, ok: 0, failed: 0, risky: 0, quota: 0, off: 0, ms: [] } })
  const fails = { ai_service: 0, risky: 0, answer_risky: 0, quota: 0, invalid: 0, off: 0 }
  const species = {}
  const speciesName = {}
  const actions = {}
  const entries = {}
  const models = {}
  const allUsers = {}
  const okMs = []
  let counted = 0
  let answered = 0
  const votes = { up: 0, down: 0 }
  ;(rows || []).forEach((r) => {
    if (!r || !byDay[r.day]) return
    const d = byDay[r.day]
    d.asks += 1
    if (r.openid) { d.users[r.openid] = (d.users[r.openid] || 0) + 1; allUsers[r.openid] = 1 }
    if (Object.prototype.hasOwnProperty.call(fails, r.status)) fails[r.status] += 1
    if (COUNTED.indexOf(r.status) >= 0) counted += 1
    if (ANSWERED.indexOf(r.status) >= 0) {
      answered += 1
      d.ok += 1
      if (typeof r.duration_ms === 'number') { d.ms.push(r.duration_ms); okMs.push(r.duration_ms) }
      ;(r.species || []).forEach((sp) => { if (sp && sp.no) { species[sp.no] = (species[sp.no] || 0) + 1; speciesName[sp.no] = sp.zh || '' } })
      ;(r.actions || []).forEach((a) => { actions[a] = (actions[a] || 0) + 1 })
      if (r.model) models[r.model] = (models[r.model] || 0) + 1
      if (r.vote === 'up' || r.vote === 'down') votes[r.vote] += 1
    }
    if (r.status === 'ai_service') d.failed += 1
    if (r.status === 'risky' || r.status === 'answer_risky') d.risky += 1
    if (r.status === 'quota') d.quota += 1
    if (r.status === 'off') d.off += 1
    entries[r.entry || 'direct'] = (entries[r.entry || 'direct'] || 0) + 1
  })
  const series = dayList.map((k) => {
    const d = byDay[k]
    const perUser = Object.keys(d.users).map((u) => d.users[u])
    return {
      day: k,
      asks: d.asks,
      users: perUser.length,
      ok: d.ok,
      failed: d.failed,
      risky: d.risky,
      quota: d.quota,
      off: d.off,
      avgMs: d.ms.length ? Math.round(d.ms.reduce((a, b) => a + b, 0) / d.ms.length) : null,
      // 单人当天最多问了几次：刷量 / 额度设得合不合适的信号（不出身份）
      maxPerUser: perUser.length ? Math.max.apply(null, perUser) : 0
    }
  })
  const last = series[series.length - 1]
  return {
    days: n,
    series,
    today: { asks: last.asks, users: last.users, ok: last.ok, maxPerUser: last.maxPerUser },
    totals: {
      asks: series.reduce((a, d) => a + d.asks, 0),
      users: Object.keys(allUsers).length,
      answered,
      successRate: pct(answered, counted),
      avgMs: okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null,
      p90Ms: p90(okMs)
    },
    fails,
    // 满意度：有帮助 / （有帮助 + 没帮助）；没人投票时为 null（页面写「—」）
    votes: { up: votes.up, down: votes.down, rate: pct(votes.up, votes.up + votes.down) },
    topSpecies: topOf(species, 8).map((x) => ({ no: x.key, zh: speciesName[x.key] || '', n: x.n })),
    actions: topOf(actions, 7),
    entries: topOf(entries, 5),
    models: topOf(models, 4)
  }
}

/* ------------------------------ 读写 ------------------------------ */

async function readConfigDoc() {
  try {
    const r = await db.collection(CONFIG).doc(CONFIG_DOC).get()
    return (r && r.data) || null
  } catch (e) { return null }
}

async function loadRows(since) {
  const rows = []
  let truncated = false
  for (let skip = 0; skip < MAX_ROWS; skip += BATCH) {
    const res = await db.collection(LOGS)
      .where({ created_at: _.gte(since) })
      .orderBy('created_at', 'asc')
      .skip(skip)
      .limit(BATCH)
      .field({ openid: true, day: true, status: true, model: true, duration_ms: true, species: true, actions: true, entry: true, vote: true })
      .get()
    const got = (res && res.data) || []
    rows.push(...got)
    if (got.length < BATCH) return { rows, truncated }
  }
  truncated = true
  return { rows, truncated }
}

async function overview(event) {
  const days = normalizeDays(event.days)
  const now = Date.now()
  const since = bjDayStart(now) - (days - 1) * DAY_MS
  const [{ rows, truncated }, cfg] = await Promise.all([loadRows(since), readConfigDoc()])
  return { success: true, data: Object.assign(summarize(rows, now, days), { truncated, config: viewConfig(cfg) }) }
}

async function audit(actor, detail) {
  await db.collection('admin_operation_logs').add({
    data: {
      module: 'config',
      action: 'museum_guide_config',
      username: (actor && (actor.name || actor.openid)) || '',
      operatorOpenid: (actor && actor.openid) || '',
      source: 'museumGuideMonitor',
      detail,
      timestamp: Date.now()
    }
  })
}

async function setConfig(event, actor) {
  const v = normalizeConfigInput(event)
  if (v.error) return fail('BAD_INPUT', v.error)
  const before = viewConfig(await readConfigDoc())
  try {
    await audit(actor, { before: { enabled: before.enabled, dailyLimit: before.dailyLimit }, patch: v.patch })
  } catch (e) {
    return fail('AUDIT_FAILED', `修改须先记审计日志，写入失败：${(e && e.message) || e}`)
  }
  const data = Object.assign({}, v.patch, {
    updatedAt: Date.now(),
    updatedBy: (actor && actor.openid) || '',
    updatedByName: String((actor && actor.name) || '').slice(0, 30)
  })
  try {
    const r = await db.collection(CONFIG).doc(CONFIG_DOC).update({ data })
    if (!(r && r.stats && r.stats.updated)) throw new Error('no doc')
  } catch (e) {
    // 文档不存在（首次设置）：带上改前的值整份写，不丢另一个设置
    const keep = { enabled: before.enabled }
    if (before.dailyLimit) keep.dailyLimit = before.dailyLimit
    await db.collection(CONFIG).doc(CONFIG_DOC).set({ data: Object.assign(keep, data) })
  }
  return { success: true, data: viewConfig(await readConfigDoc()) }
}

const ACTIONS = { overview, setConfig }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext() || {}
  const openid = OPENID || ''
  if (!openid) return fail('UNAUTHORIZED', '请先登录')
  const action = String(event.action || '')
  if (!ACTIONS[action]) return fail('UNKNOWN_ACTION', `未知操作：${action}`)
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.code || 'FORBIDDEN', guard.msg || '仅超管可查看')
  try {
    return await ACTIONS[action](event, guard.actor)
  } catch (err) {
    console.error('museumGuideMonitor', action, err)
    return fail('INTERNAL', (err && err.message) || '读取失败')
  }
}

exports._test = { summarize, normalizeConfigInput, viewConfig, normalizeDays, bjDayText, LIMIT_MIN, LIMIT_MAX }
