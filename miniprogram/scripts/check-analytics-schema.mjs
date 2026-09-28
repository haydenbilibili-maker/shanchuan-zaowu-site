#!/usr/bin/env node
/**
 * 埋点 schema 一致性守卫
 *
 * 为什么需要（2026-09-16 审计发现）：小程序 `utils/analytics/eventSchema.js` 与
 * ERP 镜像 `admin/src/utils/analyticsSchema.js` 长期靠**人工同步**，结果：
 *   - ERP 镜像缺 12 个已登记事件（atlas_* ×7、framer_recruit_* ×3、identify_share_link 等）
 *   - **38 个已在页面触发的事件从未登记**（gift_* 15 个、community_* 7 个等）
 *   - constants.js 缺 `gift_` 前缀 → 15 个礼赠事件全被 inferModule 兜底成 `system`，污染模块分布
 * 后果是「报表里的模块/漏斗口径与真实行为不一致」，而这是**没有人会主动发现**的那类缺陷。
 *
 * 检查项：
 *   A. 小程序 eventSchema 的每个 action 都能在 ERP 镜像找到（同构，防再次漂移）
 *   B. module 常量集合双端一致
 *   C. 代码里实际触发的 action 必须在 eventSchema 登记（防「埋了但报表看不到」）
 *   D. `gift_` 前缀必须映射到 GIFT 模块（防模块分布再次被污染）
 *
 * 用法：
 *   node miniprogram/scripts/check-analytics-schema.mjs
 *   node miniprogram/scripts/check-analytics-schema.mjs --selftest
 * 退出码：有问题为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP_SCHEMA = join(ROOT, 'miniprogram/utils/analytics/eventSchema.js')
const MP_CONSTANTS = join(ROOT, 'miniprogram/utils/analytics/constants.js')
const ERP_SCHEMA = join(ROOT, 'admin/src/utils/analyticsSchema.js')
const MP_ROOT = join(ROOT, 'miniprogram')
const MP_QR_MATERIAL = join(ROOT, 'miniprogram/utils/analytics/qrMaterial.js')
const MP_ANALYTICS_INDEX = join(ROOT, 'miniprogram/utils/analytics/index.js')
const MP_SESSION = join(ROOT, 'miniprogram/utils/analytics/session.js')
const MP_APP_JS = join(ROOT, 'miniprogram/app.js')
const MP_APP_JSON = join(ROOT, 'miniprogram/app.json')
const CLOUD_TRACK = join(ROOT, 'miniprogram/cloudfunctions/trackUserBehavior/index.js')
const CLOUD_DASHBOARD = join(ROOT, 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')
const ERP_BEHAVIOR_PAGE = join(ROOT, 'admin/src/components/BehaviorAnalytics.vue')

/** 纯函数：解析形如 `action: { module: MODULE.X, desc: '...' }` 的注册表 */
export function parseEvents(src) {
  const out = new Map()
  for (const m of src.matchAll(
    /^\s{2}([a-z][a-z0-9_]*):\s*\{\s*module:\s*MODULE\.([A-Z_]+),/gm,
  )) {
    out.set(m[1], m[2])
  }
  return out
}

/** 纯函数：解析 MODULE 常量名集合 */
export function parseModules(src) {
  const m = src.match(/const MODULE\s*=\s*\{([\s\S]*?)\n\}/)
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/^\s*([A-Z_]+):\s*'/gm)].map((x) => x[1]))
}

/** 纯函数：解析 action 前缀 → module 映射 */
export function parsePrefixMap(src) {
  return [...src.matchAll(/\['([a-z_]+)',\s*MODULE\.([A-Z_]+)\]/g)].map((m) => ({
    prefix: m[1],
    module: m[2],
  }))
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'miniprogram_npm') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|wxml)$/.test(name)) out.push(p)
  }
  return out
}

/** 纯函数：从源码中提取被触发的 action 字面量 */
export function extractTriggered(files) {
  const found = new Map()
  const RE = /(?:trackBehavior|track|trackEvent|logEvent)\s*\(\s*['"]([a-z][a-z0-9_]*)['"]/g
  for (const { path, src } of files) {
    for (const m of src.matchAll(RE)) {
      if (!found.has(m[1])) found.set(m[1], path)
    }
  }
  return found
}

export function checkAll(input) {
  const problems = []
  const { mpEvents, erpEvents, mpModules, erpModules, triggered, prefixes, giftModule } = input

  // A. 同构
  for (const [action] of mpEvents) {
    if (!erpEvents.has(action)) {
      problems.push(`A: ERP 镜像缺少小程序已登记事件 \`${action}\`（报表看不到）`)
    }
  }
  // B. module 常量同构
  for (const m of mpModules) {
    if (!erpModules.has(m)) problems.push(`B: ERP MODULE 缺常量 \`${m}\``)
  }
  for (const m of erpModules) {
    if (!mpModules.has(m)) problems.push(`B: 小程序 MODULE 缺常量 \`${m}\``)
  }
  // C. 触发点必须已登记
  for (const [action, file] of triggered) {
    if (!mpEvents.has(action)) {
      problems.push(`C: 事件 \`${action}\` 已在 ${file} 触发但未登记到 eventSchema（埋了但报表看不到）`)
    }
  }
  // D. gift_ 前缀映射
  const giftPrefix = prefixes.find((p) => p.prefix === 'gift_')
  if (!giftPrefix) problems.push('D: constants.js 缺 `gift_` 前缀映射 → 礼赠事件会被兜底成 system')
  else if (giftModule && giftPrefix.module !== giftModule) {
    problems.push(`D: \`gift_\` 前缀映射到 ${giftPrefix.module}，期望 ${giftModule}`)
  }
  return problems
}

/**
 * 纯函数：解析「物料码登记表」（`QR_MATERIALS = [ { key: '…', … } ]`）。
 * 小程序 `utils/analytics/qrMaterial.js` 与 ERP 镜像各有一份，必须同 key。
 */
export function parseQrMaterials(src) {
  const m = /const QR_MATERIALS\s*=\s*\[([\s\S]*?)\n\]/.exec(src)
  if (!m) return null
  const out = []
  for (const blk of m[1].matchAll(/\{([\s\S]*?)\}/g)) {
    const body = blk[1]
    const g = (f) => {
      const x = new RegExp(`${f}:\\s*'([^']*)'`).exec(body)
      return x ? x[1] : ''
    }
    const key = g('key')
    if (key) {
      out.push({ key, label: g('label'), scene: g('scene'), targetPage: g('targetPage'), convertAction: g('convertAction') })
    }
  }
  return out
}

/** 读 app.json，返回已注册页面集合（形如 /subpackages/feature/identify/index） */
export function registeredPages(appJsonSrc) {
  const app = JSON.parse(appJsonSrc)
  const set = new Set()
  for (const p of app.pages || []) set.add('/' + String(p).replace(/^\//, ''))
  for (const sp of app.subpackages || app.subPackages || []) {
    const root = String(sp.root || '').replace(/\/$/, '')
    for (const p of sp.pages || []) set.add('/' + `${root}/${p}`.replace(/^\//, ''))
  }
  return set
}

/**
 * 物料码（印刷二维码）转化监测的**契约检查**（2026-09-20 产品负责人指派）。
 *
 * 为什么必须独立成段：这套监测有 4 个「静默失效点」，任何一处错了报表都只是**数字偏低或恒 0**，
 * 不会报错、也不会有人发现 ——
 *   ① ERP 镜像缺物料 → 那张码在报表里根本没有行；
 *   ② `targetPage` 不是注册页 → 漏斗第二环「到达目标页」永远算不出（页面搬过家，见扫码入口兜底文档）；
 *   ③ 云端字段白名单缺 `entrySource` → **整条归因被静默丢弃**（所有漏斗只剩首环）；
 *   ④ `convertAction` 未登记 → 末环恒 0。
 * 另外还要证明"登记表真的能被 scene 解析到"（表里写了但解析不出来 = 等于没埋）。
 */
export function checkQrMaterials(input) {
  const {
    mpMaterials, erpMaterials, registered, mpEvents, erpEvents,
    cloudSrc, appSrc, payloadSrc, sessionSrc, parse, entrySourceOf,
  } = input
  const problems = []
  if (!mpMaterials || !mpMaterials.length) {
    problems.push('E: 小程序 qrMaterial.js 里没有 QR_MATERIALS（三张物料码无法归因）')
    return problems
  }
  const erpKeys = new Set((erpMaterials || []).map((m) => m.key))
  for (const m of mpMaterials) {
    if (!erpKeys.has(m.key)) {
      problems.push(`E: ERP 镜像 QR_MATERIALS 缺物料 \`${m.key}\`（这张码在报表里没有行）`)
    }
    if (!m.targetPage || !registered.has('/' + String(m.targetPage).replace(/^\//, ''))) {
      problems.push(`E: 物料 \`${m.key}\` 的 targetPage=${m.targetPage} 不是 app.json 注册页（「到达目标页」这一环永远算不出）`)
    }
    if (!mpEvents.has(m.convertAction)) {
      problems.push(`E: 物料 \`${m.key}\` 的 convertAction=\`${m.convertAction}\` 未登记到 eventSchema（漏斗末环恒 0）`)
    } else if (!erpEvents.has(m.convertAction)) {
      problems.push(`E: 物料 \`${m.key}\` 的 convertAction=\`${m.convertAction}\` 在 ERP 镜像缺失`)
    }
    // 登记表写了却解析不出来 = 等于没埋（scene 串与判据脱节）
    if (typeof parse === 'function' && parse(m.scene) !== m.key) {
      problems.push(`E: 物料 \`${m.key}\` 的 scene='${m.scene}' 解析得到 '${parse(m.scene)}'（登记表与解析判据脱节）`)
    }
    if (typeof entrySourceOf === 'function' && entrySourceOf(m.key) !== `qr:${m.key}`) {
      problems.push(`E: 物料 \`${m.key}\` 的 entrySource 前缀不是 \`qr:\``)
    }
  }
  // ③ 云端白名单：字段名不在白名单 = 归因被静默丢弃
  const wl = /BEHAVIOR_ALLOWED_FIELDS\s*=\s*\[([\s\S]*?)\]/.exec(cloudSrc || '')
  const allowed = wl ? [...wl[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
  if (!allowed.includes('entrySource')) {
    problems.push('E: 云端 trackUserBehavior 的 BEHAVIOR_ALLOWED_FIELDS 没有 `entrySource` → 物料归因被静默丢弃（所有物料漏斗只剩首环）')
  }
  // 入口埋点与接线
  if (!/qr_material_enter\s*['"]/.test(appSrc || '')) {
    problems.push('E: app.js 没有埋 `qr_material_enter`（「扫码进入」这一环收不到）')
  }
  // ⚠️ 必须匹配 `this.` 前缀：方法**定义**是 `maybeTrackQrMaterial(options) {`，
  //    不带 this. 的判据会被定义本身满足 → 拆掉 onShow 那行也检不出（空判，自检抓到的）。
  if (!/this\.maybeTrackQrMaterial\(options\)/.test(appSrc || '')) {
    problems.push('E: onShow 没接线 `this.maybeTrackQrMaterial(options)`（方法在但没调用 = 等于没写）')
  }
  if (!/entrySource/.test(payloadSrc || '')) {
    problems.push('E: analytics/index.js#buildPayload 没把 `entrySource` 写进事件（只有首环有归因，后半条漏斗全丢）')
  }
  if (!/setEntrySource/.test(sessionSrc || '')) {
    problems.push('E: analytics/session.js 没有 `setEntrySource`（会话归因写不进去）')
  }
  return problems
}

/**
 * F 段：门禁漏斗（`*_gate`）的「合成 action」口径。
 *
 * 为什么单列一段（2026-09-20 实测到的真缺陷）：ERP 行为看板把带 `step` 的门禁事件
 * 展开成合成 action（`wish_wall_register_gate:show` 这种）。原实现写的是
 * `` `${GATE_ACTION}:${step}` ``，而 `GATE_ACTION` **全仓无定义**（HEAD 版本即如此）——
 * 只要明细里出现任一命中事件就抛 `ReferenceError`，被 refresh 的 catch 吞掉，后果是：
 *   · 该类漏斗**恒 0**（数字错）；
 *   · 页面**谎报**「user_behaviors 不可读」（把"代码坏了"说成"数据没了"，更误导）。
 * 合成 action 必须用**事件自己的 action**（函数开头刚按它过滤过），才能与 FUNNELS 里
 * 声明的 `action:step` 对上；且 `STEP_GATE_ACTIONS` 必须**从 FUNNELS 派生**（历史缺陷：
 * 曾经硬编码单个 action，导致新加的门禁漏斗恒 0）。
 */
export function checkGateExpansion(src) {
  const problems = []
  // ⚠️ 先去掉注释再判：修复说明里会**引用**坏标识符的名字（"原来写的是 `${GATE_ACTION}…`"），
  //    不剥注释就会把"解释这个坑的注释"当成"又踩了这个坑"（判据自身错误）。
  const code = String(src || '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const m = /const buildGateStepRows[\s\S]*?\n\}/.exec(code)
  if (!m) {
    problems.push('F: 找不到 `buildGateStepRows`（门禁漏斗展开逻辑被改名/删除 → 该类漏斗会失真）')
    return problems
  }
  const body = m[0]
  // ⚠️ 必须带词边界：`STEP_GATE_ACTIONS` **含有**子串 `GATE_ACTION`，
  //    裸 /GATE_ACTION/ 会把正确的 `STEP_GATE_ACTIONS` 也判成"引用了未定义标识符"（判据自身错误）。
  if (/(^|[^A-Z_])GATE_ACTION\b/.test(body)) {
    problems.push('F: `buildGateStepRows` 引用了未定义的 `GATE_ACTION`（抛 ReferenceError 被吞 → 漏斗恒 0 且页面谎报「user_behaviors 不可读」）')
  }
  if (!/const\s+action\s*=\s*`\$\{ev\.action\}:\$\{step\}`/.test(body)) {
    problems.push('F: 门禁漏斗的合成 action 不是 `${ev.action}:${step}`（与 FUNNELS 声明的 `action:step` 对不上 → 恒 0）')
  }
  if (!/const\s+STEP_GATE_ACTIONS\s*=\s*Array\.from\(\s*new Set\(\s*FUNNELS/.test(code)) {
    problems.push('F: `STEP_GATE_ACTIONS` 不再从 `FUNNELS` 派生（新增门禁漏斗会恒 0 —— 2026-09-18 踩过）')
  }
  return problems
}

/**
 * G 段：user_behaviors 写入字段 ↔ 报表读侧查询对齐。
 *
 * 真缺陷（2026-09-21 蓝图实测 / 2026-09-26 超管漏斗全 0）：
 *   安全白名单落地后 writeBehavior 不写 timestamp/userId，
 *   而 getAnalyticsDashboard.loadBehaviors / ERP BehaviorAnalytics 按 timestamp 查
 *   → 明细恒空 → 行为漏斗全 0。analytics_daily 仍在涨，容易误判「真无行为」。
 * 判据：写侧必须显式落 timestamp+userId；读侧必须按 dateKey（兼容历史无 timestamp 行）。
 */
export function checkBehaviorFieldAlignment({ trackSrc, dashboardSrc, erpPageSrc } = {}) {
  const problems = []
  const track = String(trackSrc || '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const dash = String(dashboardSrc || '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const erp = String(erpPageSrc || '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  if (!/doc\.timestamp\s*=/.test(track)) {
    problems.push(
      'G: trackUserBehavior.writeBehavior 未写 `doc.timestamp` → 读侧按时间查恒空、漏斗全 0'
    )
  }
  if (!/doc\.userId\s*=/.test(track)) {
    problems.push(
      'G: trackUserBehavior.writeBehavior 未写 `doc.userId` → UV/去重恒空（只剩 _openid）'
    )
  }

  const loadFn =
    /async function loadBehaviorsWithMeta[\s\S]*?(?=\nasync function |\nfunction [a-zA-Z]|$)/.exec(dash) ||
    /async function loadBehaviors[\s\S]*?(?=\nasync function |\nfunction [a-zA-Z]|$)/.exec(dash)
  if (!loadFn) {
    problems.push('G: 找不到 getAnalyticsDashboard.loadBehaviors（行为漏斗取数入口）')
  } else {
    const body = loadFn[0]
    // 只看 .where({...}) 条件，避免把 field({ dateKey: true }) 当成「按 dateKey 查」
    const whereBodies = [...body.matchAll(/\.where\(\s*\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1])
    const hasDateKeyWhere = whereBodies.some((w) => /\bdateKey\s*:/.test(w))
    const hasTimestampWhere = whereBodies.some((w) => /\btimestamp\s*:/.test(w))
    const hasDateKeyIn = /dateKey\s*:\s*_\.in\(/.test(body)
    if (!hasDateKeyWhere) {
      problems.push(
        'G: loadBehaviors 未按 `dateKey` 查询 → 历史无 timestamp 的行读不到（漏斗恒 0）'
      )
    }
    if (!hasDateKeyIn) {
      problems.push(
        'G: loadBehaviors 缺少 `dateKey _.in` 主路径（range 索引缺失时会整段失败 → 明细恒空）'
      )
    }
    if (hasTimestampWhere && !hasDateKeyWhere) {
      problems.push(
        'G: loadBehaviors 仍以 `timestamp` 作为唯一 where 条件（2026-09-15 后写入无该字段 → 恒空）'
      )
    }
  }
  if (!/funnel-daily-v2/.test(dash) && !/analytics_daily\+behaviors/.test(dash)) {
    problems.push(
      'G: buildFunnel 未接入 analytics_daily 动作级兜底（仅靠明细采样时鉴定漏斗易被 page_view 淹没成全 0）'
    )
  }

  if (erp) {
    // ERP 明细拉取：必须出现 dateKey 条件；禁止「只有 timestamp 范围」的旧写法
    const hasDateKeyFetch =
      /user_behaviors[\s\S]{0,220}dateKey\s*:/.test(erp) ||
      /dateKey\s*:\s*_\.gte\(start\)[\s\S]{0,120}user_behaviors/.test(erp)
    const hasTimestampOnly =
      /user_behaviors[\s\S]{0,220}timestamp\s*:\s*_\.gte/.test(erp) &&
      !/user_behaviors[\s\S]{0,220}dateKey\s*:/.test(erp)
    if (!hasDateKeyFetch) {
      problems.push(
        'G: BehaviorAnalytics 拉 user_behaviors 未按 `dateKey` → 门禁/物料监测明细恒空'
      )
    }
    if (hasTimestampOnly) {
      problems.push(
        'G: BehaviorAnalytics 仍按 `timestamp` 拉 user_behaviors（与写侧错配 → 明细恒空）'
      )
    }
  }

  return problems
}

/** 加载真实 qrMaterial.js（纯函数模块，无依赖） */function loadQrMaterial() {
  const src = readFileSync(MP_QR_MATERIAL, 'utf8')
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(mod, mod.exports, (id) => {
    throw new Error(`unexpected require ${id}`)
  })
  return mod.exports
}

function selftest() {
  const base = {
    mpEvents: new Map([['product_view', 'COMMERCE'], ['gift_pay_click', 'GIFT']]),
    erpEvents: new Map([['product_view', 'COMMERCE'], ['gift_pay_click', 'GIFT']]),
    mpModules: new Set(['COMMERCE', 'GIFT']),
    erpModules: new Set(['COMMERCE', 'GIFT']),
    triggered: new Map([['product_view', 'a.js']]),
    prefixes: [{ prefix: 'gift_', module: 'GIFT' }],
    giftModule: 'GIFT',
  }
  const cases = [
    ['一致时不得报错', base, 0],
    ['ERP 缺事件必须报错', { ...base, erpEvents: new Map([['product_view', 'COMMERCE']]) }, 1],
    ['未登记触发点必须报错', { ...base, triggered: new Map([['telemetry_x', 'b.js']]) }, 1],
    ['缺 gift_ 前缀必须报错', { ...base, prefixes: [] }, 1],
    ['gift_ 映射错模块必须报错', { ...base, prefixes: [{ prefix: 'gift_', module: 'SYSTEM' }] }, 1],
    ['module 常量不同构必须报错', { ...base, erpModules: new Set(['COMMERCE']) }, 1],
  ]
  let failed = 0
  for (const [name, input, want] of cases) {
    const got = checkAll(input).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }
  // ── E 段：物料码契约（合成输入 → 每条判据都必须能红）──
  const qr = loadQrMaterial()
  const baseMaterial = {
    key: 'identify_store',
    scene: 'from=store_qr',
    targetPage: 'subpackages/feature/identify/index',
    convertAction: 'identify_success',
  }
  const goodMat = {
    mpMaterials: [baseMaterial],
    erpMaterials: [baseMaterial],
    registered: new Set(['/subpackages/feature/identify/index']),
    mpEvents: new Map([['identify_success', 'IDENTIFY']]),
    erpEvents: new Map([['identify_success', 'IDENTIFY']]),
    cloudSrc: "const BEHAVIOR_ALLOWED_FIELDS = ['action', 'entrySource']",
    appSrc: "this.maybeTrackQrMaterial(options)\ntrackBehavior('qr_material_enter', 'qr_material', key)",
    payloadSrc: 'entrySource: session.entrySource',
    sessionSrc: 'function setEntrySource() {}',
    parse: qr.parseQrMaterial,
    entrySourceOf: qr.entrySourceOf,
  }
  const matCases = [
    ['物料契约齐全时不报错', goodMat, 0],
    ['ERP 镜像缺物料必须报错', { ...goodMat, erpMaterials: [] }, 1],
    ['targetPage 不是注册页必须报错', { ...goodMat, registered: new Set(['/pages/other/index']) }, 1],
    ['convertAction 未登记必须报错', { ...goodMat, mpEvents: new Map() }, 1],
    ['convertAction 在 ERP 镜像缺失必须报错', { ...goodMat, erpEvents: new Map() }, 1],
    ['云端白名单缺 entrySource 必须报错', { ...goodMat, cloudSrc: "const BEHAVIOR_ALLOWED_FIELDS = ['action']" }, 1],
    ['onShow 没接线必须报错', { ...goodMat, appSrc: 'function maybeTrackQrMaterial() {}' }, 1],
    ['buildPayload 没带 entrySource 必须报错', { ...goodMat, payloadSrc: 'nothing' }, 1],
    ['没有 setEntrySource 必须报错', { ...goodMat, sessionSrc: 'nothing' }, 1],
    ['登记表与解析判据脱节必须报错', { ...goodMat, mpMaterials: [{ ...baseMaterial, scene: 'from=counter_qr' }] }, 1],
  ]
  for (const [name, input, want] of matCases) {
    const got = checkQrMaterials(input).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }

  // ── F 段：门禁漏斗合成 action（合成输入）──
  const goodGateSrc = 'const STEP_GATE_ACTIONS = Array.from(new Set(FUNNELS.flatMap((f) => f.steps)))\n'
    + 'const buildGateStepRows = (events = []) => {\n'
    + '  const action = `${ev.action}:${step}`\n'
    + '  return []\n'
    + '}\n'
  const gateCases = [
    ['F 段：正常源码不报错', goodGateSrc, 0],
    ['F 段：引用未定义 GATE_ACTION 必须报错（真缺陷形态）',
      goodGateSrc.replace('${ev.action}', '${GATE_ACTION}'), 1],
    ['F 段：合成 action 用错变量必须报错',
      goodGateSrc.replace('${ev.action}', '${ev.targetType}'), 1],
    ['F 段：STEP_GATE_ACTIONS 不再从 FUNNELS 派生必须报错',
      goodGateSrc.replace('FUNNELS.flatMap((f) => f.steps)', "[{ action: 'wish_wall_register_gate:show' }]"), 1],
  ]
  for (const [name, src, want] of gateCases) {
    const got = checkGateExpansion(src).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }

  // ── G 段：写字段 ↔ 读查询对齐（合成输入）──
  const goodAlign = {
    trackSrc: 'async function writeBehavior(event) {\n  doc.timestamp = ts\n  doc.userId = openid\n}\n',
    dashboardSrc:
      "const BEHAVIOR_QUERY_BUILD = 'funnel-daily-v2'\n"
      + "const funnelSource = 'analytics_daily+behaviors'\n"
      + 'async function loadBehaviorsWithMeta(startTs, endTs, limit) {\n'
      + '  const res = await db.collection("user_behaviors").where({ dateKey: _.in(chunk) }).get()\n'
      + "  meta.queryMode = 'dateKey_in'\n"
      + '}\n'
      + 'async function overview() { buildFunnel(rows, daily) }\n',
    erpPageSrc:
      "behaviorRows = await fetchCollectionWhere(\n  'user_behaviors',\n  { dateKey: _.gte(start).and(_.lte(end)) },\n  1000\n)",
  }
  const alignCases = [
    ['G 段：读写对齐时不报错', goodAlign, 0],
    [
      'G 段：写侧缺 timestamp 必须报错',
      { ...goodAlign, trackSrc: 'async function writeBehavior() { doc.userId = x }\n' },
      1,
    ],
    [
      'G 段：写侧缺 userId 必须报错',
      { ...goodAlign, trackSrc: 'async function writeBehavior() { doc.timestamp = 1 }\n' },
      1,
    ],
    [
      'G 段：loadBehaviors 只按 timestamp 必须报错',
      {
        ...goodAlign,
        dashboardSrc:
          'async function loadBehaviorsWithMeta(startTs, endTs, limit) {\n'
          + '  await db.collection("user_behaviors").where({ timestamp: _.gte(a).and(_.lte(b)) }).get()\n'
          + '}\n'
          + 'async function overview() {}\n',
      },
      1,
    ],
    [
      'G 段：ERP 仍按 timestamp 拉明细必须报错',
      {
        ...goodAlign,
        erpPageSrc:
          "behaviorRows = await fetchCollectionWhere(\n  'user_behaviors',\n  { timestamp: _.gte(ms).and(_.lte(me)) },\n  1000\n)",
      },
      1,
    ],
  ]
  for (const [name, input, want] of alignCases) {
    const got = checkBehaviorFieldAlignment(input).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }

  // ── 真实注入：证明 E 段判据在真实文件上也真的会红（写完立即还原）──
  // ⚠️ 会写源码 → 必须在**隔离 worktree** 里跑 `--selftest`。
  const inject = (file, from, to, why, { all = false } = {}) => {
    const backup = readFileSync(file, 'utf8')
    if (backup.indexOf(from) < 0) {
      console.error(`✗ selftest 注入点找不到（源码已变，注入失效）：${why}`)
      process.exit(1) // 尚未写盘，退出安全
    }
    let ran = false
    let caught = false
    try {
      writeFileSync(file, all ? backup.split(from).join(to) : backup.replace(from, to))
      ran = true
      caught = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' }).status !== 0
    } finally {
      // ⚠️ 必须**先还原再判成败**：Node 的 `process.exit()` 不会执行挂起的 finally 块，
      //    把 exit 写在 try 里会把注入**留在源码中**（2026-09-20 实际踩到：app.js 被留成注入态）。
      writeFileSync(file, backup)
    }
    if (!ran || !caught) {
      console.error(`✗ selftest 失败：${why}，守卫居然没红（已还原源文件）`)
      process.exit(1)
    }
  }
  inject(CLOUD_TRACK, "'entrySource', ", '', '把 entrySource 从云端字段白名单里拿掉（归因会被静默丢弃）')
  inject(MP_APP_JS, 'this.maybeTrackQrMaterial(options);', '', '拆掉 onShow 里的物料码打点接线')
  inject(ERP_BEHAVIOR_PAGE, '`${ev.action}:${step}`', '`${GATE_ACTION}:${step}`',
    '把门禁漏斗合成 action 改回未定义的 GATE_ACTION（该类漏斗恒 0）')
  inject(
    CLOUD_TRACK,
    '  doc.timestamp = ts\n',
    '',
    '拆掉 writeBehavior 的 timestamp 写入（读侧按时间查恒空 → 漏斗全 0）'
  )
  inject(
    CLOUD_DASHBOARD,
    'dateKey: _.in(chunk)',
    'timestamp: _.in(chunk)',
    '把 loadBehaviors 主路径改回不按 dateKey（明细恒空 → 漏斗全 0）',
    { all: true }
  )

  if (failed) {
    console.error(`\n自检失败 ${failed} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：守卫能抓到「ERP 缺事件 / 未登记触发点 / 缺前缀 / 模块不同构 / 读写字段错配」')
}
/** 物料码契约（E 段）—— 单独一段，便于 selftest 注入时精确定位 */
function checkMaterials() {
  const mpSchemaSrc = readFileSync(MP_SCHEMA, 'utf8')
  const erpSchemaSrc = readFileSync(ERP_SCHEMA, 'utf8')
  const qr = loadQrMaterial()
  const mpMaterials = parseQrMaterials(readFileSync(MP_QR_MATERIAL, 'utf8'))
  const problems = checkQrMaterials({
    mpMaterials,
    erpMaterials: parseQrMaterials(erpSchemaSrc),
    registered: registeredPages(readFileSync(MP_APP_JSON, 'utf8')),
    mpEvents: parseEvents(mpSchemaSrc),
    erpEvents: parseEvents(erpSchemaSrc),
    cloudSrc: readFileSync(CLOUD_TRACK, 'utf8'),
    appSrc: readFileSync(MP_APP_JS, 'utf8'),
    payloadSrc: readFileSync(MP_ANALYTICS_INDEX, 'utf8'),
    sessionSrc: readFileSync(MP_SESSION, 'utf8'),
    parse: qr.parseQrMaterial,
    entrySourceOf: qr.entrySourceOf,
  })
  // 未登记物料不得被误归因（否则报表里会冒出无漏斗的孤儿来源）
  for (const bad of ['s3', 'from=store_qr&k=otherwall', '', 'a1b2c3d4e5f60718293a4b5c']) {
    const got = qr.parseQrMaterial(bad)
    if (got) problems.push(`E: 未登记 scene '${bad}' 被误归因为 '${got}'`)
  }
  // F 段：门禁漏斗合成 action（在 ERP 行为看板里，与物料漏斗同页）
  if (existsSync(ERP_BEHAVIOR_PAGE)) {
    problems.push(...checkGateExpansion(readFileSync(ERP_BEHAVIOR_PAGE, 'utf8')))
  } else {
    problems.push('F: 找不到 admin/src/components/BehaviorAnalytics.vue（行为看板/物料码监测所在页）')
  }
  // G 段：写入字段 ↔ 报表读查询（漏斗全 0 的根因棘轮）
  if (!existsSync(CLOUD_DASHBOARD)) {
    problems.push('G: 找不到 getAnalyticsDashboard/index.js')
  } else {
    problems.push(
      ...checkBehaviorFieldAlignment({
        trackSrc: readFileSync(CLOUD_TRACK, 'utf8'),
        dashboardSrc: readFileSync(CLOUD_DASHBOARD, 'utf8'),
        erpPageSrc: existsSync(ERP_BEHAVIOR_PAGE) ? readFileSync(ERP_BEHAVIOR_PAGE, 'utf8') : '',
      })
    )
  }
  return { problems, materials: mpMaterials || [] }
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  for (const p of [MP_SCHEMA, MP_CONSTANTS, ERP_SCHEMA, MP_QR_MATERIAL, CLOUD_TRACK, MP_APP_JSON]) {
    if (!existsSync(p)) {
      console.error(`✗ 找不到文件 ${p}`)
      process.exit(1)
    }
  }
  const mpSchemaSrc = readFileSync(MP_SCHEMA, 'utf8')
  const mpConstSrc = readFileSync(MP_CONSTANTS, 'utf8')
  const erpSchemaSrc = readFileSync(ERP_SCHEMA, 'utf8')

  const files = walk(MP_ROOT).map((p) => ({ path: p.replace(`${ROOT}/`, ''), src: readFileSync(p, 'utf8') }))
  const problems = checkAll({
    mpEvents: parseEvents(mpSchemaSrc),
    erpEvents: parseEvents(erpSchemaSrc),
    mpModules: parseModules(mpConstSrc),
    erpModules: parseModules(erpSchemaSrc),
    triggered: extractTriggered(files),
    prefixes: parsePrefixMap(mpConstSrc),
    giftModule: 'GIFT',
  })
  const mat = checkMaterials()
  problems.push(...mat.problems)

  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n埋点 schema 一致性未通过：${problems.length} 处问题`)
    process.exit(1)
  }
  console.log(
    `✓ 埋点 schema 一致（小程序 ${parseEvents(mpSchemaSrc).size} 事件 / ERP ${parseEvents(erpSchemaSrc).size} 事件 / 模块 ${parseModules(mpConstSrc).size} 个）`
    + ` · 物料码 ${mat.materials.length} 张：目标页/转化事件/云端归因字段/入口接线均已核`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
