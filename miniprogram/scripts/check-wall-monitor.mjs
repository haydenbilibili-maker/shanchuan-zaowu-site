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
// 小程序实际发出的 step（字面量 + `fail_${reason}` 模板）
const emittedSteps = new Set([...pageSrc.matchAll(/step:\s*'([a-z_]+)'/g)].map((m) => m[1]))
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
const REPORT_COVERED_GATES = ['identify_save_atlas_gate', 'identify_result_gate', 'wish_wall_register_gate', 'wish_ritual_gate']
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
  { gate: 'wish_ritual_gate', payload: /ritualGate:\s*gateBlock\('wish_ritual_gate'\)/, view: /\.funnel\.wishWall\.ritualGate\.show/ }
]
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
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const target = resolve(ROOT, inj.file)
    const original = readFileSync(target, 'utf8')
    if (!original.includes(inj.from)) {
      console.error(`  ✗ 注入「${inj.name}」锚点没找到`)
      bad += 1
      continue
    }
    let caught = false
    try {
      writeFileSync(target, original.replace(inj.from, inj.to))
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
