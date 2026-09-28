#!/usr/bin/env node
/**
 * 每日日报守卫（check:daily-digest）
 *
 * 产品口径：「报表新增每日日报模块，汇总报告每日小程序的数据、订单数据、门店营收数据等信息，
 * 并通过工作消息发送给超管；先实现超管日报，后续再拓展」＋「工作日报在工作信息顶部单独分类，
 * 与待办、审批并列」。
 *
 * 本守卫钉住的**可证伪**不变量（每条都配 --selftest 注入）：
 *   D1 **口径必须登记**：`reportCatalog.METRICS` 每一项都要有 `sources[]`，且每条 source 的
 *      `collection`/`timeField`/`filter`/`tz` 齐全 —— 口径没登记，数字就没人能对账。
 *   D2 **目录 ↔ 取数一致**：`dailyDigestCollect.js` 里真正查的集合，必须都在目录 `sources[]` 里登记过；
 *      反之目录登记的集合也必须在取数里真的被查（防「目录写了却没人查」的假口径）。
 *   D3 **单位同名不同单位**（错题本 E18/E21）：`*_fen` 必须 unit='fen'、`*_yuan` 必须 unit='yuan'；
 *      且展示层 `formatDigestValue` 对 fen 必须 ÷100 —— 这是「汇总正好翻倍」那一族错的堵口。
 *   D4 **时区语义必须写明**：`analytics_daily.dateKey` 是 UTC 日（实测），目录里必须显式声明，
 *      不许含糊成「当日」。
 *   D5 **字段名必须是实测的那个**：订单发货时间用 `logistics.shipTime`（嵌套），
 *      绝不能用顶层 `shipTime`（现代码不写，是遗留字段）。
 *   D6 **进工作信息队列**：写消息时 queue/audience/category/type 四者必须齐备，
 *      且 `daily_digest` 必须在读侧 `getUserMessages` 的归一化里被放行 payload。
 *   D7 **单独一档**：工作信息分档必须含 `digest`，且 messageHelper 的 CATEGORY_META/TYPE_META
 *      与云函数的 category/type 常量三处一致。
 *   D8 **可回看**：必须有保留策略（保留天数常量 + 清理函数），且幂等键按「日期 + 角色 + 收件人」
 *      确定（不是 24h 窗口）—— 否则同一天重复触发会发两封。
 *   D9 **入口**：日报必须是「工作信息」里的一个**分类档**，且**不许**再在工作台另开入口
 *      （2026-09-21 产品负责人：「把日报放在工作信息中，没有必要单独提供一个入口 banner」——
 *       原判据要求"必须有独立瓦片"，那**正是被否掉的做法**，已反向）。
 *   D10 **取数 API 与失败分档**：不许用 wx-server-sdk 没有的 `.append()`；`failed`（取数失败，
 *      带原因）与 `missing`（当日确实无数据）必须分两档。
 *   D11 **失败档必须覆盖每一个 collector**（**行为级**，不是正则匹配 `failed` 出现过）：
 *      给数据库打一个必定抛错的桩，真跑 analytics / orderDay / dateKeyed / simpleDay 四类取数，
 *      断言各自负责的**每一个**指标都进 `failed`。旧判据只匹配 `failed` 字面出现，于是
 *      「19 个指标里只有 7 个有失败档」照样全绿（错题本 E7）。
 *
 * 真实数据侧：`--live` 会用 `admin/.env.local` 的 ADMIN_OPS_KEY 调**已部署的** dailyDigest
 *   做一次只读 dryRun，把每个指标的值与来源打出来（人工/脚本核对）。
 *   **不带 `--live` 时本守卫完全离线**；`--live` 只是加验，不改变退出码语义（见 §live 注释）。
 *
 * 用法：
 *   node admin/scripts/check-daily-digest.mjs
 *   node admin/scripts/check-daily-digest.mjs --selftest
 *   node admin/scripts/check-daily-digest.mjs --live [--day YYYY-MM-DD]
 */
'use strict'

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 云函数与小程序的这些模块是 **CommonJS**（云函数没有 package.json type=module），
 * 而本守卫在 ESM 里跑、且仓根 package.json 是 "type":"module" ——
 * 直接 `import()` 一个 `.js` 会被当成 ESM 从而报 `module is not defined`。
 * 所以统一用 createRequire 按 CJS 加载（并且能带缓存失效，见 loadModules 的 bust）。
 */
const requireCjs = createRequire(import.meta.url)

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const CF = join(ROOT, 'miniprogram/cloudfunctions/dailyDigest')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)

const F = {
  catalog: join(CF, 'reportCatalog.js'),
  core: join(CF, 'dailyDigestCore.js'),
  collect: join(CF, 'dailyDigestCollect.js'),
  store: join(CF, 'dailyDigestStore.js'),
  entry: join(CF, 'index.js'),
  config: join(CF, 'config.json'),
  getMessages: join(ROOT, 'miniprogram/cloudfunctions/getUserMessages/index.js'),
  helper: join(ROOT, 'miniprogram/utils/messageHelper.js'),
  digestView: join(ROOT, 'miniprogram/subpackages/extra/utils/digestView.js'),
  msgIndex: join(ROOT, 'miniprogram/subpackages/extra/user/messages/index.js'),
  userPage: join(ROOT, 'miniprogram/pages/user/index.js'),
  userWxml: join(ROOT, 'miniprogram/pages/user/index.wxml'),
  detailWxml: join(ROOT, 'miniprogram/subpackages/extra/user/messages/detail/index.wxml')
}

function read (p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

const problems = []
const notes = []
function fail (msg) { problems.push(msg) }

// ─────────────────────────── 静态判据 ───────────────────────────

/**
 * 采集「取数实现里真正查了哪些集合」。
 *
 * 两种形态都要认（第一版只认字面量，于是把 `db.collection(col)` 这种
 * 「按目录动态取集合名」的实现误判成「目录登记了但没人查」→ 3 条假失败）：
 *   ① 字面量  `db.collection('orders')`
 *   ② 变量    `db.collection(col)` —— 集合名的真源仍在 reportCatalog 的 sources[]
 * 判据不能靠"文本里出现过"（错题本 E7），所以这里同时把
 * `metric.sources[0].collection` 这种取值点也算作"会查到的集合"。
 */
export function collectQueriedCollections (src) {
  const out = new Set()
  let literalCount = 0
  let variableCount = 0
  for (const m of src.matchAll(/db\.collection\(\s*(?:['"]([a-z0-9_]+)['"]|[A-Za-z_$][\w$]*)\s*\)/g)) {
    if (m[1]) { out.add(m[1]); literalCount += 1 } else { variableCount += 1 }
  }
  // 变量形态（`db.collection(col)`）必须是**从目录的 sources[0].collection 取值**，
  // 否则就是「集合名另有来源」——那种情况必须显式登记，不许悄悄绕过。
  if (variableCount > 0) {
    const readsSourcesCollection = /\.sources\[0\]\s*&&\s*[A-Za-z_$][\w$]*\.sources\[0\]\.collection/.test(src)
      || /\.sources\[0\]\.collection/.test(src)
    if (readsSourcesCollection) out.add('__DYNAMIC_FROM_SOURCES__')
  }
  out.__literalCount = literalCount
  return out
}

/** 校验目录结构（D1/D3/D4） */
export function checkCatalog (catalog) {
  const errs = []
  if (!catalog || !Array.isArray(catalog.metrics) || !catalog.metrics.length) {
    errs.push('catalog.metrics 为空 —— 日报没有任何登记过的指标')
    return errs
  }
  const ids = new Set()
  for (const m of catalog.metrics) {
    if (!m.id) { errs.push('存在没有 id 的指标'); continue }
    if (ids.has(m.id)) errs.push(`指标 id 重复：${m.id}`)
    ids.add(m.id)
    if (!m.sources || !m.sources.length) {
      errs.push(`指标 ${m.id} 没有 sources[] —— 口径未登记，数字无法对账`)
      continue
    }
    m.sources.forEach((s, i) => {
      for (const k of ['collection', 'timeField', 'filter', 'tz']) {
        if (!s[k]) errs.push(`指标 ${m.id} 的第 ${i + 1} 条来源缺 ${k}`)
      }
    })
    // D3 单位与命名一致性
    if (/_fen$/.test(m.id) && m.unit !== 'fen') errs.push(`指标 ${m.id} 名字带 _fen，unit 却是 ${m.unit}`)
    if (/_yuan$/.test(m.id) && m.unit !== 'yuan') errs.push(`指标 ${m.id} 名字带 _yuan，unit 却是 ${m.unit}`)
    // D4 时区语义：analytics_daily 的来源必须写明 UTC
    if (m.sources.some((s) => s.collection === 'analytics_daily')) {
      const tzText = m.sources.map((s) => String(s.tz || '')).join(' ')
      if (!/UTC/.test(tzText)) {
        errs.push(`指标 ${m.id} 读 analytics_daily，但 tz 没写明 UTC 日（实测 dateKey 就是 UTC 日）`)
      }
    }
  }
  return errs
}

/** 校验目录 ↔ 取数实现一致（D2） */
export function checkCatalogMatchesCollector (catalog, collectSrc) {
  const errs = []
  const registered = new Set()
  for (const m of catalog.metrics || []) {
    for (const s of m.sources || []) if (s.collection) registered.add(s.collection)
  }
  const queried = collectQueriedCollections(collectSrc)
  // 方向一：实现里字面查的集合必须登记过
  for (const c of queried) {
    if (c === '__DYNAMIC_FROM_SOURCES__') continue
    if (!registered.has(c)) errs.push(`取数实现查了 ${c}，但口径目录里没有登记它`)
  }
  // 方向二：目录登记的每个集合都必须有**落地路径** ——
  //   要么实现里字面查了它，要么实现里确实存在「按目录 sources[0].collection 动态取集合」的调用
  //   （dailyDigestCollect 就是后者：collection 按指标登记动态取）。
  const dynamic = queried.has('__DYNAMIC_FROM_SOURCES__')
  for (const c of registered) {
    if (queried.has(c)) continue
    if (dynamic) continue
    errs.push(`口径目录登记了 ${c}，但取数实现里没有查它（假口径）`)
  }
  return errs
}

/** 校验写消息时的队列字段齐备（D6） */
export function checkQueueFields (storeSrc) {
  const errs = []
  const needed = [
    ['queue', /queue:\s*MESSAGE_QUEUE/],
    ['audience', /audience:\s*'workflow'/],
    ['category', /category:\s*MESSAGE_CATEGORY/],
    ['type', /type:\s*MESSAGE_TYPE/],
    ['dedupeKey', /dedupeKey:\s*key/]
  ]
  for (const [name, re] of needed) {
    if (!re.test(storeSrc)) errs.push(`写入层缺少 ${name} 字段（日报会掉进顾客信箱或无法去重）`)
  }
  return errs
}

/** 真实跑一遍格式化：fen 必须 ÷100（D3） */
export function runFormatChecks (mod) {
  const errs = []
  const cases = [
    [{ unit: 'fen', value: 12860 }, '¥128.60', '分必须除以 100'],
    [{ unit: 'yuan', value: 4567.9 }, '¥4567.90', '元原样两位小数'],
    [{ unit: 'count', value: 43 }, '43', '计数取整'],
    [{ unit: 'count', value: null }, '未取到', 'null 必须是「未取到」而不是 0']
  ]
  for (const [metric, want, why] of cases) {
    const got = mod.formatDigestValue(metric)
    if (got !== want) errs.push(`formatDigestValue(${JSON.stringify(metric)}) = ${got}，期望 ${want}（${why}）`)
  }
  return errs
}

/** 真实跑一遍聚合管道构造：$group 的 _id 必须被日期分桶占住（本轮真踩过的坑） */
export function runPipelineChecks (core) {
  const errs = []
  const p = core.orderDayPipeline('2026-09-20', 'paidTime', 'paymentBreakdown.totalFen')
  const group = p.find((s) => s.$group)
  if (!group) return ['orderDayPipeline 没有 $group 段']
  const idExpr = group.$group._id
  if (!idExpr || typeof idExpr !== 'object' || !idExpr.$dateToString) {
    // 注意短路：注入把 _id 变成 null 时，这里必须直接判定失败，
    // 不能继续读 .$dateToString（否则守卫自己抛异常 = 判据失效，错题本 E7）
    errs.push('orderDayPipeline 的 $group._id 不是 $dateToString —— 日期桶被覆盖，归日会永远匹配不上')
  } else if (idExpr.$dateToString.timezone !== 'Asia/Shanghai') {
    errs.push('orderDayPipeline 的归日时区不是 Asia/Shanghai（东八日）')
  }
  if (!group.$group.sum || group.$group.sum.$sum !== '$paymentBreakdown.totalFen') {
    errs.push('orderDayPipeline 没有按传入字段求和')
  }
  return errs
}

/** 真实跑一遍日报装配：构造行 → 结构（不连库） */
export function runBuildChecks (mod, catalog) {
  const errs = []
  const dayKey = '2026-09-20'
  const digest = mod.buildDigest({
    dayKey,
    role: 'super_admin',
    analytics: { page_view: { count: 1242, uv: new Array(43).fill('x') } },
    orderDays: { order_paid_fen: { found: true, count: 1, sum: 350 } },
    dateKeyedRows: { daily_revenues: [{ total: 4567.9 }, { total: 925 }], store_ledger: [{ pos: 4567.9 }, { pos: 925 }] },
    simpleDay: { studio_shipments: 0 }
  })
  if (digest.dayKey !== dayKey) errs.push(`buildDigest 没有回填 dayKey（得到 ${digest.dayKey}）`)
  const byId = {}
  digest.metrics.forEach((m) => { byId[m.id] = m })
  const expect = {
    mini_visitors: 43,
    mini_page_view: 1242,
    order_paid_fen: 350,
    store_revenue_yuan: 5492.9,
    store_ledger_pos_yuan: 5492.9,
    studio_shipments: 0
  }
  for (const [id, want] of Object.entries(expect)) {
    const got = byId[id] && byId[id].value
    if (got !== want) errs.push(`buildDigest 的 ${id} = ${got}，期望 ${want}`)
  }
  // 「当日无行」必须是 null（未取到），不能是 0
  const noRows = mod.buildDigest({ dayKey, role: 'super_admin', dateKeyedRows: { daily_revenues: [] } })
  const row = noRows.metrics.find((m) => m.id === 'store_revenue_yuan')
  if (!row) errs.push('buildDigest 缺 store_revenue_yuan')
  else if (row.value !== null) errs.push(`当日无账本行时 store_revenue_yuan = ${row.value}，应为 null（未取到，不许冒充 0）`)
  // 角色切片：扩展位不能被悄悄启用
  const enabled = (catalog.enabledRoles || [])
  if (enabled.length !== 1 || enabled[0] !== 'super_admin') {
    errs.push(`本次只应开放超管日报，enabledRoles = ${JSON.stringify(enabled)}`)
  }
  return errs
}

/**
 * 行为级判据（P1-3 的守卫那一半 / P1-4 的堵口）：
 *   **模拟每一个 collector 的查询失败，断言它负责的每一个指标都出现在 `failed` 里**
 *   （而不是被算进 `missing`，更不是既不 failed 也不 missing 地静默）。
 *
 * 为什么必须是行为级而不是正则（错题本 E7「守卫判据自身错误」）：
 *   旧判据只是在 core 源码里正则匹配 `failed` 这个词出现过 —— 于是
 *   「19 个指标里只有 7 个订单指标有失败档」照样全绿（"字出现过" ≠ "每个指标都能失败"）。
 *   这里给数据库打一个**必定抛错**的桩，真跑 `collectXxx → buildDigest`，
 *   按 kind 逐指标核对分流结果。
 *
 * 桩的形态与线上调用一致：`collectOrderDay` 先看 `db.command.aggregate`，
 * 桩不提供它 → 走东八日 `where` 兜底，兜底的 `count()/get()` 抛错 → 与线上"两条路都不通"同形。
 *
 * @returns {Promise<string[]>} 问题清单（空数组 = 每个 collector 的失败都能落进 failed）
 */
export async function runCollectorFailureChecks (coreMod, collectMod) {
  const errs = []
  const dayKey = '2026-09-20'
  /** 每个查询动作都抛错的 db 桩 */
  const boomDb = (what) => {
    const fail = () => { throw new Error(`simulated ${what} query failure`) }
    const chain = () => {
      const o = {}
      for (const k of ['where', 'limit', 'field', 'skip', 'orderBy']) o[k] = () => o
      for (const k of ['group', 'match', 'project']) o[k] = () => o
      o.aggregate = () => o
      o.get = fail
      o.count = fail
      o.end = fail
      return o
    }
    return {
      collection: () => chain(),
      command: {
        in: (v) => ({ $in: v }),
        // 保留 `.and()` 形态：collectOrderDay 的兜底 where 用 `_.gte(x).and(_.lt(y))`，
        // 桩若在这里就抛错，测到的就不是"查询失败"而是"构造条件失败"，与线上不同形。
        gte: (v) => ({ $gte: v, and: (other) => ({ $gte: v, $and: other }) }),
        lt: (v) => ({ $lt: v })
      }
    }
  }
  const runners = {
    analytics: (db, metrics) => collectMod.collectAnalytics(db, dayKey, metrics),
    orderDay: (db, metrics) => collectMod.collectOrderDays(db, dayKey, metrics),
    dateKeyed: (db, metrics) => collectMod.collectDateKeyed(db, dayKey, metrics),
    simpleDay: (db, metrics) => collectMod.collectSimpleDay(db, dayKey, metrics)
  }
  for (const kind of Object.keys(runners)) {
    const metrics = collectMod.metricsOfKind(kind).filter((m) => m.phase === 1)
    if (!metrics.length) { errs.push(`kind=${kind} 没有任何 phase1 指标（无法核对失败档）`); continue }
    let out
    try {
      out = await runners[kind](boomDb(kind), metrics)
    } catch (e) {
      errs.push(`${kind} collector 把取数异常抛了出去 —— 应在内部转成失败档（原因：${(e && e.message) || e}）`)
      continue
    }
    const raw = { dayKey, role: 'super_admin' }
    if (kind === 'analytics') raw.analytics = out
    else if (kind === 'orderDay') raw.orderDays = out
    else if (kind === 'dateKeyed') raw.dateKeyedRows = out
    else raw.simpleDay = out
    const digest = coreMod.buildDigest(raw)
    const failedIds = new Set((digest.failed || []).map((f) => f.id))
    const missingIds = new Set(digest.missing || [])
    for (const m of metrics) {
      if (failedIds.has(m.id)) continue
      const where = missingIds.has(m.id) ? 'missing（故障被说成「当日无数据」）' : '既不在 failed 也不在 missing（静默）'
      errs.push(`${kind} collector 取数失败时，指标 ${m.id} 落进了 ${where}`)
    }
  }
  return errs
}

/** 幂等键必须按 日期+角色+收件人（D8） */
export function checkDedupeKey (core) {
  const errs = []
  const a = core.digestDedupeKey('2026-09-20', 'super_admin', 'openid-A')
  if (a.indexOf('2026-09-20') === -1 || a.indexOf('super_admin') === -1 || a.indexOf('openid-A') === -1) {
    errs.push(`日报幂等键 ${a} 没有同时含 日期/角色/收件人`)
  }
  if (a === core.digestDedupeKey('2026-09-21', 'super_admin', 'openid-A')) {
    errs.push('不同日期的幂等键相同 —— 第二天会被当成重复而漏发')
  }
  if (a === core.digestDedupeKey('2026-09-20', 'store_manager', 'openid-A')) {
    errs.push('不同角色的幂等键相同 —— 角色切片会互相顶掉')
  }
  return errs
}

// ─────────────────────────── 主流程 ───────────────────────────

let loadSeq = 0

/**
 * 以 **CommonJS** 语义加载仓内模块。
 *
 * 为什么不能用 `import()` / `createRequire`：
 *   仓根 package.json 是 `"type":"module"`，于是 `miniprogram/**` 下的 `.js` 会被 Node
 *   当成 ESM —— 而它们其实是 CJS（云函数/小程序运行时不看这份 package.json），
 *   报错形态是 `module is not defined in ES module scope`。
 *   所以这里用 Module._compile：显式给源码一个 CJS 包装，
 *   并**让它的相对 require 也走同一个加载器**（否则 dailyDigestCore 里的
 *   `require('./reportCatalog')` 又会掉回 ESM 判定）。
 */
const fsMod = requireCjs('node:fs')
const pathMod = requireCjs('node:path')
const Module = requireCjs('node:module')

const cjsCache = new Map()

function loadCjs (filePath) {
  const resolved = pathMod.resolve(filePath)
  if (cjsCache.has(resolved)) return cjsCache.get(resolved)
  const src = fsMod.readFileSync(resolved, 'utf8')
  const mod = new Module(resolved, null)
  mod.filename = resolved
  mod.paths = Module._nodeModulePaths(pathMod.dirname(resolved))
  cjsCache.set(resolved, mod.exports)
  const localRequire = (spec) => {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const dirs = [pathMod.dirname(resolved)]
      // 注入副本住在 tmp，它 require('./reportCatalog') 时同目录没有该文件；
      // 回落到云函数真源目录，这样注入副本能加载到**未注入**的兄弟模块（只测被注入那一份）
      if (pathMod.dirname(resolved) !== CF) dirs.push(CF)
      for (const d of dirs) {
        const base = pathMod.resolve(d, spec)
        const candidates = [base, `${base}.js`, `${base}.json`, pathMod.join(base, 'index.js')]
        for (const c of candidates) {
          if (fsMod.existsSync(c) && fsMod.statSync(c).isFile()) return loadCjs(c)
        }
      }
      throw new Error(`找不到模块 ${spec}（来自 ${resolved}）`)
    }
    return requireCjs(spec)
  }
  mod.require = localRequire
  mod._compile(src, resolved)
  cjsCache.set(resolved, mod.exports)
  return mod.exports
}

/** selftest 用：清空加载缓存，让注入版副本被真正读到 */
function resetCjsCache () { cjsCache.clear() }

async function loadModules (override = {}) {
  loadSeq += 1
  resetCjsCache()
  const catalogMod = loadCjs(override.catalog || F.catalog)
  const coreMod = loadCjs(override.core || F.core)
  const collectMod = loadCjs(override.collect || F.collect)
  const viewMod = loadCjs(override.digestView || F.digestView)
  const catalog = catalogMod.reportCatalog()
  return { catalogMod, coreMod, collectMod, viewMod, catalog, seq: loadSeq }
}

/**
 * 去注释（字符串字面量先占位保护）。
 * ⚠️ 2026-09-21：D10 第一版**误红了** —— 它匹配到了我在取数文件里写的**注释**
 * （注释里正举着 `.aggregate().append(pipeline)` 当反例）。本仓错题本第一族：
 * 形态/负向判据必须看去注释的源码。
 */
function stripComments (src) {
  return String(src || '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 纯判据：取数不能用 wx-server-sdk 不支持的 .append()，且必须有东八日兜底 */
function checkCollectApi (collectSrc) {
  const out = []
  const code = stripComments(collectSrc)
  if (/\.aggregate\(\)[\s\S]{0,80}?\.append\(/.test(code) || /\.append\(\s*orderDayPipeline/.test(code)) {
    out.push('取数用了 .append(pipeline)（wx-server-sdk 无此 API）')
  }
  if (!/beijingDayRange/.test(collectSrc)) out.push('缺东八日边界兜底')
  return out
}

/** 纯判据：工作台不许有独立「日报」入口（产品负责人 2026-09-21 口径） */
function checkNoDigestBanner (pageSrc) {
  const out = []
  // ⚠️ 必须去注释：本判据第一版**被我自己写的说明注释误红**了
  //    （注释里正写着"goToDigestMessages 随瓦片一起去掉了"）—— 错题本第一族的第二次复发。
  const code = stripComments(pageSrc)
  if (/key:\s*'digest'/.test(code)) out.push('工作台出现独立日报入口 key: digest')
  if (/goToDigestMessages/.test(code)) out.push('工作台出现 goToDigestMessages 深链')
  return out
}

/** 纯判据：「取数失败」与「当日无数据」必须分两档 */
function checkDigestFailureSplit (coreSrc) {
  const out = []
  if (!/failed:\s*rows\.filter\(\(r\) => r\.error\)/.test(coreSrc)) out.push('没有 failed 档')
  if (!/missing:\s*rows\.filter\(\(r\) => r\.value == null && !r\.error\)/.test(coreSrc)) {
    out.push('missing 没排除取数失败项')
  }
  return out
}

function staticChecks (mods) {
  const { catalogMod, coreMod, catalog } = mods

  // D1
  checkCatalog(catalog).forEach(fail)

  // D2
  checkCatalogMatchesCollector(catalog, read(F.collect)).forEach(fail)

  // D3（真跑）
  runFormatChecks(mods.viewMod).forEach(fail)
  runPipelineChecks(coreMod).forEach(fail)

  // 真跑装配
  runBuildChecks(coreMod, catalog).forEach(fail)

  // D5 发货时间字段
  const collectSrc = read(F.collect)
  if (/dayField:\s*'shipTime'/.test(collectSrc) || /orderField:\s*'shipTime'/.test(collectSrc)) {
    fail("订单/出货用了顶层 'shipTime' —— 现代码不写该字段（发货时间在 logistics.shipTime）")
  }
  const shipMetric = (catalog.metrics || []).find((m) => m.id === 'order_shipped')
  if (!shipMetric) fail('目录里没有 order_shipped（发货单数）')
  else if (!shipMetric.sources.some((s) => s.timeField === 'logistics.shipTime')) {
    fail("order_shipped 的 timeField 不是 'logistics.shipTime'")
  }

  /* D10 ── 线上真调用抓到的两个 P0（2026-09-21 集成官）─────────────────────────
   * ① `db.collection().aggregate().append(pipeline)` —— **`wx-server-sdk` 没有 `append`**
   *    （那是 manager-node / @cloudbase/node-sdk 的形态）。线上 7 个订单指标**全部**
   *    `append is not a function`。本地用 `tcb db nosql` 验是绿的 —— "本地验过 ≠ 线上能跑"。
   * ② 取数失败被混进"当日无数据" ⇒ 日报平静地报"订单当日无数据"，读者以为那天真没生意。
   *    必须 `failed`（取数失败，带原因）与 `missing`（当日确实无数据）**分两档**。 */
  if (checkCollectApi(collectSrc).length) {
    fail('取数用了 .append(pipeline) —— wx-server-sdk 的聚合没有这个 API（线上会全部取数失败）')
  }
  if (!/\.aggregate\(\)/.test(collectSrc) || !/\.end\(\)/.test(collectSrc)) {
    fail('取数没有走 wx-server-sdk 的 fluent 聚合（.aggregate()…end()）')
  }
  if (!/beijingDayRange/.test(collectSrc)) {
    fail('取数没有东八日边界的兜底路径（聚合不可用时会一条都出不来）')
  }
  const coreSrc = read(F.core)
  if (!/failed:\s*rows\.filter\(\(r\) => r\.error\)/.test(coreSrc)) {
    fail("buildDigest 没有把「取数失败」单独分档（failed）—— 故障会被说成「当日无数据」")
  }
  if (!/missing:\s*rows\.filter\(\(r\) => r\.value == null && !r\.error\)/.test(coreSrc)) {
    fail('missing 没有排除取数失败项 —— 两档会混在一起')
  }
  if (!/failed:\s*digest\.failed \|\| \[\]/.test(read(F.entry))) {
    fail('入口回包没有带 failed —— 失败原因传不出来（线上只能靠猜）')
  }

  // D6 队列字段 + 读侧 payload 放行
  checkQueueFields(read(F.store)).forEach(fail)
  const getMessagesSrc = read(F.getMessages)
  if (!/normalizeDigestPayload/.test(getMessagesSrc)) {
    fail('getUserMessages 没有放行日报 payload —— 详情页拿不到口径')
  }
  if (!/payload:\s*primary\.payload \|\| secondary\.payload/.test(getMessagesSrc)) {
    fail('getUserMessages 的 mergePair 没有合并 payload —— 日志行会把日报正文抹掉')
  }

  // D7 单独一档（三处一致）
  const msgIndexSrc = read(F.msgIndex)
  const digestTab = msgIndexSrc.match(/const WORKFLOW_FILTER_TABS = \[([\s\S]*?)\];/)
  if (!digestTab) fail('找不到 WORKFLOW_FILTER_TABS')
  else {
    if (!/id:\s*'digest'/.test(digestTab[1])) fail("工作信息分档里没有日报（id: 'digest'）")
    for (const id of ['ops', 'system']) {
      if (!new RegExp(`id:\\s*'${id}'`).test(digestTab[1])) fail(`工作信息分档丢了既有的 '${id}' 档`)
    }
  }
  const helperSrc = read(F.helper)
  if (!/digest:\s*\{\s*label:\s*'日报'/.test(helperSrc)) fail("messageHelper 的 CATEGORY_META 缺 digest:'日报'")
  if (!/daily_digest:\s*\{\s*label:/.test(helperSrc)) fail('messageHelper 的 TYPE_META 缺 daily_digest')
  const catSrc = read(F.catalog)
  if (!/MESSAGE_CATEGORY = 'digest'/.test(catSrc)) fail("云函数 MESSAGE_CATEGORY 不是 'digest'（与 UI 档 id 必须一致）")
  if (!/MESSAGE_TYPE = 'daily_digest'/.test(catSrc)) fail("云函数 MESSAGE_TYPE 不是 'daily_digest'")
  if (!/MESSAGE_QUEUE = 'workflow'/.test(catSrc)) fail("云函数 MESSAGE_QUEUE 不是 'workflow'（会掉进顾客信箱）")

  // D8 保留策略 + 幂等键
  checkDedupeKey(coreMod).forEach(fail)
  const storeSrc = read(F.store)
  if (!/pruneOldDigests/.test(storeSrc)) fail('没有日报清理函数 —— 「保留最近若干天」没有实现')
  if (!/retentionCutoffDayKey/.test(storeSrc)) fail('没有保留窗口起点计算')
  if (!/RETENTION_DAYS/.test(catSrc)) fail('目录里没有 RETENTION_DAYS')
  const entrySrc = read(F.entry)
  if (!/pruneOldDigests\(/.test(entrySrc)) fail('入口没有真正调用清理（登记了不等于执行）')

  /* D9 入口：**工作信息里的一档**，且工作台**不许**再有独立入口
   *  产品负责人 2026-09-21：「把日报放在工作信息中，没有必要单独提供一个入口 banner」。
   *  ⚠️ 原判据要求"工作台必须有独立瓦片 key:'digest' + goToDigestMessages()" ——
   *     那**正是产品负责人否掉的做法**。判据不能停在旧口径上（否则改对了反而变红）。 */
  const pageSrc = read(F.userPage)
  checkNoDigestBanner(pageSrc).forEach(fail)
  // ⚠️ 瓦片是 WXML 模板、不在 JS 里：第一版读 `F.userPage`（.js）→ 恒判为"瓦片不见了"（误红）。
  const wbWxml = read(F.userWxml)
  if (!/wb-tile/.test(wbWxml) || !/item\.key === 'workflow'/.test(wbWxml)) {
    fail('工作信息瓦片不见了 —— 日报没有了可达路径')
  }

  // 定时触发器（有先例可依）
  if (!existsSync(F.config)) fail('dailyDigest 缺 config.json')
  else {
    const cfg = JSON.parse(read(F.config))
    const trig = (cfg.triggers || []).find((t) => t.type === 'timer')
    if (!trig) fail('dailyDigest 没有 timer 触发器')
    else if (String(trig.config || '').trim().split(/\s+/).length !== 7) {
      // 本仓既有 8 个函数全部是 7 段（秒 分 时 日 月 周 年），实测见 sweepExpiredOrders 等
      fail(`触发器 cron 不是 7 段（本仓既有形态：秒 分 时 日 月 周 年）：${trig.config}`)
    } else notes.push(`定时触发器：${trig.name} cron="${trig.config}"（每小时一次；日切与幂等见 entry 注释）`)
  }

  // 详情页必须有日报块
  const wxml = read(F.detailWxml)
  if (!/letter-digest/.test(wxml)) fail('消息详情页没有日报渲染块（letter-digest）')
  if (!/digestView/.test(wxml)) fail('消息详情页没有消费 digestView')
}

// ─────────────────────────── --live ───────────────────────────

/**
 * `--live`：调**已部署的** dailyDigest 做一次只读 dryRun，把真实数字打出来。
 * 为什么与退出码解耦（对齐错题本 E16）：
 *   依赖线上凭据/已部署函数，在 CI 或别人机器上必然不可判定 ——
 *   这种检查若混进守卫链就会变成「假绿」或「假红」。所以它是**加验**：
 *   能跑就跑并把数字打出来，跑不了就明确打印「未验证」，退出码仍由静态判据决定。
 */
function livePreview () {
  const envFile = join(ROOT, 'admin/.env.local')
  if (!existsSync(envFile)) { console.log('⏭ --live：找不到 admin/.env.local，未验证真实数字'); return }
  const m = read(envFile).match(/^ADMIN_OPS_KEY=(.+)$/m)
  if (!m) { console.log('⏭ --live：admin/.env.local 里没有 ADMIN_OPS_KEY，未验证真实数字'); return }
  const dayArgIdx = argv.indexOf('--day')
  const payload = {
    adminOpsKey: m[1].trim(),
    action: 'build',
    dryRun: true,
    role: 'super_admin'
  }
  if (dayArgIdx >= 0 && argv[dayArgIdx + 1]) payload.dayKey = argv[dayArgIdx + 1]

  const tmp = mkdtempSync(join(tmpdir(), 'dsh-digest-'))
  const pf = join(tmp, 'payload.json')
  try {
    writeFileSync(pf, JSON.stringify(payload), { mode: 0o600 })
    const out = execFileSync('tcb', ['fn', 'invoke', 'dailyDigest', '-d', '@' + pf, '--json'], {
      cwd: join(ROOT, 'miniprogram'), encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024
    })
    const start = out.indexOf('{')
    if (start < 0) throw new Error('非 JSON 输出：' + out.slice(0, 200))
    const parsed = JSON.parse(out.slice(start))
    // 响应有两层：data.RetMsg 是 JSON 字符串（见错题本 E22）
    let ret = parsed && parsed.data && parsed.data.RetMsg
    if (typeof ret === 'string') ret = JSON.parse(ret)
    if (!ret || typeof ret !== 'object') ret = parsed.result || parsed
    if (!ret || ret.success !== true) throw new Error('云函数返回失败：' + JSON.stringify(ret).slice(0, 300))
    const digest = ret.digest || {}
    console.log(`\n--live 只读核对：dayKey=${ret.dayKey} 角色=${ret.roleLabel} 指标数=${(digest.metrics || []).length}`)
    for (const metric of (digest.metrics || [])) {
      const shown = metric.value == null ? '未取到' : metric.value
      console.log(`  · ${metric.label} = ${shown} [${metric.unit}]  ← ${metric.source}`)
    }
    if (ret.missing && ret.missing.length) console.log(`  当日无数据项：${ret.missing.join(', ')}`)
  } catch (e) {
    console.log('⏭ --live：调用失败（未验证真实数字）：' + String((e && e.message) || e).slice(0, 200))
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

// ─────────────────────────── selftest ───────────────────────────

async function selftest () {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-digest-self-'))
  let ok = 0
  let bad = 0
  const t = (label, res) => {
    if (res) { console.log(`  ✓ ${label}`); ok += 1 } else { console.error(`  ✗ ${label}`); bad += 1 }
  }
  /** 在临时副本里做注入，绝不动共享工作区（错题本 E19 / AGENTS.md 隔离要求） */
  const mutate = (name, src, fn) => {
    const p = join(tmp, name)
    writeFileSync(p, fn(src), 'utf8')
    return p
  }

  try {
    const base = await loadModules()
    // 基线：干净源码必须全绿
    const clean = []
    checkCatalog(base.catalog).forEach((e) => clean.push(e))
    checkCatalogMatchesCollector(base.catalog, read(F.collect)).forEach((e) => clean.push(e))
    runFormatChecks(base.viewMod).forEach((e) => clean.push(e))
    runPipelineChecks(base.coreMod).forEach((e) => clean.push(e))
    runBuildChecks(base.coreMod, base.catalog).forEach((e) => clean.push(e))
    checkDedupeKey(base.coreMod).forEach((e) => clean.push(e))
    checkQueueFields(read(F.store)).forEach((e) => clean.push(e))
    t('基线：干净源码零问题', clean.length === 0)
    if (clean.length) clean.forEach((e) => console.error('     · ' + e))

    // ① 口径丢失：某个指标的 sources 被删（直接改结构对象，不靠正则抠源码）
    const brokenCatalog = JSON.parse(JSON.stringify(base.catalog))
    delete brokenCatalog.metrics[0].sources
    t('★ 被检出：指标没有 sources[]（口径未登记）', checkCatalog(brokenCatalog).length > 0)

    // ①b 来源字段残缺
    const partialCatalog = JSON.parse(JSON.stringify(base.catalog))
    delete partialCatalog.metrics[0].sources[0].tz
    t('★ 被检出：来源缺 tz（口径写不完整）', checkCatalog(partialCatalog).length > 0)

    // ② 单位错配：把 _fen 指标的 unit 写成 yuan
    const wrongUnit = mutate('core-wrongunit.js', read(F.core), (s) => s.replace("  if (metric.unit === 'fen') return `¥${(n / 100).toFixed(2)}`;", "  if (metric.unit === 'fen') return `¥${n.toFixed(2)}`;"))
    const tmpView = mutate('view-wrongunit.js', read(F.digestView), (s) => s.replace("  if (unit === 'fen') return `¥${(n / 100).toFixed(2)}`;", "  if (unit === 'fen') return `¥${n.toFixed(2)}`;"))
    const m2 = await loadModules({ digestView: tmpView })
    t('★ 被检出：分没有除以 100（金额放大 100 倍）', runFormatChecks(m2.viewMod).length > 0)

    // ③ 归日桶被覆盖（本轮真踩过的坑）
    const brokenPipe = mutate('core-brokenpipe.js', read(F.core), (s) => s.replace(/\n\s+_id: \{ \$dateToString: \{ format: '%Y-%m-%d', date: `\$\$\{dateField\}`, timezone: 'Asia\/Shanghai' \} \}/, '\n        _id: null'))
    const m3 = await loadModules({ core: brokenPipe })
    t('★ 被检出：$group._id 被覆盖成 null（订单指标会全部「未取到」）', runPipelineChecks(m3.coreMod).length > 0)

    // ④ 「未取到」冒充 0
    const zeroForNull = mutate('view-zerofornull.js', read(F.digestView), (s) => s.replace("  if (!metric || metric.value == null) return '未取到';", "  if (!metric) return '未取到';\n  if (metric.value == null) return '0';"))
    const m4 = await loadModules({ digestView: zeroForNull })
    t('★ 被检出：当日无数据被显示成 0', runFormatChecks(m4.viewMod).length > 0)

    // ⑤ 队列字段缺失 → 会掉进顾客信箱（给每条判据各来一次，别只测一条）
    // ⚠️ 三个字段在 user_messages 与 notification_logs 两处各写一遍，
    //    注入必须 **replaceAll** —— 只删第一处的话判据仍能匹配到第二处，注入就"没被检出"
    const storeSrc = read(F.store)
    t('★ 被检出：写入层缺 queue 字段', checkQueueFields(storeSrc.replaceAll('queue: MESSAGE_QUEUE,', '')).length > 0)
    t('★ 被检出：写入层缺 category 字段（日报进不了「日报」档）', checkQueueFields(storeSrc.replaceAll('category: MESSAGE_CATEGORY,', '')).length > 0)
    t('★ 被检出：写入层缺 dedupeKey（会重复发）', checkQueueFields(storeSrc.replaceAll('dedupeKey: key,', '')).length > 0)

    // ⑥ 幂等键不含日期
    const flatKey = mutate('core-flatkey.js', read(F.core), (s) => s.replace('return `daily_digest:${role}:${dayKey}:${openid}`', 'return `daily_digest:${role}:${openid}`'))
    const m6 = await loadModules({ core: flatKey })
    t('★ 被检出：幂等键不含日期（第二天会漏发）', checkDedupeKey(m6.coreMod).length > 0)

    // ⑦ 取数实现查了未登记的集合
    t('★ 被检出：取数查了目录未登记的集合',
      checkCatalogMatchesCollector(base.catalog, read(F.collect) + "\nconst x = db.collection('some_rogue_collection').where({}).get()\n").length > 0)

    // ⑧ 目录登记了但**没有任何落地路径**（假口径）：
    //    把动态取值点也拿掉 → 反向判据必须报出来。
    //    （只把字面集合改名是测不到的：实现本来就走动态取值，判据会正确地放行。）
    const noPathSrc = read(F.collect)
      .replace(/\.sources\[0\]\.collection\) \|\| ''/g, "''")
      .replace(/list\[0\]\.sources\[0\]\.timeField/g, "'date'")
    t('★ 被检出：目录登记了取数里既没字面也没动态查的集合',
      checkCatalogMatchesCollector(base.catalog, noPathSrc).length > 0)

    // ⑧b 反向保护：动态取值点被删掉后，**没有**反向报错的其它回归仍应通过
    t('★ 反例：删掉动态取值点会真的改变判定（不是恒真）',
      checkCatalogMatchesCollector(base.catalog, noPathSrc).length !== 0)

    // ⑨ 分析侧时区语义未写明
    const noTzCatalog = JSON.parse(JSON.stringify(base.catalog))
    const an = noTzCatalog.metrics.find((m) => (m.sources || []).some((s) => s.collection === 'analytics_daily'))
    if (an) an.sources.forEach((s) => { if (s.collection === 'analytics_daily') s.tz = '当日' })
    t('★ 被检出：analytics_daily 来源没写明 UTC 日', checkCatalog(noTzCatalog).length > 0)

    // ⑨b 单位与命名不一致
    const unitMismatch = JSON.parse(JSON.stringify(base.catalog))
    const fenMetric = unitMismatch.metrics.find((m) => /_fen$/.test(m.id))
    if (fenMetric) fenMetric.unit = 'yuan'
    t('★ 被检出：_fen 指标的单位被写成 yuan', checkCatalog(unitMismatch).length > 0)

    // ⑩-a 取数退回 wx-server-sdk 不支持的 `.append(pipeline)`（线上 7 个订单指标会全灭）
    const appendBack = mutate('collect-append.js', read(F.collect),
      (s) => s.replace('        .aggregate()\n        .group(group)', '        .aggregate()\n        .append([])\n        .group(group)'))
    t('★ 被检出：取数退回 .append(pipeline)（wx-server-sdk 无此 API，线上取数全灭）',
      checkCollectApi(read(appendBack)).length > 0)

    // ⑩-b 取数失败被混回"当日无数据"
    const mergedMissing = mutate('core-mergedmissing.js', read(F.core),
      (s) => s.replace('missing: rows.filter((r) => r.value == null && !r.error).map((r) => r.id),',
        'missing: rows.filter((r) => r.value == null).map((r) => r.id),')
        .replace('failed: rows.filter((r) => r.error).map((r) => ({ id: r.id, label: r.label, error: r.error }))',
          'failed: [],'))
    t('★ 被检出：取数失败被混成「当日无数据」', checkDigestFailureSplit(read(mergedMissing)).length > 0)

    // ⑩-d 行为级 D11：**每一个** collector 的失败都必须落进 failed。
    //     逐个 kind 注入"失败又变回无数据"，证明判据对 4 类取数都真的会红（不是恒绿）。
    const injAnalytics = mutate('collect-analytics-silent.js', read(F.collect),
      (s) => s.replace('out[m.action] = { action: m.action, count: 0, uv: [], error: msg }',
        'out[m.action] = { action: m.action, count: 0, uv: [] }'))
    const mAnalytics = await loadModules({ collect: injAnalytics })
    t('★ 被检出：analytics 取数失败被静默成 0（6 个指标没有失败档）',
      (await runCollectorFailureChecks(mAnalytics.coreMod, mAnalytics.collectMod)).length > 0)

    const injOrder = mutate('collect-order-silent.js', read(F.collect),
      (s) => s.replace("out[metric.id] = { found: false, count: 0, sum: null, error: (e && e.message) || 'collect failed' }",
        'out[metric.id] = { found: false, count: 0, sum: null }'))
    const mOrder = await loadModules({ collect: injOrder })
    t('★ 被检出：orderDay 取数失败被混成「当日无数据」',
      (await runCollectorFailureChecks(mOrder.coreMod, mOrder.collectMod)).length > 0)

    const injDateKeyed = mutate('collect-datekeyed-silent.js', read(F.collect),
      (s) => s.replace('out[col] = { error: msg, collection: col }', 'out[col] = null'))
    const mDateKeyed = await loadModules({ collect: injDateKeyed })
    t('★ 被检出：dateKeyed 取数失败被混成「当日无数据」（5 个门店指标没有失败档）',
      (await runCollectorFailureChecks(mDateKeyed.coreMod, mDateKeyed.collectMod)).length > 0)

    const injSimple = mutate('collect-simpleday-silent.js', read(F.collect),
      (s) => s.replace('out[metric.id] = { error: msg, collection: col }', 'out[metric.id] = null'))
    const mSimple = await loadModules({ collect: injSimple })
    t('★ 被检出：simpleDay 取数失败被混成「当日无数据」',
      (await runCollectorFailureChecks(mSimple.coreMod, mSimple.collectMod)).length > 0)

    // 反例：干净源码下 D11 必须**零问题**（否则上面的红是恒红，不构成判据）
    t('★ 反例：干净源码下 D11 零问题（判据不是恒红）',
      (await runCollectorFailureChecks(base.coreMod, base.collectMod)).length === 0)

    // ⑩-c 工作台又冒出独立「日报」入口 banner（产品负责人已否掉的做法）
    // ⚠️ 锚点要贴着真实源码：工作台瓦片是 `{ key: 'workflow', kind: 'workflow', … }`，
    //    第一版锚在 `{\n      kind: 'workflow',` 上 —— 中间隔着 `key:` 一行，**匹配不到**，
    //    于是 mutate 变成空操作、注入"恒绿"（本仓错题本：注入锚点必须与实际源码逐字对齐）。
    const tileBack = mutate('user-digesttile.js', read(F.userPage),
      (s) => s.replace("    {\n      key: 'workflow',", "    {\n      key: 'digest',"))
    t('★ 被检出：工作台又出现独立「日报」入口（产品口径：只放在工作信息里）',
      checkNoDigestBanner(read(tileBack)).length > 0)

    // ⑩ 扩展位被误开（本次只应开超管）
    const allOn = mutate('cat-allroles.js', read(F.catalog), (s) => s.replace(/\n\s*enabled: false/g, '\n    enabled: true'))
    const m10 = await loadModules({ catalog: allOn })
    t('★ 被检出：扩展角色被误启用（本次只应开超管）', runBuildChecks(m10.coreMod, m10.catalog).length > 0)
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }

  console.log(`\n自检：${ok} 项通过 / ${bad} 项失败`)
  return bad === 0
}

// ─────────────────────────── main ───────────────────────────

async function main () {
  if (has('--selftest')) {
    const ok = await selftest()
    process.exit(ok ? 0 : 1)
  }
  const mods = await loadModules()
  staticChecks(mods)
  // D11 行为级：模拟**每一个** collector 的查询失败，逐指标断言它落进 failed（不是 missing）
  const collectorFailures = await runCollectorFailureChecks(mods.coreMod, mods.collectMod)
  collectorFailures.forEach(fail)
  if (has('--live')) livePreview()

  if (problems.length) {
    console.error(`✗ 每日日报守卫失败 ${problems.length} 项：`)
    problems.forEach((p) => console.error('  · ' + p))
    process.exit(1)
  }
  notes.forEach((n) => console.log('  · ' + n))
  const n = mods.catalog.metrics.length
  const phase2 = mods.catalog.metrics.filter((m) => m.phase === 2).length
  console.log(`✓ 每日日报守卫通过：${n} 个指标（扩展位 ${phase2} 个，本次未发车）、${mods.catalog.metrics.reduce((a, m) => a + (m.sources || []).length, 0)} 条来源登记、角色切片 ${mods.catalog.roles.length} 个（启用 ${mods.catalog.enabledRoles.length} 个）`)
}

main().catch((e) => {
  console.error('✗ 守卫执行异常：', e)
  process.exit(1)
})
