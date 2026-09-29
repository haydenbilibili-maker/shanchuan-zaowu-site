#!/usr/bin/env node
/**
 * test:ai-identify-monitor —— 超管「AI 鉴定监测」（蓝图 miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md）
 *
 * 真跑云函数真源（内存 mock wx-server-sdk，不联网、不写盘）：
 *   A. identifySpecimen 旁路日志：失败 / 成功 / 同物种复用三态落日志；日志写入抛错或挂起时出参逐字不变、
 *      按上限返回；非鉴定动作不写日志；原函数抛错时照样记失败并原样抛出；出参字段集不被加料；
 *      模型名 / 非鉴定动作清单与 index.js 一致
 *   B. aiIdentifyMonitor：未登录 / 普通用户 / 店长 / 仅持运维口令 一律被拒且零读取日志集合；
 *      超管放行；list / detail 先写审计再读，审计失败即拒且零读取
 *   C. 规则与登记：规则 read/write 全 false、敏感清单 serverOnly、COLLECTIONS、schema、云函数登记；
 *      小程序 / ERP 源码不得直读该集合
 *   D. 页面与入口：在超管分包、只调 aiIdentifyMonitor、无原生弹窗、可见文案无集合名 / 字段名；
 *      菜单键只有超管可见，Hub 磁贴与跳转判同一菜单键
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
  hubWxml: join(MP, 'subpackages/manager/manager/index.wxml')
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

function loadIdentify(src, cloud) {
  const logMod = compile(PATHS.identifyLog, src.identifyLog, () => undefined)
  return compile(PATHS.identifyIndex, src.identifyIndex, (id) => {
    if (id === 'wx-server-sdk') return cloud
    if (id === './contentSecurity') return CS_STUB
    if (id === './speciesProfile') return PROFILE_STUB
    if (id === './identifyLog') return logMod
    return undefined
  })
}

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

  // A8 静态一致：模型名、非鉴定动作清单
  {
    const logMod = compile(PATHS.identifyLog, src.identifyLog, () => undefined)
    const idx = String(src.identifyIndex)
    t.ok('A8 视觉模型名与调用处一致', new RegExp(`model: '${logMod.VISION_MODEL}'`).test(idx), logMod.VISION_MODEL)
    t.ok('A8 文本模型名与调用处一致', new RegExp(`model: '${logMod.TEXT_MODEL}'`).test(idx), logMod.TEXT_MODEL)
    const branchActions = [...idx.matchAll(/if \(action === '([a-z_]+)'\)/g)].map((x) => x[1]).sort().join(',')
    t.ok('A8 非鉴定动作清单 = index.js 分支', branchActions === [...logMod.NON_IDENTIFY_ACTIONS].sort().join(','), `index.js=${branchActions}`)
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

async function runAll(src) {
  const t = makeAsserter()
  const guard = async (label, f) => {
    try { await f() } catch (e) { t.ok(`${label} 运行`, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)) }
  }
  await guard('A', () => checkIdentify(src, t))
  await guard('B', () => checkMonitor(src, t))
  await guard('C', () => checkStatic(src, t))
  await guard('D', () => checkPage(src, t))
  return t
}

const INJECTIONS = [
  ['旁路日志不再兜错（直接写库）', 'identifyIndex', (s) => s.replace('await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now() })', "await db.collection('ai_identify_logs').add({ data: { openid } })")],
  ['写日志去掉超时上限', 'identifyLog', (s) => s.replace('await Promise.race([write, timeout])', 'await write')],
  ['旁路往出参里加料', 'identifyIndex', (s) => s.replace('  await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now() })\n  return result', '  await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now() })\n  if (result && result.data) result.data.logged = true\n  return result')],
  ['非鉴定动作也写日志', 'identifyIndex', (s) => s.replace('  if (!isIdentifyCall(event)) return identifyMain(event, context)\n', '')],
  ['原函数抛错被吞成成功', 'identifyIndex', (s) => s.replace('    await writeIdentifyLog(db, event, null, { openid, startedAt, finishedAt: Date.now(), error: err })\n    throw err', '    await writeIdentifyLog(db, event, null, { openid, startedAt, finishedAt: Date.now(), error: err })\n    return { success: false, msg: err.message }')],
  ['日志模型名与调用处漂移', 'identifyLog', (s) => s.replace("const VISION_MODEL = 'qwen-vl-plus'", "const VISION_MODEL = 'qwen-vl-max'")],
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
  ['跳转不再判菜单键', 'mpc', (s) => s.replace('    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.AI_IDENTIFY_MONITOR)) return;\n', '')]
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
  console.log(`✓ test:ai-identify-monitor：${t.pass} 条断言通过（旁路日志三态 + 失败/挂起不影响鉴定、超管门禁 + 审计先行、规则全拒、页面与入口）`)
  process.exit()
}

main()
