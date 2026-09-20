#!/usr/bin/env node
/**
 * 祈福墙「注册转化监测表」守卫（需求 28 · 注册转化监测）
 *
 * 这张表最危险的失败不是报错，而是**静默显示 0**：口径里 action 名打错、step 没人发、
 * 转化率把"分母为 0"写成 0% —— 每一种都会让人得出"门店引流没用"的错误结论。
 * （本仓已有先例：祈福墙漏斗因为合成行只覆盖 identify 而**恒为 0**，见 BehaviorAnalytics.vue。）
 *
 * 所以守卫做三方对账：
 *   ① 表里的每个 action 必须在 `eventSchema` 里登记；
 *   ② 表里的每个 step 必须①出现在 `analyticsSchema.FUNNELS` 的步骤声明里，②**真的被小程序发出**（扫源码）；
 *   ③ 页面把"带 step 的漏斗事件"从 FUNNELS **派生**（不许再写死单个 action —— 那正是恒 0 的根因）。
 * 另加两条纯逻辑断言（分母为 0 → null 而不是 0；UV 去重）。
 *
 * 用法：
 *   node miniprogram/scripts/check-wall-monitor.mjs
 *   node miniprogram/scripts/check-wall-monitor.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const MONITOR_UTIL = 'admin/src/utils/wishWallMonitor.js'
const ERP_SCHEMA = 'admin/src/utils/analyticsSchema.js'
const MP_SCHEMA = 'miniprogram/utils/analytics/eventSchema.js'
const WALL_PAGE = 'miniprogram/subpackages/feature/wish-wall/index.js'
const ERP_VIEW = 'admin/src/components/BehaviorAnalytics.vue'

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')

/* ── 源码级：解析 trackBehavior 调用（端到端对账用；见 §②b） ──────────────
 * 旧版守卫全用**合成行**（`{ action:'wish_wall_post', targetId:'ok' }`）自测，
 * 从不读客户端**实发**的 targetId —— 所以 P1-3（页面实发 targetId='1'、报表按 'ok' 过滤）
 * 能稳稳穿 27/27 全绿。下面这组解析器就是"把客户端真发了什么读出来"的最小工具。 */

/** 去掉注释但**保持长度不变**（注释字符换成空格）：这样解析出的下标可直接用于改写原源码，
 *  且不会把注释里"写过的调用"当成真的发过。感知字符串/模板串，避免误伤 `'https://…'`。 */
function stripComments(src) {
  const out = src.split('')
  let quote = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1 }
      i -= 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' '
        i += 1
      }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 1 }
      continue
    }
  }
  return out.join('')
}

/** 字符串字面量取值；不是字面量（变量/模板/表达式）返回 null —— 不猜。 */
function literalOf(raw) {
  const s = String(raw == null ? '' : raw).trim()
  const m = /^'([^'\\]*)'$/.exec(s) || /^"([^"\\]*)"$/.exec(s)
  return m ? m[1] : null
}

/** 从 `start`（'(' 之后）解析一层实参，返回 [{ raw, start, end }]（下标相对 src） */
function parseCallArgs(src, start) {
  const args = []
  let depth = 0
  let quote = ''
  let argStart = start
  const push = (end) => {
    const raw = src.slice(argStart, end)
    const lead = raw.length - raw.replace(/^\s+/, '').length
    const trail = raw.length - raw.replace(/\s+$/, '').length
    args.push({ raw: raw.trim(), start: argStart + lead, end: end - trail })
  }
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (ch === ')' && depth === 0) { push(i); return { args, end: i } }
      depth -= 1
      continue
    }
    if (ch === ',' && depth === 0) { push(i); argStart = i + 1; continue }
  }
  return { args, end: -1 }
}

/** 找出源码里所有 `trackBehavior('<action>', …)` 调用。 */
function findTrackCalls(src, action) {
  const out = []
  const re = /trackBehavior\s*\(/g
  let m
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index)
    const { args } = parseCallArgs(src, open + 1)
    if (args.length && literalOf(args[0].raw) === action) out.push({ args, index: m.index })
  }
  return out
}

/** 报表期望的"带 target 的口径"：{ row, action, target }（判据的事实源是 wishWallMonitor 本身） */
function wallTargetExpectations() {
  const out = []
  monitor.WALL_MONITOR_ROWS.forEach((row) => {
    if (!row.target) return
    ;(row.actions || []).forEach((action) => out.push({ row: row.key, action, target: String(row.target) }))
  })
  return out
}

/** 把源码里某 action 调用的第 3 实参（targetId）改写为字面量 `'value'`；找不到就原样返回。 */
function setTrackTarget(src, action, value) {
  const targets = findTrackCalls(stripComments(src), action).filter((c) => c.args.length >= 3)
  if (!targets.length) return src
  let out = src
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const a = targets[i].args[2]
    out = out.slice(0, a.start) + `'${value}'` + out.slice(a.end)
  }
  return out
}

const monitor = await import(pathToFileURL(resolve(ROOT, MONITOR_UTIL)).href)
const erpSchemaSrc = read(ERP_SCHEMA)
const mpSchemaSrc = read(MP_SCHEMA)
const pageSrc = read(WALL_PAGE)
const viewSrc = read(ERP_VIEW)

/* ── ① action 必须在事件登记表里 ─────────────────────────────────────── */
const declaredActions = new Set([...mpSchemaSrc.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]))
check('能读出小程序事件登记表（判据的输入必须真实存在）', declaredActions.size > 50, `${declaredActions.size} 个`)
const badActions = []
monitor.WALL_MONITOR_ROWS.forEach((row) => {
  (row.actions || []).forEach((a) => { if (!declaredActions.has(a)) badActions.push(`${row.key}→${a}`) })
})
check('★ 表里每个 action 都在 eventSchema 里登记（打错字 = 这一行永远是 0）', badActions.length === 0, badActions.join(' / '))

/* ── ② step 必须在漏斗声明里，且真的被小程序发出 ──────────────────────── */
const funnelStepActions = new Map() // action → Set(step)
;[...erpSchemaSrc.matchAll(/action:\s*'([a-z0-9_]+):([a-z0-9_]+)'/g)].forEach((m) => {
  if (!funnelStepActions.has(m[1])) funnelStepActions.set(m[1], new Set())
  funnelStepActions.get(m[1]).add(m[2])
})
// 实测：ERP schema 里共 3 个带 step 的漏斗事件（identify 两个 + 祈福墙一个，9 条步骤声明）。
// 断言"至少覆盖祈福墙这一个"才是真正要保的东西 —— 数字写大了会变成假红。
check(
  '能读出 ERP 漏斗的步骤声明，且包含祈福墙那个（判据的输入必须真实存在）',
  funnelStepActions.size >= 3 && funnelStepActions.has('wish_wall_register_gate'),
  `${funnelStepActions.size} 个漏斗事件：${[...funnelStepActions.keys()].join('/')}`
)
// 小程序实际发出的 step（字面量 + `fail_${reason}` 模板）。
// ⚠️ 2026-09-21（P2-8）：`resume_success` 变成**按续发真实结果分支**的取值
// `this.trackRitualGate(ok === true ? 'resume_success' : 'fail_resume')` ——
// 它不再是 `step: '...'` 的**键值**形态，旧正则只认 `step:` 会**假报**"小程序没有发出"。
// 现在把 `trackRitualGate('...')` 的第一个实参也算作"真的发出了"（这正是本判据要保的东西：
// step 字符串在页面上真实存在，用户行为真的能落进这张表的行里）。
// 只收**像 step 的字面量**（小写+下划线），不会把同一方法调用里的 `resumeWishBase` 之类标识符收进来。
const emittedSteps = new Set([
  ...[...pageSrc.matchAll(/step:\s*'([a-z_]+)'/g)].map((m) => m[1]),
  // 收口形态：`trackRitualGate('show')` / `trackRitualGate(cond ? 'a' : 'b')`
  // —— 把整段调用的实参里的所有字符串字面量都算作"页面真的会发出这个 step"。
  ...[...pageSrc.matchAll(/trackRitualGate\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])),
])
const emittedPrefixes = [...pageSrc.matchAll(/step:\s*`([a-z_]+)\$\{/g)].map((m) => m[1])
const badSteps = []
monitor.WALL_MONITOR_ROWS.forEach((row) => {
  if (!row.step && !row.stepPrefix) return
  const action = (row.actions || [])[0]
  const declared = funnelStepActions.get(action)
  if (row.step && (!declared || !declared.has(row.step))) badSteps.push(`${row.key}：漏斗未声明 ${action}:${row.step}`)
  if (row.step && !emittedSteps.has(row.step)) badSteps.push(`${row.key}：小程序没有发出 step=${row.step}`)
  if (row.stepPrefix && !emittedPrefixes.includes(row.stepPrefix)) badSteps.push(`${row.key}：小程序没有发出 ${row.stepPrefix}* 前缀`)
})
check('★ 表里每个 step 都被漏斗声明、且**真的被小程序发出**（否则这一行恒 0）', badSteps.length === 0, badSteps.join(' / '))
check(
  '门店来源口径与页面埋点一致（entryFrom 会被写进 targetId/from）',
  /trackBehavior\('wish_wall_enter', 'from', this\.data\.entryFrom\)/.test(pageSrc) &&
    monitor.WALL_SOURCES.some((s) => s.key === 'store_qr')
)

/* ── ②b 端到端一致性：客户端**实发**的 targetId 必须等于监测表**期望**的 target ──
 *
 * P1-3 的真问题：页面实发 `trackBehavior('wish_wall_post', 'ok', '1')`（targetId='1'），
 * 而表口径 `target: 'ok'` → 「落愿成功」行**恒 0**。旧守卫只对"合成行"自测，
 * 从不读客户端实发值，所以 27/27 全绿也盖不住。这条断言把"表要什么"与"页面真发了什么"直接对账。
 * （同类若有其它带 target 的口径，一并覆盖；当前 WALL_MONITOR_ROWS 里只有 post 一条。） */
const pageStripped = stripComments(pageSrc)
const targetMismatches = []
wallTargetExpectations().forEach(({ row, action, target }) => {
  const calls = findTrackCalls(pageStripped, action)
  if (!calls.length) { targetMismatches.push(`${row}：页面没有发出 ${action}`); return }
  const withId = calls.filter((c) => c.args.length >= 3)
  if (!withId.length) { targetMismatches.push(`${row}：${action} 调用没有第 3 实参（targetId）`); return }
  withId.forEach((c) => {
    const actual = literalOf(c.args[2].raw)
    if (actual === null) {
      // 不是字面量 = 本判据无法对账；按 E16，无法判定不得算通过
      targetMismatches.push(`${row}：${action} 的 targetId 不是字符串字面量，无法对账（${c.args[2].raw}）`)
    } else if (actual !== target) {
      targetMismatches.push(`${row}：客户端实发 ${action} targetId='${actual}' ≠ 监测表期望 '${target}'`)
    }
  })
})
check(
  '★ 端到端一致性：客户端实发 targetId == 监测表期望值（不一致 = 这一行恒 0；P1-3 就是这么漏掉的）',
  targetMismatches.length === 0,
  targetMismatches.join(' / ')
)

/* ── ③ 页面从 FUNNELS 派生（不许再写死单个 action） ───────────────────── */
check(
  '★ 带 step 的漏斗事件由 analyticsSchema.FUNNELS 派生（写死单个 action 就是恒 0 的根因）',
  /const STEP_GATE_ACTIONS = Array\.from\(new Set\(/.test(viewSrc) &&
    /FUNNELS[\s\S]{0,120}?flatMap\(\(f\) => \(f\.steps \|\| \[\]\)\)/.test(viewSrc) &&
    !/const GATE_ACTION = 'identify_save_atlas_gate'/.test(viewSrc)
)
check(
  '监测表已接进行为分析页（导入 + 渲染 + 用同一份 user_behaviors 明细）',
  /from '\.\.\/utils\/wishWallMonitor'/.test(viewSrc) &&
    /buildWallMonitor\(/.test(viewSrc) &&
    /祈福墙 · 注册转化监测表/.test(viewSrc)
)

/* ── ③b 小程序数据报表也必须算这一块（产品反馈"数据报表里没有祈福墙数据"）─────
   这是**第二次**出现"漏了一个漏斗面"：ERP 那边曾经只展开 identify 的 step（恒 0），
   小程序报表这边则压根没有祈福墙卡片。所以判据做成**系统性**的：凡是在 eventSchema 里
   登记的 `*_gate` 漏斗事件，都必须同时出现在①报表云函数的分桶逻辑 ②报表页的渲染里。 */
const DASH_FN = 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js'
const MP_REPORT = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
const dashFnSrc = read(DASH_FN)
const reportViewSrc = read(MP_REPORT)
const gateEvents = [...mpSchemaSrc.matchAll(/^\s{2}([a-z0-9_]+_gate):\s*\{/gm)].map((m) => m[1])
check('能读出登记在案的注册钩子事件（判据的输入必须真实存在）', gateEvents.length >= 3, gateEvents.join('/'))

/**
 * 数据报表**应当覆盖**的钩子（本期范围）+ 明确排除的（写清理由）。
 * ⚠️ 判据是"schema 里每个 gate 必须落在两者之一"：**新登记一个钩子却忘了进报表，这里立刻红** ——
 * 这正是"漏一个漏斗面"这类错误的棘轮（ERP 恒 0、报表少卡片，已经发生过两次）。
 */
const REPORT_COVERED_GATES = ['identify_save_atlas_gate', 'identify_result_gate', 'wish_wall_register_gate', 'wish_ritual_gate', 'muyu_cert_gate']
const REPORT_EXCLUDED_GATES = {
  wiki_register_gate: '百科注册门禁未进本期数据报表（另立需求；它有独立入口与口径）'
}
const unclassified = gateEvents.filter(
  (a) => !REPORT_COVERED_GATES.includes(a) && !REPORT_EXCLUDED_GATES[a]
)
check(
  '★ 每个注册钩子要么进报表、要么显式排除（新钩子不登记就红，不许静默漏掉）',
  unclassified.length === 0,
  unclassified.join(' / ')
)
// 成对判定：云函数**返回**这个块 + 报表页**引用**这个块。只查一半等于没查
// （第一版只查 action 字符串，结果"把 wishWall 块改名"这种注入抓不到 —— 自检抓出来的）
const COVERED_PAIRS = [
  { gate: 'identify_save_atlas_gate', payload: /identify:\s*\{[\s\S]{0,1400}?gate:\s*\{/, view: /\.funnel\.identify\.gate\.show/ },
  { gate: 'identify_result_gate', payload: /resultGate:\s*gateBlock\('identify_result_gate'\)/, view: /\.funnel\.identify\.resultGate\.show/ },
  { gate: 'wish_wall_register_gate', payload: /wishWall:\s*\{[\s\S]{0,800}?gate:\s*\{/, view: /\.funnel\.wishWall\.gate\.show/ },
  // 2026-09-20 新增：连灯记录云存钩子。ratchet 的作用就在这条 ——
  // 新登记一个 *_gate 若忘了进报表，上面的 unclassified 立刻红
  { gate: 'wish_ritual_gate', payload: /ritualGate:\s*gateBlock\('wish_ritual_gate'\)/, view: /\.funnel\.wishWall\.ritualGate\.show/ },
  // 2026-09-20 新增：创新钩子 H2「功德证」领取钩子。ratchet 的作用就在这里 ——
  // 新登记一个 *_gate 若忘了进报表，上面的 unclassified 立刻红
  { gate: 'muyu_cert_gate', payload: /certGate:\s*gateBlock\('muyu_cert_gate'\)/, view: /\.funnel\.wishWall\.certGate\.show/ }
]
/* ── P2-7 报表侧（2026-09-21）：`wish_wall_play` 被**页头藏品 chip** 复用 ——
 * 那里没有任何玩法发生（`targetType='product'`，玩法一律 `'play'`）。
 * 为什么必须**两侧一起**钉：ERP 监测表与小程序的数字**必须能对上**（本文件头注的既定约束）；
 * 只改一侧 → 两边数字不一致，而且「参与玩法」被无玩法的点击抬高（分母是进页 UV → 可 >100%）。 */
{
  const engageRow = (monitor.WALL_MONITOR_ROWS || []).find((r) => r.key === 'engage')
  check(
    '★ ERP engage 行排除 targetType=product（页头 chip 的商品点击不算「参与玩法」）',
    !!engageRow && Array.isArray(engageRow.excludeTargetTypes) && engageRow.excludeTargetTypes.includes('product'),
    engageRow ? JSON.stringify(engageRow.excludeTargetTypes || null) : 'engage 行不存在'
  )
  check(
    '★ 小程序报表的「参与玩法」同样排除 targetType=product（与 ERP 同口径，两边数字才能对上）',
    /action === 'wish_wall_play'[\s\S]{0,140}?targetType[^\n]*!==\s*'product'/.test(dashFnSrc),
    '未在 getAnalyticsDashboard 里找到 wish_wall_play 的 product 排除'
  )
}

COVERED_PAIRS.forEach(({ gate, payload, view }) => {
  check(
    `★ ${gate}：报表云函数返回了对应的漏斗块（不返回 = 那一块在数据报表里恒 0）`,
    payload.test(dashFnSrc),
    gate
  )
  check(
    `★ ${gate}：数据报表页画了对应卡片（不画 = 报表里根本看不到它）`,
    view.test(reportViewSrc),
    gate
  )
})
check(
  '祈福墙漏斗块把「去注册」也算进去（只有曝光与完成，中间那段永远是黑箱）',
  /wallStep\('go_register'\)/.test(dashFnSrc) && /step: 'go_register'/.test(pageSrc) &&
    /bind:cta="onRegisterDialogCta"/.test(read('miniprogram/subpackages/feature/wish-wall/index.wxml'))
)

/* ── ④ 纯逻辑：分母 0 → null；UV 去重 ─────────────────────────────────── */
check('★ 转化率分母为 0 时返回 null（返回 0% 会被读成"转化极差"，而真相是"没曝光"）',
  monitor.rate(0, 0) === null && monitor.rate(1, 0) === null && monitor.rate(1, 4) === 25)
const FX = [
  { action: 'wish_wall_enter', targetId: 'store_qr', userId: 'u1' },
  { action: 'wish_wall_enter', targetId: 'store_qr', userId: 'u1' },
  { action: 'wish_wall_enter', targetId: 'detail', userId: 'u2' },
  { action: 'wish_wall_lamp', userId: 'u1' },
  { action: 'wish_wall_register_gate', step: 'show', userId: 'u3' },
  { action: 'wish_wall_register_gate', step: 'resume_success', userId: 'u3' },
  { action: 'wish_wall_post', targetId: 'ok', userId: 'u3' },
  { action: 'wish_wall_post', targetId: 'ok', userId: 'u9' },
  { action: 'other_module_action', userId: 'u9' }
]
const t = monitor.buildWallMonitor(FX)
const rowOf = (k) => t.steps.find((s) => s.key === k)
check('★ UV 去重（同一用户刷两次只算 1 人，次数仍算 2）',
  rowOf('enter').count === 3 && rowOf('enter').uv === 2 && rowOf('enterStore').count === 2 && rowOf('enterStore').uv === 1)
check('转化率按"上一环"算（门店扫码占进墙 66.7%）', rowOf('enterStore').rate === 66.7 && rowOf('enter').rate === null)
check('非祈福墙事件不混进来（other_module_action 不计入任何一行）',
  t.steps.every((s) => s.count <= FX.length) && t.steps.find((s) => s.key === 'engage').count === 1)
check('来源拆分：门店码 / 详情页 / 其它三桶齐全，且互不重叠',
  t.sources.map((s) => s.key).join(',') === 'store_qr,detail,__other__' &&
    t.sources.find((s) => s.key === 'store_qr').enter === 2 &&
    t.sources.find((s) => s.key === 'detail').enter === 1)
check('空数据：hasData=false（UI 据此显示"暂无埋点"而不是一张全 0 的假表）',
  monitor.buildWallMonitor([]).hasData === false && monitor.buildWallMonitor(null).hasData === false)
check('properties 里的 step / from 也认（云端摊平前后两种形态）',
  monitor.stepOf({ properties: { step: 'show' } }) === 'show' &&
    monitor.fromOf({ properties: { from: 'store_qr' } }) === 'store_qr')

/* ── 汇总与自检 ───────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  const injections = [
    {
      name: '转化率把分母 0 写成 0%',
      file: MONITOR_UTIL,
      from: '  if (w <= 0) return null',
      to: '  if (w <= 0) return 0'
    },
    {
      name: 'UV 不去重',
      file: MONITOR_UTIL,
      from: '    const uid = userOf(ev)\n    if (uid) users.add(uid)',
      to: '    const uid = userOf(ev)\n    if (uid) users.add(`${uid}#${count}`)'
    },
    {
      name: '数据报表页读错祈福墙的键（卡片永远不渲染）',
      file: MP_REPORT,
      from: '{{analyticsReport.behavior.funnel.wishWall.gate.show || 0}}',
      to: '{{analyticsReport.behavior.funnel.wishWallOff.gate.show || 0}}'
    },
    {
      name: '报表云函数不再返回祈福墙漏斗块',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: '    wishWall: {\n      enter: wallEnter,',
      to: '    wishWallOff: {\n      enter: wallEnter,'
    },
    {
      name: '「看结果」钩子又漏出报表（与祈福墙同一类漏）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: "      resultGate: gateBlock('identify_result_gate')",
      to: "      resultGateOff: gateBlock('identify_result_gate')"
    },
    {
      name: '「去注册」这一环不再上报',
      file: WALL_PAGE,
      from: "    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'go_register' })",
      to: "    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'show' })"
    },
    {
      name: 'step 名打错（与漏斗/客户端不一致）',
      file: MONITOR_UTIL,
      from: "  { key: 'gateOk', label: '注册成功并自动续发', actions: ['wish_wall_register_gate'], step: 'resume_success'",
      to: "  { key: 'gateOk', label: '注册成功并自动续发', actions: ['wish_wall_register_gate'], step: 'resume_succes'"
    },
    // 2026-09-20 新增：连灯记录云存钩子同样要"进报表"（否则就是第三次"埋点发了、报表没有"）
    {
      name: '连灯云存钩子又漏出报表（与祈福墙同一类漏）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: "      ritualGate: gateBlock('wish_ritual_gate')",
      to: "      ritualGateOff: gateBlock('wish_ritual_gate')"
    },
    {
      name: '数据报表页读错连灯云存钩子的键（卡片永远不渲染）',
      file: MP_REPORT,
      from: '{{analyticsReport.behavior.funnel.wishWall.ritualGate.show || 0}}',
      to: '{{analyticsReport.behavior.funnel.wishWall.ritualGateOff.show || 0}}'
    },
    // 2026-09-20 新增：功德证钩子同样要"进报表"（否则就是第四次"埋点发了、报表没有"）
    {
      name: '功德证钩子又漏出报表（与祈福墙同一类漏）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: "      certGate: gateBlock('muyu_cert_gate')",
      to: "      certGateOff: gateBlock('muyu_cert_gate')"
    },
    {
      name: '数据报表页读错功德证钩子的键（卡片永远不渲染）',
      file: MP_REPORT,
      from: '{{analyticsReport.behavior.funnel.wishWall.certGate.show || 0}}',
      to: '{{analyticsReport.behavior.funnel.wishWall.certGateOff.show || 0}}'
    },
    // 2026-09-21 新增（P1-3 防复发）：落愿成功埋点 targetId 与报表口径**端到端**对账。
    // 两条注入各证明一半：①判据读了客户端实发值；②判据读了监测表期望值。
    {
      name: '落愿成功埋点 targetId 与监测表口径漂移（客户端实发 ≠ 表要 ok）',
      file: WALL_PAGE,
      apply: (src) => setTrackTarget(src, 'wish_wall_post', '__selftest_drift__')
    },
    {
      name: '监测表把落愿成功的 target 口径改掉（与客户端实发不再一致）',
      file: MONITOR_UTIL,
      from: "actions: ['wish_wall_post'], target: 'ok'",
      to: "actions: ['wish_wall_post'], target: 'posted'"
    },
    // 2026-09-21 新增（P2-7 报表侧）：两侧的 product 排除各证明一半 ——
    // 去掉任一侧，「参与玩法」都会被无玩法的商品点击抬高，且两边数字对不上。
    {
      name: 'ERP engage 行不再排除 product（页头 chip 被算成「参与玩法」）',
      file: MONITOR_UTIL,
      from: "of: 'enter', excludeTargetTypes: ['product'], desc:",
      to: "of: 'enter', desc:"
    },
    {
      name: '小程序报表的「参与玩法」不再排除 product（与 ERP 口径分叉）',
      file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
      from: "    (r) => r.action === 'wish_wall_play' && String(r.targetType || '') !== 'product'",
      to: "    (r) => r.action === 'wish_wall_play'"
    }
  ]
  let bad = 0
  // 0) 基线归一：P1-3 的**页面侧**由并行流修复，本 worktree 可能仍是实发 '1'。
  //    先按监测表期望值把页面源码里带 target 的口径归一到一致，再跑注入 —— 这样每条注入的
  //    "被检出"来自注入本身，而不是借用"页面还没修"这条红（否则全部注入都会假绿 = 自检失效，E7/E16）。
  const trueOriginals = new Map()
  const readTrue = (f) => {
    const abs = resolve(ROOT, f)
    if (!trueOriginals.has(abs)) trueOriginals.set(abs, readFileSync(abs, 'utf8'))
    return trueOriginals.get(abs)
  }
  const alignNotes = []
  try {
    for (const { action, target } of wallTargetExpectations()) {
      const cur = readTrue(WALL_PAGE)
      const next = setTrackTarget(cur, action, target)
      if (next !== cur) {
        writeFileSync(resolve(ROOT, WALL_PAGE), next)
        alignNotes.push(`${action} targetId → '${target}'`)
      }
    }
    if (alignNotes.length) {
      console.log(`  · 自检前置归一（页面侧并行修复前的兜底）：${alignNotes.join('；')}`)
    }
    // 0b) 归一后基线必须全绿；否则"注入被检出"可能只是基线本来就红 —— 那样的自检不证明任何事
    const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    if (base.status !== 0) {
      console.error('  ✗ 自检基线非全绿 —— 注入结果不可信（先修红，再跑自检）')
      console.error((base.stdout || '') + (base.stderr || ''))
      bad += 1
    } else {
      for (const inj of injections) {
        const target = resolve(ROOT, inj.file)
        const original = readFileSync(target, 'utf8')
        let mutated = null
        if (typeof inj.apply === 'function') mutated = inj.apply(original)
        else if (original.includes(inj.from)) mutated = original.replace(inj.from, inj.to)
        if (mutated == null || mutated === original) {
          // 锚点失效必须判失败（E18-b）：否则重构后注入会静默全废
          console.error(`  ✗ 注入「${inj.name}」锚点没找到`)
          bad += 1
          continue
        }
        let caught = false
        try {
          writeFileSync(target, mutated)
          const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
          caught = run.status !== 0
        } finally {
          writeFileSync(target, original)
        }
        if (caught) console.log(`  ✓ 注入「${inj.name}」被检出`)
        else {
          bad += 1
          console.error(`  ✗ 注入「${inj.name}」未被检出（判据没接上）`)
        }
      }
    }
  } finally {
    for (const [abs, content] of trueOriginals) writeFileSync(abs, content)
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${injections.length} 条注入全部被检出，源文件已还原`)
  process.exit(0)
}

console.log(`祈福墙注册转化监测表：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 口径↔事件登记表↔漏斗声明↔客户端实发 四方一致，且转化率/UV 语义正确')
