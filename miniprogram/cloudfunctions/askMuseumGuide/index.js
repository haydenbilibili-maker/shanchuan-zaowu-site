/**
 * 博物君 · 山海造物标本馆的 AI 馆员（2026-11-23）
 * 蓝图：miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md
 *
 * 入参 { question, history: [{ role, content }] }
 * 出参 成功 { success: true, answer, followUps, actions, quota: { left, cap } }
 *      失败 { success: false, error_type: invalid | risky | quota | ai_service, msg, quota? }
 *
 * 不落对话内容：集合 museum_guide_usage 只记「谁哪天问了几次」。
 * 密钥只读环境变量 DASHSCOPE_API_KEY（与 identifySpecimen 同一个）。
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { checkText } = require('./contentSecurity')
const { matchSpecies, PLACE_KEYS } = require('./knowledge')
const { buildMessages } = require('./persona')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const USAGE_COLLECTION = 'museum_guide_usage'
/** 超管工作台「博物君」的开关与每日额度（museumGuideMonitor 写；2026-11-23） */
const CONFIG_COLLECTION = 'museum_guide_config'
const CONFIG_DOC = 'main'
/** 每次提问一条运营日志：只记状态 / 耗时 / 模型 / 命中物种 / 去处 / 字数，不记问题与回答原文 */
const LOG_COLLECTION = 'museum_guide_logs'
const LOG_TIMEOUT_MS = 1500
const ENTRY_SOURCES = ['user', 'atlas', 'identify', 'share', 'direct']
const CLOSED_MSG = '博物君暂时闭馆整理，过些日子再来'
const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'
const DEFAULT_MODELS = ['qwen-plus', 'qwen-flash']
const DEFAULT_DAILY_LIMIT = 30
const QUESTION_MAX = 300
const HISTORY_MAX = 6
const HISTORY_ITEM_MAX = 600
const SAFE_ANSWER = '这个问题博物君不太方便回答。换个关于自然或标本的问题吧。'

/* ------------------------------ 纯函数（守卫直接调） ------------------------------ */

function modelChain(envValue) {
  const out = []
  String(envValue || '').split(',').map((s) => s.trim()).filter(Boolean).concat(DEFAULT_MODELS)
    .forEach((m) => { if (out.indexOf(m) === -1) out.push(m) })
  return out
}

function dailyLimit(envValue) {
  const n = parseInt(envValue, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT
}

/**
 * 生效的开关与额度：超管配置优先（额度 5–200），没配 / 读不到时开启 + 环境变量额度。
 * 读不到配置**不关馆**（与「缺字段默认开启」的开关口径一致）。
 */
function effectiveConfig(doc, envLimit) {
  const d = doc || {}
  const n = parseInt(d.dailyLimit, 10)
  return {
    enabled: d.enabled !== false,
    cap: Number.isFinite(n) && n >= 5 && n <= 200 ? n : dailyLimit(envLimit)
  }
}

/** 入口来源只认白名单（日志用） */
function entryOf(v) {
  const s = String(v || '')
  return ENTRY_SOURCES.indexOf(s) >= 0 ? s : 'direct'
}

/** 一条运营日志：字段白名单，**没有问题与回答原文** */
function buildLog(o) {
  return {
    openid: o.openid,
    day: o.dayText,
    status: o.status,
    model: o.model || '',
    duration_ms: Math.max(0, o.durationMs | 0),
    species: (o.species || []).slice(0, 3).map((x) => ({ no: String(x.no), zh: String(x.zh) })),
    actions: (o.actions || []).slice(0, 2),
    q_len: o.qLen | 0,
    a_len: o.aLen | 0,
    history_len: o.historyLen | 0,
    entry: entryOf(o.entry),
    created_at: o.now
  }
}

/** 北京时间的日期键 YYYYMMDD */
function dayKey(now) {
  const d = new Date((now || Date.now()) + 8 * 3600 * 1000)
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0')
}

/** 入参清洗：问题 1–300 字；历史只留 user / assistant、最近 6 条、每条截 600 字 */
function sanitizeInput(event) {
  const question = String((event && event.question) || '').replace(/\s+/g, ' ').trim()
  if (!question) return { error: '先写下想问的问题' }
  if (question.length > QUESTION_MAX) return { error: `问题请控制在 ${QUESTION_MAX} 字以内` }
  const raw = Array.isArray(event && event.history) ? event.history : []
  const history = raw
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .slice(-HISTORY_MAX)
    .map((h) => ({ role: h.role, content: h.content.trim().slice(0, HISTORY_ITEM_MAX) }))
  return { question, history }
}

function extractText(res) {
  const out = res && res.output
  if (!out) return ''
  if (out.choices && out.choices[0] && out.choices[0].message) return String(out.choices[0].message.content || '')
  return String(out.text || '')
}

/**
 * 回答去 Markdown（2026-11-23）：气泡是纯文本，模型偶尔仍会写 **粗体** / ## 标题 / - 列表 / `代码`，
 * 原样显示会露出符号。粗体、标题号、代码号去掉；列表号换成「· 」；三个以上空行压成一个。
 */
function plainAnswer(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 解析模型输出：优先 JSON；不是 JSON 时整段当回答。去处只认白名单，追问最多 3 个。 */
function parseReply(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let obj = null
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try { obj = JSON.parse(t.slice(s, e + 1)) } catch (err) { obj = null }
  }
  const answer = plainAnswer((obj && obj.answer) || (obj ? '' : t))
  const followUps = (obj && Array.isArray(obj.follow_ups) ? obj.follow_ups : [])
    .map((q) => String(q || '').trim()).filter((q) => q && q.length <= 30).slice(0, 3)
  const actions = (obj && Array.isArray(obj.actions) ? obj.actions : [])
    .map((a) => String(a || '').trim()).filter((a, i, arr) => PLACE_KEYS.indexOf(a) >= 0 && arr.indexOf(a) === i).slice(0, 2)
  return { answer, followUps, actions }
}

/* ------------------------------ 外部调用 ------------------------------ */

function httpsPostJson(path, body, headers) {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: DASHSCOPE_HOST,
      path,
      method: 'POST',
      timeout: 40000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers)
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(raw)
          if (res.statusCode >= 400) {
            const err = new Error(j.message || raw || `HTTP ${res.statusCode}`)
            err.statusCode = res.statusCode
            return reject(err)
          }
          resolve(j)
        } catch (e) { reject(new Error(raw || e.message)) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function askModel(messages, apiKey) {
  let lastErr = null
  for (const model of modelChain(process.env.MUSEUM_GUIDE_MODELS)) {
    try {
      const res = await httpsPostJson(TEXT_PATH, {
        model,
        input: { messages },
        parameters: { result_format: 'message', enable_thinking: false, temperature: 0.6, max_tokens: 900 }
      }, { Authorization: `Bearer ${apiKey}` })
      const text = extractText(res)
      if (text) return { text, model }
      lastErr = new Error('empty reply')
    } catch (e) {
      lastErr = e
      console.warn(`博物君 模型[${model}] 失败`, e.message)
    }
  }
  throw lastErr || new Error('all models failed')
}

/** 今日已用次数（读不到按 0，不因为计数挡住提问） */
async function usedToday(id) {
  try {
    const r = await db.collection(USAGE_COLLECTION).doc(id).get()
    return (r && r.data && r.data.count) || 0
  } catch (e) { return 0 }
}

async function bumpUsage(id, openid, day, delta) {
  try {
    const r = await db.collection(USAGE_COLLECTION).doc(id).update({ data: { count: _.inc(delta), updatedAt: db.serverDate() } })
    if (r && r.stats && r.stats.updated) return
  } catch (e) { /* 文档不存在时走 set */ }
  if (delta <= 0) return
  try {
    await db.collection(USAGE_COLLECTION).doc(id).set({ data: { openid, day, count: delta, updatedAt: db.serverDate() } })
  } catch (e) { console.warn('博物君 计数写入失败', e.message) }
}

/* ------------------------------ 入口 ------------------------------ */

async function readConfig() {
  try {
    const r = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get()
    return (r && r.data) || null
  } catch (e) { return null }
}

/** 写运营日志：1.5 秒上限、吞错 —— 日志写不进去也不影响回答 */
async function writeLog(entry) {
  try {
    const r = await Promise.race([
      db.collection(LOG_COLLECTION).add({ data: buildLog(entry) }),
      new Promise((resolve) => setTimeout(resolve, LOG_TIMEOUT_MS))
    ])
    return (r && r._id) || ''
  } catch (e) {
    console.warn('博物君 日志写入失败', e.message)
    return ''
  }
}

const VOTES = ['up', 'down']

/**
 * 回答反馈（2026-11-23）：「有帮助 / 没帮助」记在这次提问的那条日志上 —— 只认本人、只记一次、只认两种票。
 * 不另存任何内容；超管报表据此算满意度。
 */
async function feedback(event, openid) {
  const logId = String((event && event.logId) || '').trim()
  const vote = String((event && event.vote) || '')
  if (!logId || logId.length > 64 || VOTES.indexOf(vote) < 0) return { success: false, error_type: 'invalid', msg: '反馈参数不对' }
  let doc = null
  try {
    const r = await db.collection(LOG_COLLECTION).doc(logId).get()
    doc = r && r.data
  } catch (e) { doc = null }
  if (!doc || doc.openid !== openid) return { success: false, error_type: 'invalid', msg: '找不到这次回答' }
  if (doc.vote) return { success: true, already: true, vote: doc.vote }
  await db.collection(LOG_COLLECTION).doc(logId).update({ data: { vote, voted_at: Date.now() } })
  return { success: true, vote }
}

function bjDayText(now) {
  const d = new Date(now + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, error_type: 'invalid', msg: '请在小程序内使用' }

  if (event && event.action === 'feedback') return feedback(event, OPENID)

  const t0 = Date.now()
  const cfg = effectiveConfig(await readConfig(), process.env.MUSEUM_GUIDE_DAILY_LIMIT)
  const cap = cfg.cap
  const day = dayKey(t0)
  const usageId = `${OPENID}_${day}`
  const used = await usedToday(usageId)

  // 进页时取一次状态（开没开 / 今天还剩几问），不计次、不记日志
  if (event && event.action === 'status') {
    return { success: true, enabled: cfg.enabled, msg: cfg.enabled ? '' : CLOSED_MSG, quota: { left: Math.max(0, cap - used), cap } }
  }

  const base = { openid: OPENID, dayText: bjDayText(t0), entry: event && event.from, historyLen: Array.isArray(event && event.history) ? event.history.length : 0, now: t0 }
  const finish = async (status, out, extra) => {
    const logId = await writeLog(Object.assign({}, base, { status, durationMs: Date.now() - t0 }, extra || {}))
    // 只有真正回答了的才带日志号（页面据此出「有帮助 / 没帮助」）
    if (out && out.success && logId) out.logId = logId
    return out
  }

  if (!cfg.enabled) return finish('off', { success: false, error_type: 'off', msg: CLOSED_MSG })

  const input = sanitizeInput(event)
  if (input.error) return finish('invalid', { success: false, error_type: 'invalid', msg: input.error })
  base.qLen = input.question.length

  if (used >= cap) {
    return finish('quota', { success: false, error_type: 'quota', msg: `今天已经问了 ${cap} 个问题，明天再来找博物君吧`, quota: { left: 0, cap } })
  }

  // 问题先过内容安全；检测服务报错也不放行（全站口径：不 fail-open）
  const sec = await checkText(OPENID, input.question, 2)
  if (!sec.ok) {
    return finish('risky', { success: false, error_type: 'risky', msg: sec.reason === 'risky' ? '这个问题博物君没法回答，换一个吧' : '暂时没能读懂这个问题，请稍后再试', quota: { left: cap - used, cap } })
  }

  const apiKey = process.env.DASHSCOPE_API_KEY || ''
  if (!apiKey) return finish('ai_service', { success: false, error_type: 'ai_service', msg: '博物君暂时不在馆里，稍后再来', quota: { left: cap - used, cap } })

  // 先记一次（防并发刷量）；模型全挂时退回这一次
  await bumpUsage(usageId, OPENID, day, 1)
  const recent = input.history.map((h) => h.content).slice(-2).join('\n')
  const matched = matchSpecies(input.question + '\n' + recent, 3)
  let reply
  let model = ''
  try {
    const got = await askModel(buildMessages(input.question, input.history, matched), apiKey)
    model = got.model
    reply = parseReply(got.text)
  } catch (e) {
    await bumpUsage(usageId, OPENID, day, -1)
    return finish('ai_service', { success: false, error_type: 'ai_service', msg: '博物君一时没翻到答案，请稍后再试', quota: { left: cap - used, cap } })
  }
  if (!reply.answer) {
    await bumpUsage(usageId, OPENID, day, -1)
    return finish('ai_service', { success: false, error_type: 'ai_service', msg: '博物君一时没翻到答案，请稍后再试', quota: { left: cap - used, cap } }, { model })
  }

  // 回答再过一次内容安全：有风险就换成固定回复
  let status = 'ok'
  const outSec = await checkText(OPENID, reply.answer, 2)
  if (!outSec.ok && outSec.reason === 'risky') { reply = { answer: SAFE_ANSWER, followUps: [], actions: [] }; status = 'answer_risky' }

  const species = matched.map((sp) => ({ no: sp.no, zh: sp.zh }))
  return finish(status, {
    success: true,
    answer: reply.answer,
    followUps: reply.followUps,
    actions: reply.actions,
    species,
    quota: { left: Math.max(0, cap - used - 1), cap }
  }, { model, species, actions: reply.actions, aLen: reply.answer.length })
}

exports._test = { VOTES, modelChain, dailyLimit, effectiveConfig, buildLog, entryOf, dayKey, sanitizeInput, parseReply, plainAnswer, extractText, SAFE_ANSWER, QUESTION_MAX, HISTORY_MAX }
