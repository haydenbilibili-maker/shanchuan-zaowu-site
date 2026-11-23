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
const { STAFF_ROLES, ROLE_IDS, systemPromptOf, identityOf, displayOf } = require('./staffPersonas')
const { contextFor, loadSnapshot, pulseOf, asOfText, lastAsOf } = require('./staffContext')
const { findIssues, runPatrol, readPatrolConfig, writePatrolConfig } = require('./staffPatrol')
const { assertStaff, resolveSuperAdminOpenids } = require('./staffGuard')
const { taskById } = require('./staffTasks')
const { detectFabrication, CORRECTION_PROMPT } = require('./staffGuardrails')
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
const ENTRY_SOURCES = ['user', 'atlas', 'identify', 'share', 'daily', 'quiz', 'notes', 'workshop', 'home', 'direct']
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
  // 2026-11-23 真机：模型偶发把 content 直接给成数字（-1.5642379800000002）——
  // 只认字符串，别把非字符串 String() 成"回答"。
  const msg = out.choices && out.choices[0] && out.choices[0].message
  if (msg) return typeof msg.content === 'string' ? msg.content : ''
  return typeof out.text === 'string' ? out.text : ''
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

/**
 * 模型没按 JSON 回、而是在正文后面另起几行写「follow_ups: [...]」「actions: [...]」（2026-11-23 真机截图：
 * 这几行原样露在回答气泡里）。把这类字段行从正文里摘掉，并把里面的条目捞回来。
 * 认：follow_ups / followUps / 追问 / actions / 去处，键名可带引号，冒号全半角都认，数组可跨行。
 */
const FIELD_LINE_RE = /(^|\n)[ \t]*["'“]?(follow_ups|followUps|follow-ups|追问|actions|去处)["'”]?[ \t]*[:：][ \t]*\[([\s\S]*?)\][ \t]*,?[ \t]*(?=\n|$)/gi
function salvageFields(text) {
  const found = { followUps: [], actions: [] }
  const answer = String(text || '').replace(FIELD_LINE_RE, (m, lead, key, body) => {
    const items = (String(body).match(/["“'‘][^"”'’]*["”'’]/g) || []).map((x) => x.slice(1, -1).trim()).filter(Boolean)
    if (/^(actions|去处)$/i.test(key)) found.actions = items
    else found.followUps = items
    return lead
  }).replace(/^[ \t]*["'“]?(answer|回答)["'”]?[ \t]*[:：][ \t]*/i, '')
  return { answer: answer.trim(), followUps: found.followUps, actions: found.actions }
}

/**
 * 回答是否「像一句话」（2026-11-23 真机：问萤火虫为什么发光，气泡里出现 `-1.5642379800000002`）
 * 纯数字 / 纯符号 / 空 → 视为解析失败，走 ai_service 失败分支，不把垃圾当回答。
 */
const PURE_NUM = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/
function usableAnswer(a) {
  const s = String(a || '').trim()
  if (!s) return false
  if (PURE_NUM.test(s)) return false
  return /[\u4e00-\u9fa5A-Za-z]/.test(s)
}

/** 解析模型输出：优先 JSON；不是 JSON 时整段当回答，但先摘掉正文后面的 follow_ups / actions 字段行（见 salvageFields）。去处只认白名单，追问最多 3 个。 */
function parseReply(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let obj = null
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try { obj = JSON.parse(t.slice(s, e + 1)) } catch (err) { obj = null }
  }
  // JSON 里 answer 不是字符串（模型给了个数字）→ 解析失败，不能把 {"answer": -1.56} 当正文
  if (obj && typeof obj.answer !== 'string') return { answer: '', followUps: [], actions: [] }
  const loose = obj ? null : salvageFields(t)
  const answer = plainAnswer(obj ? obj.answer : loose.answer)
  const followUps = (obj && Array.isArray(obj.follow_ups) ? obj.follow_ups : loose ? loose.followUps : [])
    .map((q) => String(q || '').trim()).filter((q) => q && q.length <= 30).slice(0, 3)
  const actions = (obj && Array.isArray(obj.actions) ? obj.actions : loose ? loose.actions : [])
    .map((a) => String(a || '').trim()).filter((a, i, arr) => PLACE_KEYS.indexOf(a) >= 0 && arr.indexOf(a) === i).slice(0, 2)
  return { answer: usableAnswer(answer) ? answer : '', followUps, actions }
}

/**
 * 这次该讲哪几种图鉴物种（2026-11-23 修：问「大蓝闪蝶」却出了上一条回答里的巴黎翠凤蝶 / 天堂凤蝶 ——
 * 原来把问题和最近两条历史（含博物君自己的长回答）拼在一起按名字长短排，长名字压过了真正问的那一种）：
 *   问题里点了名 → 只用问题里的；
 *   问题里没点名（「它现在还活着吗」这类追问）→ 用**上一个访客问题**里的，不看博物君的回答。
 */
function speciesFor(question, history) {
  const fromQ = matchSpecies(question, 3)
  if (fromQ.length) return fromQ
  const lastUser = (history || []).filter((h) => h.role === 'user').slice(-1)[0]
  return lastUser ? matchSpecies(lastUser.content, 3) : []
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

/**
 * 请求参数（2026-11-23）：开 JSON 模式（response_format json_object）—— 模型偶尔不按「只输出 JSON」回、
 * 把 follow_ups / actions 写成正文后面的字段行（真机截图），JSON 模式从源头约束；解析侧 salvageFields 仍兜底。
 * 某个模型不认这个参数（HTTP 400）时，同一模型去掉它再试一次，不因格式约束丢掉一次回答。
 */
function modelParams(jsonMode) {
  const p = { result_format: 'message', enable_thinking: false, temperature: 0.6, max_tokens: 900 }
  if (jsonMode) p.response_format = { type: 'json_object' }
  return p
}

async function askModel(messages, apiKey) {
  let lastErr = null
  for (const model of modelChain(process.env.MUSEUM_GUIDE_MODELS)) {
    for (const jsonMode of [true, false]) {
      try {
        const res = await httpsPostJson(TEXT_PATH, {
          model,
          input: { messages },
          parameters: modelParams(jsonMode)
        }, { Authorization: `Bearer ${apiKey}` })
        const text = extractText(res)
        if (text) return { text, model }
        lastErr = new Error('empty reply')
        break
      } catch (e) {
        lastErr = e
        console.warn(`博物君 模型[${model}]${jsonMode ? '(json)' : ''} 失败`, e.message)
        // 只有「参数不被接受」才同模型降级重试；超时 / 鉴权 / 限流直接换下一个模型
        if (!(jsonMode && e.statusCode === 400)) break
      }
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

/* ------------------------------ AI 智能中心 · 门禁 / 脉搏 / 主动巡检（2026-11-23 第六轮） ------------------------------ */

/**
 * 员工门禁（2026-11-23 第六轮补）：AI 智能中心的回答里带近 30 天经营数据（GMV / 采购额 / 工资合计），
 * 原先只靠「我的·工作台」磁贴不展示来挡，云端没有校验 —— 任何小程序用户直接调 mode:'staff' 就能拿到。
 * 现在三条员工通道（staff / debate / staffBrief）都先过 staffGuard.assertStaff（纯投资人 / 采购商账号也拒）。
 */
async function staffGate(openid, options) {
  try {
    const g = await assertStaff(db, openid, options || {})
    if (g && g.ok) return { ok: true, actor: g.actor }
    return { ok: false, out: { success: false, error_type: 'forbidden', msg: (g && g.msg) || 'AI 智能中心仅限员工使用' } }
  } catch (e) {
    return { ok: false, out: { success: false, error_type: 'forbidden', msg: 'AI 智能中心仅限员工使用' } }
  }
}

function isSuperActor(actor) {
  if (!actor) return false
  if (actor.superAdmin) return true
  return Array.isArray(actor.roles) && actor.roles.indexOf('super_admin') >= 0
}

/** 页面一进来：经营脉搏 + 同事们发现的问题 +（超管才有）巡检开关与上次巡检 */
async function staffBrief(event, openid) {
  const gate = await staffGate(openid)
  if (!gate.ok) return gate.out
  let snap = null
  try { snap = await loadSnapshot(db) } catch (e) { snap = null }
  const isSuper = isSuperActor(gate.actor)
  const out = { success: true, pulse: pulseOf(snap), issues: findIssues(snap), isSuper }
  if (isSuper) out.patrol = await readPatrolConfig(db)
  return out
}

/** 投递一封工作信息（走既有 dispatchMessage；category ops → 工作信息队列；同一问题每人每天一封） */
async function dispatchLetter(payload) {
  const res = await cloud.callFunction({ name: 'dispatchMessage', data: Object.assign({ action: 'dispatch' }, payload) })
  return (res && res.result) || { success: false }
}

async function patrolOnce(dryRun) {
  const snap = await loadSnapshot(db)
  const recipients = dryRun ? [] : await resolveSuperAdminOpenids(db)
  return runPatrol({ db, snapshot: snap, asOf: asOfText(snap && snap.at), recipients, dispatch: dispatchLetter, dryRun })
}

/** 超管：立即巡检（并投递） / 开关自动巡检。改开关先留审计，审计写不进就不改。 */
async function staffPatrol(event, openid) {
  const gate = await staffGate(openid, { requireSuperAdmin: true })
  if (!gate.ok) return gate.out
  const op = String((event && event.op) || 'run')
  if (op === 'toggle') {
    const enabled = !!(event && event.enabled)
    try {
      await db.collection('admin_operation_logs').add({
        data: { module: 'config', action: 'staff_patrol_toggle', operatorOpenid: openid, username: (gate.actor && gate.actor.name) || '', source: 'askMuseumGuide', detail: { enabled }, timestamp: Date.now() }
      })
    } catch (e) {
      return { success: false, error_type: 'audit', msg: '改开关须先记审计日志，这次没写进去，先别改' }
    }
    await writePatrolConfig(db, { enabled, updatedBy: openid })
    return { success: true, patrol: await readPatrolConfig(db) }
  }
  const r = await patrolOnce(false)
  return { success: true, issues: r.issues, sent: r.sent, patrol: await readPatrolConfig(db) }
}

/** 定时触发（config.json 的 staffPatrolRun）：开关关着就什么也不做 */
function isTimerEvent(event) {
  const t = (event && (event.Type || event.triggerType || event.triggerSource)) || ''
  return /timer/i.test(String(t)) || !!(event && event.TriggerName)
}

async function timerPatrol() {
  const cfg = await readPatrolConfig(db)
  if (!cfg.enabled) return { success: true, skipped: 'disabled' }
  const r = await patrolOnce(false)
  return { success: true, issues: r.issues.length, sent: r.sent }
}

/**
 * 董事会辩论（2026-11-23 第三轮）：几位虚拟员工就同一辩题依次发言，最后由主持人收口。
 *
 * 一次请求只做一件事（客户端串行调用，避免一次请求超时）：
 *   step='speak'   → roleId 这一位的发言（要接住前面的人，明确立场）
 *   step='verdict' → 主持人总结（共识 / 分歧 / 可执行建议）
 * 人设与边界仍来自 staffPersonas；发言顺序由客户端按 members 顺序串行。
 */
async function staffDebate(event, openid) {
  const gate = await staffGate(openid)
  if (!gate.ok) return gate.out
  const topic = String((event && event.topic) || '').trim().slice(0, 120)
  if (topic.length < 4) return { success: false, error_type: 'invalid', msg: '辩题太短了' }
  const members = (Array.isArray(event && event.members) ? event.members : [])
    .map((x) => String(x || '')).filter((id, i, arr) => ROLE_IDS.indexOf(id) >= 0 && arr.indexOf(id) === i).slice(0, 4)
  if (members.length < 2) return { success: false, error_type: 'invalid', msg: '至少选两位董事' }
  const step = String((event && event.step) || 'speak')
  const history = (Array.isArray(event && event.speeches) ? event.speeches : [])
    .filter((x) => x && typeof x.text === 'string')
    .map((x) => ({ roleId: String(x.roleId || ''), name: String(x.name || ''), text: x.text.slice(0, 800) }))

  const apiKey = process.env.DASHSCOPE_API_KEY || ''
  if (!apiKey) return { success: false, error_type: 'ai_service', msg: 'AI 服务还没配置，请联系超管' }

  let system = ''
  let user = ''
  if (step === 'verdict') {
    const said = history.map((h) => `【${h.name}】${h.text}`).join('\n')
    system = '你是山海造物的董事会主持人。你要在各方发言后做收口：先给共识，再给分歧，最后给 2-3 条可执行建议。中文，300 字内，不写 Markdown 标题，不编数据。'
    user = `辩题：${topic}\n\n各方发言：\n${said}\n\n请收口。`
  } else {
    const roleId = String((event && event.roleId) || '')
    if (members.indexOf(roleId) < 0) return { success: false, error_type: 'invalid', msg: '这位董事不在本场名单里' }
    const role = STAFF_ROLES[roleId]
    const said = history.map((h) => `【${h.name}】${h.text}`).join('\n')
    // 2026-11-23 第六轮：董事以本人身份发言（名字 / 履历 / 说话方式），并看到同一份经营数据
    let ctx = ''
    try { ctx = await contextFor(roleId, db) } catch (e) { ctx = '' }
    system = `${identityOf(roleId)}\n你正在参加董事会辩论。你的职责：${role.prompt}\n\n` +
      (ctx ? `【当前经营数据（未出现的指标就是没有数据，不要推算）】\n${ctx}\n\n` : '') +
      '规则：站在你的专业立场给出明确判断，能引用数据就引用；若前面有人与你不一致，直接点名指出分歧；口语化，像开会时当面说话；200 字内；中文；不写 Markdown 标题；不编数据。'
    user = `辩题：${topic}${said ? `\n\n前面发言：\n${said}` : ''}\n\n请发言。`
  }

  for (const model of modelChain(process.env.MUSEUM_GUIDE_MODELS)) {
    try {
      const res = await httpsPostJson(TEXT_PATH, {
        model,
        input: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
        parameters: { result_format: 'message', enable_thinking: false, temperature: 0.7, max_tokens: 700 }
      }, { Authorization: `Bearer ${apiKey}` })
      const answer = plainAnswer(extractText(res))
      if (!usableAnswer(answer)) continue
      const sec = await checkText(openid, answer, 2)
      const text = sec.ok ? answer : '（这段发言没有通过内容安全校验，已省略）'
      return { success: true, step, answer: text, roleName: step === 'verdict' ? '主持人' : displayOf(String(event.roleId)) }
    } catch (e) {
      console.warn(`董事会辩论[${step}] 失败`, e.message)
    }
  }
  return { success: false, error_type: 'ai_service', msg: '辩论中断了一下，稍后再试' }
}

/**
 * AI 智能中心（员工端，2026-11-23）：虚拟员工对话。
 * - 不走博物君的开馆 / 每日 30 问：这是员工工具，额度另计（这里不设上限，按模型侧限流）。
 * - 人设只在服务端（staffPersonas.js），客户端只传 roleId。
 * - 问答都过内容安全；不写库、不留对话（会话存本机）。
 */
async function askStaffModel(system, history, apiKey) {
  const messages = [{ role: 'system', content: system }].concat(history)
  for (const model of modelChain(process.env.MUSEUM_GUIDE_MODELS)) {
    try {
      const res = await httpsPostJson(TEXT_PATH, {
        model,
        input: { messages },
        // 事实护栏上线后温度降到 0.4：越低越不容易「补细节」
        parameters: { result_format: 'message', enable_thinking: false, temperature: 0.4, max_tokens: 900 }
      }, { Authorization: `Bearer ${apiKey}` })
      const answer = plainAnswer(extractText(res))
      if (!usableAnswer(answer)) continue
      return answer
    } catch (e) {
      console.warn(`AI中心 模型[${model}] 失败`, e.message)
    }
  }
  return ''
}

async function staffChat(event, openid) {
  const gate = await staffGate(openid)
  if (!gate.ok) return gate.out
  // 一键任务：taskId 优先，角色与问题都取自服务端任务表（客户端改不了）
  const task = event && event.taskId ? taskById(String(event.taskId).trim()) : null
  if (event && event.taskId && !task) return { success: false, error_type: 'invalid', msg: '没有这个任务' }
  const roleId = task ? task.roleId : String((event && event.roleId) || '').trim()
  if (ROLE_IDS.indexOf(roleId) < 0) return { success: false, error_type: 'invalid', msg: '没有这个虚拟员工' }
  const question = (task ? task.question : String((event && event.question) || '')).trim().slice(0, 600)
  if (!question) return { success: false, error_type: 'invalid', msg: '先说要问什么' }
  const history = (Array.isArray(event && event.history) ? event.history : [])
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-6)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 600) }))

  const sec = await checkText(openid, question, 2)
  if (!sec.ok) return { success: false, error_type: 'risky', msg: '这个问题不适合在这里问，换一个吧' }

  const apiKey = process.env.DASHSCOPE_API_KEY || ''
  if (!apiKey) return { success: false, error_type: 'ai_service', msg: 'AI 服务还没配置，请联系超管' }

  // 经营上下文（近 30 天服务端汇总；查不到就只给人设，不编数据）
  let context = ''
  try { context = await contextFor(roleId, db) } catch (e) { context = '' }
  const system = systemPromptOf(roleId) +
    (context ? `\n\n【当前经营数据（近 ${30} 天，服务端实时汇总；未出现的指标就是没有数据，不要推算）】\n${context}` : '')
  const messages = history.concat([{ role: 'user', content: question }])
  let answer = await askStaffModel(system, messages, apiKey)
  if (!answer) return { success: false, error_type: 'ai_service', msg: '这位同事一时没接上话，稍后再试' }

  // 事实护栏：命中「供应商 / 合作年限 / 账期 / 破损率 / 合同 / 政策」这类资料里没有的对象 → 重写一次
  let flags = detectFabrication(answer)
  if (flags.length) {
    const retry = await askStaffModel(`${system}\n\n${CORRECTION_PROMPT}`, messages, apiKey)
    if (retry) { answer = retry; flags = detectFabrication(answer) }
  }
  return {
    success: true,
    roleId,
    roleName: STAFF_ROLES[roleId].name,
    person: STAFF_ROLES[roleId].person,
    answer,
    asOf: context ? lastAsOf() : '',
    needsVerify: flags.length > 0,
    verifyFlags: flags
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  // 定时巡检：只认「没有 OPENID 且是 Timer 事件」—— 小程序端的调用总带 OPENID，伪造不了
  if (!OPENID && isTimerEvent(event)) return timerPatrol()
  if (!OPENID) return { success: false, error_type: 'invalid', msg: '请在小程序内使用' }

  if (event && event.action === 'feedback') return feedback(event, OPENID)
  if (event && event.mode === 'staff') return staffChat(event, OPENID)
  if (event && event.mode === 'debate') return staffDebate(event, OPENID)
  if (event && event.mode === 'staffBrief') return staffBrief(event, OPENID)
  if (event && event.mode === 'staffPatrol') return staffPatrol(event, OPENID)

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
  const matched = speciesFor(input.question, input.history)
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

exports._test = { modelParams, salvageFields, speciesFor, VOTES, modelChain, dailyLimit, effectiveConfig, buildLog, entryOf, dayKey, sanitizeInput, parseReply, plainAnswer, usableAnswer, extractText, SAFE_ANSWER, QUESTION_MAX, HISTORY_MAX }
