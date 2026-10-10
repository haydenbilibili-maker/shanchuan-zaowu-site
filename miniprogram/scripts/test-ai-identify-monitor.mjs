#!/usr/bin/env node
/**
 * test:ai-identify-monitor —— 超管「AI 鉴定监测」（蓝图 miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md）
 *
 * 真跑云函数真源（内存 mock wx-server-sdk，不联网、不写盘）：
 *   A. identifySpecimen 旁路日志：失败 / 成功 / 同物种复用三态落日志；日志写入抛错或挂起时出参逐字不变、
 *      按上限返回；非鉴定动作不写日志；原函数抛错时照样记失败并原样抛出；出参字段集不被加料；
 *      非鉴定动作清单与 index.js 一致；模型名不写死、默认清单有备用且不含已下线模型、
 *      首选模型「Model not exist」时自动切备用（日志记实际模型）、全部不可用时失败并记原因
 *   B. aiIdentifyMonitor：未登录 / 普通用户 / 店长 / 仅持运维口令 一律被拒且零读取日志集合；
 *      超管放行；list / detail 先写审计再读，审计失败即拒且零读取
 *   C. 规则与登记：规则 read/write 全 false、敏感清单 serverOnly、COLLECTIONS、schema、云函数登记；
 *      小程序 / ERP 源码不得直读该集合
 *   D. 页面与入口：在超管分包、只调 aiIdentifyMonitor、无原生弹窗、可见文案无集合名 / 字段名；
 *      菜单键只有超管可见，Hub 磁贴与跳转判同一菜单键
 *   E. aiIdentifyRetention 保留期清理：阈值 180 天；只删 identify/ 前缀下的照片（商品图 / 越界路径不动）；
 *      用户自己的鉴定记录或 180 天内日志仍引用的照片保留；先删文件后删记录、删失败的记录留待重试；
 *      单批 ≤ 50、单次 ≤ 500；只认定时事件 + 非客户端来源；每日触发器与云函数登记；页面告知保留期
 *
 * --selftest：对源码做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module, { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const ID_DIR = join(MP, 'cloudfunctions/identifySpecimen')
const MON_DIR = join(MP, 'cloudfunctions/aiIdentifyMonitor')
const require = createRequire(import.meta.url)
const { Command } = require('@cloudbase/database/dist/commonjs/command')

const SUPER_OPENID = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
const MANAGER_OPENID = 'oMANAGER_test_000000000000000'
const USER_OPENID = 'oUSER_test_00000000000000000'
const LOGS = 'ai_identify_logs'

const PATHS = {
  identifyIndex: join(ID_DIR, 'index.js'),
  identifyLog: join(ID_DIR, 'identifyLog.js'),
  aiModels: join(ID_DIR, 'aiModels.js'),
  monitorIndex: join(MON_DIR, 'index.js'),
  rules: join(ROOT, 'cloudbase/rules/ai_identify_logs.json'),
  sensitive: join(ROOT, 'cloudbase/sensitive-collections.json'),
  schema: join(ROOT, 'cloudbase/schema/ai_identify_logs.md'),
  cloudJs: join(ROOT, 'admin/src/cloud.js'),
  cloudbaserc: join(MP, 'cloudbaserc.json'),
  appJson: join(MP, 'app.json'),
  pageJs: join(MP, 'subpackages/manager/identify-monitor/index.js'),
  pageWxml: join(MP, 'subpackages/manager/identify-monitor/index.wxml'),
  roles: join(MP, 'utils/workspaceRoles.js'),
  mpc: join(MP, 'subpackages/manager/manager/managerPageConfig.js'),
  hubWxml: join(MP, 'subpackages/manager/manager/index.wxml'),
  retentionIndex: join(MP, 'cloudfunctions/aiIdentifyRetention/index.js'),
  retentionConfig: join(MP, 'cloudfunctions/aiIdentifyRetention/config.json'),
  sourceOrigin: join(MP, 'cloudfunctions/aiIdentifyRetention/sourceOrigin.js')
}

function loadSources() {
  const s = {}
  for (const [k, p] of Object.entries(PATHS)) s[k] = existsSync(p) ? readFileSync(p, 'utf8') : null
  return s
}

function compile(filename, source, requireHook) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const orig = m.require.bind(m)
  m.require = (id) => {
    const hit = requireHook(id)
    return hit === undefined ? orig(id) : hit
  }
  m._compile(source, filename)
  return m.exports
}

/** 通用内存库：记录调用顺序；resolvers 决定返回 */
function makeDb({ resolveGet = () => [], addBehavior = () => 'ok' } = {}) {
  const calls = []
  function chain(name, kind) {
    const state = { name, where: null }
    const api = {
      where(w) { state.where = w; return api },
      orderBy() { return api },
      skip() { return api },
      limit() { return api },
      field() { return api },
      match() { return api },
      group() { return api },
      count(label) {
        if (kind === 'agg') { state.label = label; return api }
        calls.push({ coll: name, op: 'count' })
        return Promise.resolve({ total: 3 })
      },
      async end() { calls.push({ coll: name, op: 'aggregate' }); return { list: [{ n: 2 }] } },
      async get() { calls.push({ coll: name, op: 'get', where: state.where }); return { data: resolveGet(name, state.where) } },
      add(arg) {
        calls.push({ coll: name, op: 'add', data: arg && arg.data })
        const b = addBehavior(name)
        if (b === 'throw') return Promise.reject(new Error('mock add failed'))
        if (b === 'hang') return new Promise(() => {})
        return Promise.resolve({ _id: `${name}_new` })
      },
      doc(id) {
        return {
          async get() {
            calls.push({ coll: name, op: 'get', id })
            const rows = resolveGet(name, { _id: id })
            return { data: rows[0] || null }
          },
          async update() { calls.push({ coll: name, op: 'update', id }); return { stats: { updated: 1 } } }
        }
      },
      aggregate() { return chain(name, 'agg') }
    }
    return api
  }
  const db = {
    command: Command,
    collection: (name) => chain(name),
    RegExp: (o) => ({ $regex: o.regexp, $options: o.options })
  }
  return { db, calls }
}

function makeCloud(db, { openid = USER_OPENID, ctxThrows = false } = {}) {
  return {
    init() {},
    DYNAMIC_CURRENT_ENV: 'test',
    database: () => db,
    getWXContext: () => {
      if (ctxThrows) throw new Error('ctx boom')
      return { OPENID: openid }
    },
    async downloadFile({ fileID }) {
      if (/missing/.test(fileID)) throw new Error('not found')
      return { fileContent: Buffer.from('fake-image-bytes') }
    },
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map((f) => ({ fileID: f.fileID || f, tempFileURL: `https://tmp.example/${encodeURIComponent(f.fileID || f)}` })) }
    },
    async callFunction() { return { result: {} } }
  }
}

const PROFILE_STUB = {
  fetchSpeciesKnowledge: async () => null,
  buildSpeciesProfile: async () => ({ profileVersion: 99 }),
  extractAiStructured: () => ({}),
  knowledgePromptSnippet: () => '',
  PROFILE_VERSION: 1
}
const CS_STUB = { checkImageBuffer: async () => ({ ok: true }), checkFileImage: async () => ({ ok: true }) }

function loadIdentify(src, cloud, httpsStub) {
  const modelsMod = compile(PATHS.aiModels, src.aiModels, () => undefined)
  const logMod = compile(PATHS.identifyLog, src.identifyLog, (id) => (id === './aiModels' ? modelsMod : undefined))
  return compile(PATHS.identifyIndex, src.identifyIndex, (id) => {
    if (id === 'wx-server-sdk') return cloud
    if (id === './contentSecurity') return CS_STUB
    if (id === './speciesProfile') return PROFILE_STUB
    if (id === './identifyLog') return logMod
    if (id === './aiModels') return modelsMod
    if (id === 'https' && httpsStub) return httpsStub
    return undefined
  })
}

/** 假 DashScope：answer(body) → { status, json }；记录每次请求的 model 与图片传法 */
function makeHttpsStub(answer) {
  const seen = []
  const stub = {
    request(opts, cb) {
      let data = ''
      const handlers = {}
      return {
        on(ev, f) { handlers[ev] = f; return this },
        write(c) { data += c },
        end() {
          const body = JSON.parse(data || '{}')
          const img = (((body.input || {}).messages || [])[0] || {}).content
          const image = Array.isArray(img) ? (img.find((x) => x && x.image) || {}).image || '' : ''
          seen.push({ path: opts.path, model: body.model, via: /^data:/.test(image) ? 'base64' : image ? 'url' : 'text' })
          const { status, json } = answer(body, opts.path)
          const resHandlers = {}
          const res = { statusCode: status, on(ev, f) { resHandlers[ev] = f; return res } }
          setImmediate(() => {
            cb(res)
            setImmediate(() => { resHandlers.data && resHandlers.data(JSON.stringify(json)); resHandlers.end && resHandlers.end() })
          })
        }
      }
    }
  }
  return { stub, seen }
}

const VL_OK_TEXT = JSON.stringify({ species_name_zh: '大蓝闪蝶', species_name_latin: 'Morpho menelaus', taxonomy: { order: '鳞翅目' }, confidence: 0.95, brief_description: '蓝', is_specimen: true, alternatives: [] })
const SCI_OK_TEXT = JSON.stringify({ content: '科普正文', fun_fact: '冷知识' })

function withTimeout(p, ms) {
  let t
  return Promise.race([p, new Promise((resolve) => { t = setTimeout(() => resolve({ __timeout: true }), ms) })]).finally(() => clearTimeout(t))
}

function makeAsserter() {
  const failures = []
  let pass = 0
  return {
    ok(name, cond, detail) { if (cond) pass += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`) },
    failures,
    get pass() { return pass }
  }
}

const SUCCESS_KEYS = ['record_id', 'species_info', 'ai_content', 'related_products', 'related_wiki', 'species_profile', 'confidence_level', 'from_cache'].sort().join(',')

async function checkIdentify(src, t) {
  process.env.DASHSCOPE_API_KEY = 'test-key'
  const logsOf = (calls) => calls.filter((c) => c.coll === LOGS && c.op === 'add').map((c) => c.data)

  // A1 失败路径（读图失败）
  {
    const { db, calls } = makeDb()
    const fn = loadIdentify(src, makeCloud(db))
    const res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/missing.jpg', entry_source: 'gallery_search' }), 1500)
    t.ok('A1 失败出参不变', JSON.stringify(res) === JSON.stringify({ success: false, msg: '无法读取云存储图片' }), JSON.stringify(res))
    const logs = logsOf(calls)
    t.ok('A1 失败也落一条日志', logs.length === 1, `实际 ${logs.length}`)
    const l = logs[0] || {}
    t.ok('A1 日志字段', l.status === 'failed' && l.success === false && l.error_msg === '无法读取云存储图片' && l.openid === USER_OPENID && /missing\.jpg$/.test(l.image_file_id) && l.entry_source === 'gallery_search' && typeof l.duration_ms === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(l.day) && l.source === 'live', JSON.stringify(l))
  }

  // A2 成功（mock 识别）
  {
    const { db, calls } = makeDb({ resolveGet: () => [] })
    const fn = loadIdentify(src, makeCloud(db))
    const res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/a.jpg', use_mock: true, entry_source: 'store_qr', category_hint: '昆虫' }), 1500)
    t.ok('A2 成功', res && res.success === true, JSON.stringify(res))
    t.ok('A2 出参字段集未被加料', res && res.data && Object.keys(res.data).sort().join(',') === SUCCESS_KEYS, res && res.data && Object.keys(res.data).join(','))
    const recAdds = calls.filter((c) => c.coll === 'identification_records' && c.op === 'add').length
    t.ok('A2 原记录照常新建一次', recAdds === 1, `实际 ${recAdds}`)
    const l = logsOf(calls)[0] || {}
    t.ok('A2 日志：成功 + 结论 + 全文', l.status === 'success' && l.success && l.species_name_zh === '大蓝闪蝶' && l.species_info && l.ai_content && l.record_id === 'identification_records_new' && l.model === 'mock' && l.category_hint === '昆虫', JSON.stringify({ ...l, species_info: !!l.species_info, ai_content: !!l.ai_content }))
    t.ok('A2 日志写在原记录之后（不阻塞识别）', calls.findIndex((c) => c.coll === LOGS) > calls.findIndex((c) => c.coll === 'identification_records' && c.op === 'add'))
  }

  // A3 同物种复用
  {
    const prev = { _id: 'rec_prev', species_info: { species_name_zh: '大蓝闪蝶', confidence: 0.9 }, ai_content: { content: 'x' }, related_products_snapshot: [{ _id: 'p1', title: '蓝闪蝶框', price: 188, cover: 'cloud://c' }], confidence_level: 'high' }
    const { db, calls } = makeDb({ resolveGet: (name, where) => (name === 'identification_records' && where && where.species_dedup_key ? [prev] : []) })
    const fn = loadIdentify(src, makeCloud(db))
    const res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/b.jpg', use_mock: true }), 1500)
    t.ok('A3 复用出参', res && res.success && res.data.from_cache === true && res.data.reuse_reason === 'same_species', JSON.stringify(res && res.data && { from_cache: res.data.from_cache, reuse_reason: res.data.reuse_reason }))
    const l = logsOf(calls)[0] || {}
    t.ok('A3 日志：复用 + 本次照片 + 匹配商品', l.status === 'reused' && l.reuse_reason === 'same_species' && /b\.jpg$/.test(l.image_file_id) && l.record_id === 'rec_prev' && l.related_products.length === 1 && l.related_products[0].title === '蓝闪蝶框', JSON.stringify(l))
  }

  // A4 日志写入抛错 → 出参逐字不变
  {
    const { db } = makeDb({ addBehavior: (n) => (n === LOGS ? 'throw' : 'ok') })
    const fn = loadIdentify(src, makeCloud(db))
    let res
    let err = null
    try { res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/missing.jpg' }), 1500) } catch (e) { err = e }
    t.ok('A4 日志写失败不抛错', !err, err && err.message)
    t.ok('A4 日志写失败出参不变', JSON.stringify(res) === JSON.stringify({ success: false, msg: '无法读取云存储图片' }), JSON.stringify(res))
    const { db: db2 } = makeDb({ addBehavior: (n) => (n === LOGS ? 'throw' : 'ok') })
    const fn2 = loadIdentify(src, makeCloud(db2))
    let res2
    let err2 = null
    try { res2 = await withTimeout(fn2.main({ image_file_id: 'cloud://env.b/identify/a.jpg', use_mock: true }), 1500) } catch (e) { err2 = e }
    t.ok('A4 成功路径日志写失败仍返回识别结果', !err2 && res2 && res2.success === true && res2.data && res2.data.record_id === 'identification_records_new', err2 ? err2.message : JSON.stringify(res2 && res2.success))
  }

  // A5 日志写入挂起 → 按上限返回（用缩短上限的内存副本测行为，另断言真值在合理区间）
  {
    const m = /const LOG_WRITE_TIMEOUT_MS = (\d+)/.exec(src.identifyLog || '')
    const limit = m ? Number(m[1]) : NaN
    t.ok('A5 写日志上限 200–3000 毫秒', limit >= 200 && limit <= 3000, `当前 ${limit}`)
    const fast = { ...src, identifyLog: String(src.identifyLog).replace(/const LOG_WRITE_TIMEOUT_MS = \d+/, 'const LOG_WRITE_TIMEOUT_MS = 60') }
    const { db } = makeDb({ addBehavior: (n) => (n === LOGS ? 'hang' : 'ok') })
    const fn = loadIdentify(fast, makeCloud(db))
    const t0 = Date.now()
    const res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/missing.jpg' }), 800)
    t.ok('A5 日志挂起不拖住鉴定', res && !res.__timeout && Date.now() - t0 < 700, res && res.__timeout ? '超过 800ms 未返回' : `${Date.now() - t0}ms`)
    t.ok('A5 日志挂起出参不变', res && res.success === false && res.msg === '无法读取云存储图片', JSON.stringify(res))
  }

  // A6 非鉴定动作不写日志
  {
    const { db, calls } = makeDb()
    const fn = loadIdentify(src, makeCloud(db))
    await withTimeout(fn.main({ action: 'list_recent', limit: 3 }), 1500)
    await withTimeout(fn.main({ action: 'get_record', record_id: 'x' }), 1500)
    t.ok('A6 非鉴定动作零日志', logsOf(calls).length === 0, `实际 ${logsOf(calls).length}`)
  }

  // A7 原函数抛错 → 记失败并原样抛出
  {
    const { db, calls } = makeDb()
    const fn = loadIdentify(src, makeCloud(db, { ctxThrows: true }))
    let err = null
    try { await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/a.jpg' }), 1500) } catch (e) { err = e }
    t.ok('A7 原异常原样抛出', err && err.message === 'ctx boom', err ? err.message : '未抛出')
    const l = logsOf(calls)[0] || {}
    t.ok('A7 抛错也记失败', l.status === 'failed' && l.error_msg === 'ctx boom', JSON.stringify(l))
  }

  // A8 静态：模型名不写死、默认清单有备用且不含已下线模型；非鉴定动作清单
  // 起因：2026-10-10 百炼下线 qwen-vl-plus / qwen-turbo，代码写死模型名 → 线上全部「Model not exist.」
  {
    const modelsMod = compile(PATHS.aiModels, src.aiModels, () => undefined)
    const logMod = compile(PATHS.identifyLog, src.identifyLog, (id) => (id === './aiModels' ? modelsMod : undefined))
    const idx = String(src.identifyIndex)
    const literal = idx.match(/model:\s*['"`][^'"`]+['"`]/)
    t.ok('A8 index.js 不写死模型名（走 aiModels 清单）', !literal, literal && literal[0])
    const RETIRED = ['qwen-vl-plus', 'qwen-vl-max', 'qwen-turbo', 'qwen3-vl-flash', 'qvq-plus', 'qvq-max']
    for (const [label, list] of [['视觉', modelsMod.DEFAULT_VISION_MODELS], ['文本', modelsMod.DEFAULT_TEXT_MODELS]]) {
      const arr = Array.isArray(list) ? list : []
      t.ok(`A8 ${label}默认清单至少 2 个（互为备用）`, new Set(arr).size >= 2, JSON.stringify(arr))
      const dead = arr.filter((m) => RETIRED.includes(m))
      t.ok(`A8 ${label}默认清单不含已下线模型`, dead.length === 0, dead.join(','))
    }
    const chain = modelsMod.modelChain(' custom-a, ,qwen3.7-plus ', ['qwen3.6-flash', 'qwen3.7-plus'])
    t.ok('A8 环境变量排前、默认清单仍作备用且去重', JSON.stringify(chain) === JSON.stringify(['custom-a', 'qwen3.7-plus', 'qwen3.6-flash']), JSON.stringify(chain))
    t.ok('A8 Model not exist 判为模型不可用', modelsMod.isModelUnavailable(Object.assign(new Error('Model not exist.'), { statusCode: 404, code: 'InvalidParameter' })) && !modelsMod.isModelUnavailable(Object.assign(new Error('Invalid API-key provided.'), { statusCode: 401 })))
    const branchActions = [...idx.matchAll(/if \(action === '([a-z_]+)'\)/g)].map((x) => x[1]).sort().join(',')
    t.ok('A8 非鉴定动作清单 = index.js 分支', branchActions === [...logMod.NON_IDENTIFY_ACTIONS].sort().join(','), `index.js=${branchActions}`)
  }

  // A9 行为：首选模型下线 → 自动切到备用，鉴定成功，日志记实际模型；全部下线 → 失败并记原因
  {
    const modelsMod = compile(PATHS.aiModels, src.aiModels, () => undefined)
    const [v1, v2] = modelsMod.DEFAULT_VISION_MODELS || []
    const [t1, t2] = modelsMod.DEFAULT_TEXT_MODELS || []
    const gone = { status: 404, json: { code: 'InvalidParameter', message: 'Model not exist.' } }
    const { stub, seen } = makeHttpsStub((body, path) => {
      if (body.model === v1 || body.model === t1) return gone
      if (/multimodal/.test(path)) return { status: 200, json: { output: { choices: [{ message: { content: [{ text: VL_OK_TEXT }] } }] } } }
      return { status: 200, json: { output: { choices: [{ message: { content: SCI_OK_TEXT } }] } } }
    })
    const { db, calls } = makeDb()
    const fn = loadIdentify(src, makeCloud(db), stub)
    const res = await withTimeout(fn.main({ image_file_id: 'cloud://env.b/identify/a.jpg', entry_source: 'store_qr' }), 1500)
    t.ok('A9 首选下线自动切备用并成功', res && res.success === true && res.data && res.data.species_info && res.data.species_info.species_name_zh === '大蓝闪蝶' && res.data.ai_content && res.data.ai_content.content === '科普正文', JSON.stringify(res && (res.msg || res.success)))
    t.ok('A9 出参字段集不变', res && res.data && Object.keys(res.data).sort().join(',') === SUCCESS_KEYS, res && res.data && Object.keys(res.data).join(','))
    const vlSeen = seen.filter((s) => /multimodal/.test(s.path))
    t.ok('A9 模型不可用时不再用 base64 重试同一模型', vlSeen.filter((s) => s.model === v1).length === 1, JSON.stringify(vlSeen))
    const l = logsOf(calls)[0] || {}
    t.ok('A9 日志记实际成功的模型', l.model === v2 && l.text_model === t2, `model=${l.model} text_model=${l.text_model}`)

    const allGone = makeHttpsStub(() => gone)
    const { db: db2, calls: calls2 } = makeDb()
    const fn2 = loadIdentify(src, makeCloud(db2), allGone.stub)
    const origError = console.error
    console.error = () => {}
    const res2 = await withTimeout(fn2.main({ image_file_id: 'cloud://env.b/identify/a.jpg' }), 1500).finally(() => { console.error = origError })
    t.ok('A9 全部下线 → 失败并带原因', res2 && res2.success === false && res2.msg === 'Model not exist.', JSON.stringify(res2))
    const tried = [...new Set(allGone.seen.map((s) => s.model))]
    t.ok('A9 全部下线前每个视觉模型都试过', (modelsMod.DEFAULT_VISION_MODELS || []).every((m) => tried.includes(m)), tried.join(','))
    const l2 = logsOf(calls2)[0] || {}
    t.ok('A9 全部下线日志记失败', l2.status === 'failed' && l2.error_msg === 'Model not exist.', JSON.stringify({ status: l2.status, error_msg: l2.error_msg }))
  }
}

function loadMonitor(src, db, openid) {
  const cloud = makeCloud(db, { openid })
  return compile(PATHS.monitorIndex, src.monitorIndex, (id) => (id === 'wx-server-sdk' ? cloud : undefined))
}

async function checkMonitor(src, t) {
  const logRow = { _id: 'log1', openid: USER_OPENID, image_file_id: 'cloud://env.b/identify/a.jpg', status: 'success', success: true, species_name_zh: '大蓝闪蝶', created_at: Date.now(), related_products: [], record_id: 'rec1' }
  const resolveGet = (name, where) => {
    if (name === 'staff_members' && where && where.openid === MANAGER_OPENID) return [{ _id: 's1', openid: MANAGER_OPENID, status: 'active', role: 'manager', roles: ['manager'], storeIds: ['store_a'], name: '店长' }]
    if (name === LOGS) return [logRow]
    if (name === 'users') return [{ _openid: USER_OPENID, nickName: '藏家', phone: '13812345678' }]
    return []
  }
  const logReads = (calls) => calls.filter((c) => c.coll === LOGS && c.op !== 'add').length

  const denied = [
    ['未登录', ''],
    ['普通用户', USER_OPENID],
    ['店长', MANAGER_OPENID]
  ]
  for (const [who, openid] of denied) {
    for (const action of ['overview', 'list', 'detail']) {
      const { db, calls } = makeDb({ resolveGet })
      const fn = loadMonitor(src, db, openid)
      const res = await withTimeout(fn.main({ action, id: 'log1' }), 1500)
      t.ok(`B1 ${who} ${action} 被拒`, res && res.success === false, JSON.stringify(res))
      t.ok(`B1 ${who} ${action} 零读取`, logReads(calls) === 0, `读取 ${logReads(calls)} 次`)
    }
  }
  {
    process.env.ADMIN_OPS_KEY = 'ops-secret'
    const { db, calls } = makeDb({ resolveGet })
    const fn = loadMonitor(src, db, '')
    const res = await withTimeout(fn.main({ action: 'list', adminOpsKey: 'ops-secret' }), 1500)
    t.ok('B2 仅持运维口令（无小程序身份）被拒', res && res.success === false && logReads(calls) === 0, JSON.stringify(res))
    delete process.env.ADMIN_OPS_KEY
  }
  {
    const { db, calls } = makeDb({ resolveGet })
    const fn = loadMonitor(src, db, SUPER_OPENID)
    const res = await withTimeout(fn.main({ action: 'list', status: 'success', dateFrom: '2026-09-01', dateTo: '2026-09-29' }), 1500)
    t.ok('B3 超管 list 放行', res && res.success === true && res.data && res.data.list.length === 1, JSON.stringify(res))
    const row = (res && res.data && res.data.list[0]) || {}
    t.ok('B3 列表返回临时链接与脱敏手机号、不回传 fileID', /^https:\/\//.test(row.imageUrl || '') && row.user && row.user.phone === '138****5678' && !('image_file_id' in row), JSON.stringify(row))
    const auditIdx = calls.findIndex((c) => c.coll === 'admin_operation_logs' && c.op === 'add')
    const readIdx = calls.findIndex((c) => c.coll === LOGS && c.op !== 'add')
    t.ok('B3 list 先审计后读取', auditIdx !== -1 && auditIdx < readIdx, `audit=${auditIdx} read=${readIdx}`)
    const audit = (calls[auditIdx] || {}).data || {}
    t.ok('B3 审计字段', audit.module === 'privacy' && audit.action === 'view_identify_logs' && audit.operatorOpenid === SUPER_OPENID, JSON.stringify(audit))
  }
  {
    const { db, calls } = makeDb({ resolveGet })
    const fn = loadMonitor(src, db, SUPER_OPENID)
    const res = await withTimeout(fn.main({ action: 'detail', id: 'log1' }), 1500)
    t.ok('B4 超管 detail 放行且有原图临时链接', res && res.success === true && /^https:\/\//.test(res.data.imageUrl || ''), JSON.stringify(res))
    t.ok('B4 detail 不回传 fileID', res && res.data && !('image_file_id' in res.data), Object.keys((res && res.data) || {}).join(','))
    const auditIdx = calls.findIndex((c) => c.coll === 'admin_operation_logs' && c.op === 'add')
    const readIdx = calls.findIndex((c) => c.coll === LOGS && c.op !== 'add')
    t.ok('B4 detail 先审计后读取', auditIdx !== -1 && auditIdx < readIdx, `audit=${auditIdx} read=${readIdx}`)
  }
  for (const action of ['list', 'detail']) {
    const { db, calls } = makeDb({ resolveGet, addBehavior: (n) => (n === 'admin_operation_logs' ? 'throw' : 'ok') })
    const fn = loadMonitor(src, db, SUPER_OPENID)
    const res = await withTimeout(fn.main({ action, id: 'log1' }), 1500)
    t.ok(`B5 审计失败 ${action} 即拒`, res && res.success === false && res.code === 'AUDIT_FAILED', JSON.stringify(res))
    t.ok(`B5 审计失败 ${action} 零读取`, logReads(calls) === 0, `读取 ${logReads(calls)} 次`)
  }
  {
    const { db } = makeDb({ resolveGet })
    const fn = loadMonitor(src, db, SUPER_OPENID)
    const res = await withTimeout(fn.main({ action: 'overview' }), 1500)
    t.ok('B6 超管 overview 放行', res && res.success === true && typeof res.data.todayTotal === 'number' && 'weekSuccessRate' in res.data, JSON.stringify(res))
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|mjs|ts|vue|wxml)$/.test(name)) out.push(p)
  }
  return out
}

function checkStatic(src, t) {
  let rules = null
  try { rules = JSON.parse(src.rules) } catch (e) { rules = null }
  t.ok('C1 规则 read=false', rules && rules.read === false, src.rules)
  t.ok('C1 规则写字段全 false', rules && 'write' in rules && ['write', 'create', 'update', 'delete'].every((k) => !(k in rules) || rules[k] === false), src.rules)
  let sens = null
  try { sens = JSON.parse(src.sensitive) } catch (e) { sens = null }
  t.ok('C2 敏感清单 serverOnly 登记', sens && Array.isArray(sens.serverOnly) && sens.serverOnly.includes(LOGS))
  t.ok('C3 COLLECTIONS 登记', /AI_IDENTIFY_LOGS:\s*'ai_identify_logs'/.test(src.cloudJs || ''))
  t.ok('C3 schema 文档存在', !!src.schema)
  t.ok('C3 cloudbaserc 登记 aiIdentifyMonitor', /"name":\s*"aiIdentifyMonitor"/.test(src.cloudbaserc || ''))

  const clientFiles = [
    ...walk(MP).filter((p) => !p.includes(`${join(MP, 'cloudfunctions')}`) && !p.includes(join(MP, 'scripts')) && !p.includes(join(MP, 'docs'))),
    ...walk(join(ROOT, 'admin/src'))
  ]
  const offenders = []
  for (const p of clientFiles) {
    const rel = relative(ROOT, p)
    const text = p === PATHS.pageJs ? src.pageJs : readFileSync(p, 'utf8')
    if (rel === 'admin/src/cloud.js') {
      if (/collection\([^)]*AI_IDENTIFY_LOGS/.test(text)) offenders.push(rel)
      continue
    }
    if (text.includes(LOGS) || /COLLECTIONS\.AI_IDENTIFY_LOGS/.test(text)) offenders.push(rel)
  }
  t.ok('C4 小程序 / ERP 不直读日志集合', offenders.length === 0, offenders.join(', '))
}

function checkPage(src, t) {
  let app = null
  try { app = JSON.parse(src.appJson) } catch (e) { app = null }
  const pkgs = (app && (app.subPackages || app.subpackages)) || []
  const mgr = pkgs.find((p) => p.root === 'subpackages/manager')
  t.ok('D1 页面登记在超管分包', !!(mgr && mgr.pages.includes('identify-monitor/index')))
  t.ok('D1 不进主包', !!app && !(app.pages || []).some((p) => /identify-monitor/.test(p)))
  const js = String(src.pageJs || '')
  const fns = [...js.matchAll(/callFunction\(\{\s*name:\s*['"]?([A-Za-z_]+)['"]?/g)].map((x) => x[1])
  t.ok('D2 只调 aiIdentifyMonitor', /const FN = 'aiIdentifyMonitor'/.test(js) && fns.length > 0 && fns.every((f) => f === 'FN'), fns.join(','))
  t.ok('D2 页面不直连数据库', !/\.database\(|\.collection\(/.test(js))
  t.ok('D2 页内超管门禁', /guardStaffPage\('super_admin'\)/.test(js))
  t.ok('D3 无原生弹窗', !/wx\.(showModal|showToast|showActionSheet)\s*\(/.test(js))
  const visible = String(src.pageWxml || '').replace(/<[^>]*>/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ')
  const tech = visible.match(/ai_identify_logs|identification_\w+|openid|record_id|fileID|file_id|collection|_id\b|undefined|null/gi)
  t.ok('D3 可见文案无集合名 / 字段名', !tech, tech && tech.join(','))

  const roleMod = compile(PATHS.roles, src.roles, () => undefined)
  const key = roleMod.MENU_KEYS && roleMod.MENU_KEYS.AI_IDENTIFY_MONITOR
  t.ok('D4 菜单键存在', key === 'aiIdentifyMonitor', String(key))
  const roles = ['super_admin', 'store_manager', 'store_staff', 'specimen_artisan', 'live_host', 'investor', 'shareholder']
  const seen = roles.filter((r) => roleMod.canSeeMenu(r, key))
  t.ok('D4 只有超管可见', seen.length === 1 && seen[0] === 'super_admin', seen.join(','))
  t.ok('D4 Hub 分区含该入口', roleMod.HUB_MENU_SECTIONS && Object.values(roleMod.HUB_MENU_SECTIONS).some((arr) => arr.includes(key)))
  t.ok('D5 磁贴判同一菜单键', /wx:if="\{\{menu\.aiIdentifyMonitor\}\}" bindtap="goIdentifyMonitorGuarded"/.test(src.hubWxml || ''))
  const go = /goIdentifyMonitorGuarded\(\) \{([\s\S]*?)\n {2}\},/.exec(src.mpc || '')
  t.ok('D5 跳转前再判菜单键', !!go && /canSeeMenu\(this\.data\.workspaceRole, MENU_KEYS\.AI_IDENTIFY_MONITOR\)\) return/.test(go[1]) && /identify-monitor\/index/.test(go[1]))
}

/* ── E. 保留期清理：内存库（只实现清理函数用到的 lt / gte / in、升序、limit、按 _id 批删） ── */
const RC = {
  lt: (v) => ({ op: 'lt', v }),
  gte: (v) => ({ op: 'gte', v }),
  in: (v) => ({ op: 'in', v })
}
function matchCond(val, cond) {
  if (cond && typeof cond === 'object' && cond.op) {
    if (cond.op === 'lt') return val < cond.v
    if (cond.op === 'gte') return val >= cond.v
    if (cond.op === 'in') return cond.v.includes(val)
  }
  return val === cond
}
function makeRetentionEnv({ logs, records, source = '', failFiles = [], goneFiles = [] }) {
  const store = { [LOGS]: logs.map((r) => ({ ...r })), identification_records: records.map((r) => ({ ...r })) }
  const events = []
  const filter = (name, where) => store[name].filter((row) => Object.entries(where || {}).every(([k, c]) => matchCond(row[k], c)))
  const db = {
    command: RC,
    collection(name) {
      const st = { where: null, limit: 100, asc: false }
      const api = {
        where(w) { st.where = w; return api },
        orderBy(f, dir) { st.asc = dir === 'asc'; return api },
        limit(n) { st.limit = n; return api },
        field() { return api },
        async get() {
          let rows = filter(name, st.where)
          if (st.asc) rows = [...rows].sort((a, b) => a.created_at - b.created_at)
          events.push({ op: 'get', coll: name, limit: st.limit, expiredScan: !!(st.where && st.where.created_at && st.where.created_at.op === 'lt') })
          return { data: rows.slice(0, Math.min(st.limit, 100)).map((r) => ({ ...r })) }
        },
        async remove() {
          const hit = filter(name, st.where)
          store[name] = store[name].filter((r) => !hit.includes(r))
          events.push({ op: 'remove', coll: name, ids: hit.map((r) => r._id) })
          return { stats: { removed: hit.length } }
        }
      }
      return api
    }
  }
  const cloud = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'test',
    database: () => db,
    getWXContext: () => ({ SOURCE: source }),
    async deleteFile({ fileList }) {
      events.push({ op: 'deleteFile', files: [...fileList] })
      return {
        fileList: fileList.map((fileID) => {
          if (failFiles.includes(fileID)) return { fileID, status: -1, errMsg: 'permission denied' }
          if (goneFiles.includes(fileID)) return { fileID, status: -1, errMsg: 'STORAGE_FILE_NONEXIST' }
          return { fileID, status: 0, errMsg: 'ok' }
        })
      }
    }
  }
  return { db, cloud, store, events }
}
function loadRetention(src, cloud) {
  const origin = compile(PATHS.sourceOrigin, src.sourceOrigin, (id) => (id === 'wx-server-sdk' ? cloud : undefined))
  return compile(PATHS.retentionIndex, src.retentionIndex, (id) => {
    if (id === 'wx-server-sdk') return cloud
    if (id === './sourceOrigin') return origin
    return undefined
  })
}

async function checkRetention(src, t) {
  const log = console.log
  console.log = () => {}
  try { await runRetention(src, t) } finally { console.log = log }
}

async function runRetention(src, t) {
  const DAY = 24 * 3600 * 1000
  const HOUR = 3600 * 1000
  const now = Date.now()
  const F = (name) => `cloud://env.b/identify/${name}`
  const PRODUCT = 'cloud://env.b/products/p.jpg'
  const TRAVERSE = 'cloud://env.b/identify/../avatars/x.jpg'
  const logs = [
    { _id: 'orphan', created_at: now - 200 * DAY, image_file_id: F('a.jpg') },
    { _id: 'userRec', created_at: now - 190 * DAY, image_file_id: F('b.jpg') },
    { _id: 'product', created_at: now - 185 * DAY, image_file_id: PRODUCT },
    { _id: 'traverse', created_at: now - 184 * DAY, image_file_id: TRAVERSE },
    { _id: 'delFail', created_at: now - 181 * DAY, image_file_id: F('fail.jpg') },
    { _id: 'gone', created_at: now - 182 * DAY, image_file_id: F('gone.jpg') },
    { _id: 'sharedOld', created_at: now - 186 * DAY, image_file_id: F('d.jpg') },
    { _id: 'sharedNew', created_at: now - 10 * DAY, image_file_id: F('d.jpg') },
    { _id: 'justOver', created_at: now - 180 * DAY - HOUR, image_file_id: F('e.jpg') },
    { _id: 'justUnder', created_at: now - 180 * DAY + HOUR, image_file_id: F('f.jpg') },
    { _id: 'fresh', created_at: now - 3 * DAY, image_file_id: F('c.jpg') }
  ]
  const records = [{ _id: 'r1', image_url: F('b.jpg') }]
  const opts = { logs, records, failFiles: [F('fail.jpg')], goneFiles: [F('gone.jpg')] }

  for (const [label, ev, source] of [
    ['E1 客户端空调用被拒', {}, 'wx_client'],
    ['E1 客户端伪造定时事件被拒', { Type: 'Timer', TriggerName: 'aiIdentifyRetentionDaily' }, 'wx_client'],
    ['E1 非定时的服务端调用被拒', { action: 'purge' }, 'scf']
  ]) {
    const env = makeRetentionEnv({ ...opts, source })
    const res = await withTimeout(loadRetention(src, env.cloud).main(ev), 1500)
    t.ok(label, res && res.success === false && env.events.length === 0, JSON.stringify({ res, events: env.events.length }))
  }

  const env = makeRetentionEnv({ ...opts, source: '' })
  const res = await withTimeout(loadRetention(src, env.cloud).main({ Type: 'Timer', TriggerName: 'aiIdentifyRetentionDaily' }), 1500)
  t.ok('E2 定时触发放行', res && res.success === true && res.retentionDays === 180, JSON.stringify(res))
  const deleted = env.events.filter((e) => e.op === 'deleteFile').flatMap((e) => e.files)
  t.ok('E2 只删鉴定目录下的照片', deleted.length > 0 && deleted.every((f) => /^cloud:\/\/[^/]+\/identify\/[^/]+$/.test(f) && !f.includes('..')), deleted.join(','))
  t.ok('E2 商品图 / 越界路径一个不删', !deleted.includes(PRODUCT) && !deleted.includes(TRAVERSE))
  t.ok('E3 用户自己的鉴定记录仍在用的照片保留', !deleted.includes(F('b.jpg')), deleted.join(','))
  t.ok('E3 180 天内日志仍引用的照片保留', !deleted.includes(F('d.jpg')), deleted.join(','))
  t.ok('E3 无人引用的过期照片删除', deleted.includes(F('a.jpg')) && deleted.includes(F('e.jpg')), deleted.join(','))
  const left = env.store[LOGS].map((r) => r._id).sort().join(',')
  t.ok('E4 阈值 180 天（刚过删、未到留）', !left.includes('justOver') && left.includes('justUnder'), left)
  t.ok('E4 过期记录删除、文件删失败的记录留待重试', left === ['delFail', 'fresh', 'justUnder', 'sharedNew'].sort().join(','), left)
  const firstDel = env.events.findIndex((e) => e.op === 'deleteFile')
  const firstRemove = env.events.findIndex((e) => e.op === 'remove')
  t.ok('E5 先删文件后删记录', firstDel !== -1 && firstRemove !== -1 && firstDel < firstRemove, `deleteFile=${firstDel} remove=${firstRemove}`)
  t.ok('E5 文件已不存在视为已删（记录照删）', !left.includes('gone'), left)

  const many = Array.from({ length: 1200 }, (_, i) => ({ _id: `m${i}`, created_at: now - 200 * DAY - i, image_file_id: F(`m${i}.jpg`) }))
  const big = makeRetentionEnv({ logs: many, records: [], source: '' })
  const r2 = await withTimeout(loadRetention(src, big.cloud).main({ Type: 'Timer' }), 3000)
  const batches = big.events.filter((e) => e.op === 'deleteFile').map((e) => e.files.length)
  const removedTotal = big.events.filter((e) => e.op === 'remove').reduce((n, e) => n + e.ids.length, 0)
  const gets = big.events.filter((e) => e.op === 'get' && e.coll === LOGS && e.expiredScan).map((e) => e.limit)
  t.ok('E6 单批删文件 ≤ 50', batches.length > 0 && batches.every((n) => n <= 50), batches.join(','))
  t.ok('E6 单批取记录 ≤ 50', gets.length > 0 && gets.every((n) => n <= 50), gets.join(','))
  t.ok('E6 单次运行 ≤ 500 条', r2 && r2.success === true && removedTotal > 0 && removedTotal <= 500, `removed=${removedTotal}`)

  let cfg = null
  try { cfg = JSON.parse(src.retentionConfig) } catch (e) { cfg = null }
  const trig = cfg && (cfg.triggers || []).find((x) => x.type === 'timer')
  t.ok('E7 每日定时触发器', !!trig && /^0 \d+ \d+ \* \* \* \*$/.test(trig.config), trig && trig.config)
  t.ok('E7 cloudbaserc 登记 aiIdentifyRetention', /"name":\s*"aiIdentifyRetention"/.test(src.cloudbaserc || ''))
  t.ok('E8 页面告知保留 180 天', /记录保留 180 天/.test(src.pageWxml || ''))
}

async function runAll(src) {
  const t = makeAsserter()
  const guard = async (label, f) => {
    try { await f() } catch (e) { t.ok(`${label} 运行`, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)) }
  }
  await guard('A', () => checkIdentify(src, t))
  await guard('B', () => checkMonitor(src, t))
  await guard('C', () => checkStatic(src, t))
  await guard('D', () => checkPage(src, t))
  await guard('E', () => checkRetention(src, t))
  return t
}

const INJECTIONS = [
  ['旁路日志不再兜错（直接写库）', 'identifyIndex', (s) => s.replace('await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now(), trace })', "await db.collection('ai_identify_logs').add({ data: { openid } })")],
  ['写日志去掉超时上限', 'identifyLog', (s) => s.replace('await Promise.race([write, timeout])', 'await write')],
  ['旁路往出参里加料', 'identifyIndex', (s) => s.replace('  await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now(), trace })\n  return result', '  await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now(), trace })\n  if (result && result.data) result.data.logged = true\n  return result')],
  ['非鉴定动作也写日志', 'identifyIndex', (s) => s.replace('  if (!isIdentifyCall(event)) return identifyMain(event, context)\n', '')],
  ['原函数抛错被吞成成功', 'identifyIndex', (s) => s.replace('    await writeIdentifyLog(db, event, null, { openid, startedAt, finishedAt: Date.now(), error: err, trace })\n    throw err', '    await writeIdentifyLog(db, event, null, { openid, startedAt, finishedAt: Date.now(), error: err, trace })\n    return { success: false, msg: err.message }')],
  ['视觉模型名写死回代码', 'identifyIndex', (s) => s.replace('  const body = {\n    model,\n    input: {\n      messages: [\n        {\n          role: \'user\',', '  const body = {\n    model: \'qwen3.6-flash\',\n    input: {\n      messages: [\n        {\n          role: \'user\',')],
  ['视觉默认清单只剩一个（无备用）', 'aiModels', (s) => s.replace("const DEFAULT_VISION_MODELS = ['qwen3.6-flash', 'qwen3.7-plus']", "const DEFAULT_VISION_MODELS = ['qwen3.6-flash']")],
  ['文本默认清单退回已下线的 qwen-turbo', 'aiModels', (s) => s.replace("const DEFAULT_TEXT_MODELS = ['qwen-flash', 'qwen-plus']", "const DEFAULT_TEXT_MODELS = ['qwen-turbo', 'qwen-plus']")],
  ['模型不可用时不换下一个', 'identifyIndex', (s) => s.replace('if (isModelUnavailable(e1)) continue', 'if (isModelUnavailable(e1)) throw e1')],
  ['文本模型失败不换下一个', 'identifyIndex', (s) => s.replace("      console.warn(`文本模型[${model}] 调用失败`, e.message)\n", "      console.warn(`文本模型[${model}] 调用失败`, e.message)\n      throw e\n")],
  ['日志不记实际模型', 'identifyLog', (s) => s.replace('trace.visionModel || ', '')],
  ['监测去掉超管门禁（店长可读）', 'monitorIndex', (s) => s.replace('assertStaff(db, openid, { requireSuperAdmin: true })', 'assertStaff(db, openid, {})')],
  ['监测接受运维口令免登录', 'monitorIndex', (s) => s.replace("  if (!openid) return fail('UNAUTHORIZED', '请先登录')\n", '').replace('assertStaff(db, openid, { requireSuperAdmin: true })', 'assertStaff(db, openid, { requireSuperAdmin: true, adminOpsKey: event.adminOpsKey })')],
  ['审计不等结果就读数据', 'monitorIndex', (s) => s.replace("await audit(actor, 'view_identify_logs'", "audit(actor, 'view_identify_logs'")],
  ['详情跳过审计', 'monitorIndex', (s) => s.replace("    await audit(actor, 'view_identify_detail', { id })\n", '')],
  ['规则放开本人可读', 'rules', (s) => s.replace('"read": false', '"read": "doc.openid == auth.openid"')],
  ['敏感清单漏登记', 'sensitive', (s) => s.replace('"serverOnly": ["ai_identify_logs"]', '"serverOnly": []')],
  ['店长菜单加入该入口', 'roles', (s) => s.replace('const STORE_MANAGER_MENUS = [\n', 'const STORE_MANAGER_MENUS = [\n  MENU_KEYS.AI_IDENTIFY_MONITOR,\n')],
  ['页面新增原生弹窗', 'pageJs', (s) => s.replace('  closeDetail() {\n', "  closeDetail() {\n    wx.showModal({ title: '确认关闭' })\n")],
  ['页面直读日志集合', 'pageJs', (s) => s.replace('  noop() {},', "  noop() {},\n  peek() { return wx.cloud.database().collection('ai_identify_logs').get() },")],
  ['页面改调别的云函数', 'pageJs', (s) => s.replace('return wx.cloud.callFunction({ name: FN, data })', "return wx.cloud.callFunction({ name: 'secureDataRead', data })")],
  ['页面文案露出集合名', 'pageWxml', (s) => s.replace('<text class="ops-empty-title">这个范围内还没有鉴定</text>', '<text class="ops-empty-title">ai_identify_logs 为空</text>')],
  ['跳转不再判菜单键', 'mpc', (s) => s.replace('    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.AI_IDENTIFY_MONITOR)) return;\n', '')],
  ['保留期改成 90 天', 'retentionIndex', (s) => s.replace('const RETENTION_DAYS = 180', 'const RETENTION_DAYS = 90')],
  ['清理不再校验鉴定目录前缀', 'retentionIndex', (s) => s.replace('return IDENTIFY_FILE_RE.test(s) && s.indexOf(\'..\') === -1', "return /^cloud:\\/\\//.test(s)")],
  ['清理单批放大到 200', 'retentionIndex', (s) => s.replace('const BATCH_SIZE = 50', 'const BATCH_SIZE = 200')],
  ['清理去掉单次上限', 'retentionIndex', (s) => s.replace('while (sum.rows < MAX_PER_RUN)', 'while (true)')],
  ['清理不查引用（删用户仍在看的图）', 'retentionIndex', (s) => s.replace('const toDelete = candidates.filter((f) => !kept.has(f))', 'const toDelete = candidates')],
  ['文件删失败也删记录（留孤儿文件）', 'retentionIndex', (s) => s.replace('const ids = rows.filter((r) => !failed.has(r.image_file_id)).map((r) => r._id)', 'const ids = rows.map((r) => r._id)')],
  ['清理接受客户端伪造定时事件', 'retentionIndex', (s) => s.replace('if (!(isTimerEvent(event) && isNonClientSource()))', 'if (!isTimerEvent(event))')],
  ['页面去掉保留期告知', 'pageWxml', (s) => s.split('记录保留 180 天').join('记录会保留')]
]

async function main() {
  console.warn = () => {}
  const src = loadSources()
  const missing = Object.entries(src).filter(([, v]) => v == null).map(([k]) => relative(ROOT, PATHS[k]))
  if (missing.length) {
    console.error(`✗ test:ai-identify-monitor：缺文件 ${missing.join(', ')}`)
    process.exit(1)
  }
  if (process.argv.includes('--selftest')) {
    process.on('unhandledRejection', () => {})
    const base = await runAll(src)
    if (base.failures.length) {
      console.error('✗ 自检前提失败：当前源码本身不通过')
      base.failures.forEach((f) => console.error('  - ' + f))
      process.exit(1)
    }
    let ok = true
    for (const [name, key, mutate] of INJECTIONS) {
      const mutated = mutate(src[key])
      if (mutated === src[key]) {
        console.log(`✗ 自检注入「${name}」锚点失效（未命中源码）`)
        ok = false
        continue
      }
      const r = await runAll({ ...src, [key]: mutated })
      const caught = r.failures.length > 0
      console.log(`${caught ? '✓' : '✗'} 自检注入「${name}」${caught ? `已检出（${r.failures[0]}）` : '未检出'}`)
      if (!caught) ok = false
    }
    process.exitCode = ok ? 0 : 1
    process.exit()
  }
  const t = await runAll(src)
  if (t.failures.length) {
    console.error(`✗ test:ai-identify-monitor：${t.failures.length} 项失败（通过 ${t.pass}）`)
    t.failures.forEach((f) => console.error('  - ' + f))
    process.exitCode = 1
    process.exit()
  }
  console.log(`✓ test:ai-identify-monitor：${t.pass} 条断言通过（旁路日志三态 + 失败/挂起不影响鉴定、超管门禁 + 审计先行、规则全拒、页面与入口、180 天保留期清理）`)
  process.exit()
}

main()
