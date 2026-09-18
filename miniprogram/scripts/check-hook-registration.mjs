#!/usr/bin/env node
/**
 * 「钩子登记链」守卫 —— 把两条**静态可机械判定**的登记链变成可证明的一条链。
 *
 * 为什么需要（有实测依据，见 docs/创新钩子方案_2026-09-19.md §1.3 / §4.2）：
 *   ① 新增一个 `showXxx` 开关要改**五处**（云函数 DEFAULT_FLAGS / normalizeFlags / saveFlags、
 *      小程序 normalizeContentDisplayFlags、后台开关表单），漏一处就**静默失效**。
 *      实测已发生：`showMaShangYou` 的 ERP 开关行曾漏补（docs/需求26…）；
 *      2026-09-19 又实测到「`saveFlags()` 漏字段 → 后台保存成功但字段被静默重置」。
 *   ② 新增一个漏斗 action 要在**多处登记**（双端 schema + ERP `FUNNELS` 卡 + 报表分桶），
 *      漏了就是「**埋点发了、报表没有**」（祈福墙 2026-09-18 已栽过一次）。
 *   AGENTS.md：同类错误第二次发生，必须补一条守卫或自检。
 *
 * 本守卫**只做**别人没守的那部分（先读后不重复造，2026-09-21）：
 *
 *   链 A · showXxx 五处登记（本守卫新增，此前无守卫）
 *     A2  云函数 getDefaultFlags / normalizeFlags / saveFlags 三处集合**两两相等**（集合，不是计数）
 *     A3  小程序 normalizeContentDisplayFlags 与云函数集合**相等**
 *     A4  链上每个 showXxx 必须**至少**出现在一个后台入口（ERP `form.showXxx` ∪ 店长端 `data-field`）
 *         —— 刻意**不要求两处都有**：实测后台是分工（`showGift`/`showLive`/`showMaShangYou`/`showStore`
 *         只在店长端；`showAchievements`/`showAtlas` 只在 ERP）。要求「两处都有」会一上线就一片假红。
 *     A5  后台入口不得出现「链上没有」的孤儿开关（否则是切了不生效的死开关；允许表见 ADMIN_ORPHAN_ALLOWED）
 *
 *   链 B · 漏斗 action 的登记链（只补缺口）
 *     B1  双端 `*_gate` 镜像 —— **已由 `check:analytics-schema` 守**（本守卫不重复，实测它 exit 1）
 *     B2  ERP `FUNNELS` 卡 —— **此前无人守**（实测：删掉 `wish_ritual_gate` 的卡，check:wall-monitor 仍 exit 0）。
 *         判据：每个 `*_gate` 必须在 FUNNELS 里有带 step 的卡，或被 FUNNEL_CARD_EXCLUDED **逐条带理由**排除；
 *         过期例外（已有卡 / 已不是 gate）判红 —— 例外只许变小。
 *     B3  报表分桶（getAnalyticsDashboard）与报表页 —— **已由 `check:wall-monitor` 守**
 *         （`REPORT_COVERED_GATES` + unclassified 棘轮 + 成对 payload/view 断言；实测 exit 1）。本守卫不重复。
 *
 * 判据边界（证不了什么）：
 *   · 只覆盖 `showXxx` 一族；`allowIosStoredValue` / `imageThumbEnabled` 这类非 show 前缀布尔旗
 *     **不在判据内**（同名问题同源，但本守卫按任务口径收窄；扩族需另立判据）。
 *   · 只证明「登记存在且集合自洽」，**不证明**默认值语义正确（`=== true` vs `!== false`）、
 *     不证明开关真的接进了页面渲染、不证明 store 里真的存了值。
 *   · 不校验 FUNNELS 卡的 step 名与 eventSchema `desc` 里的口径一致（desc 是散文，无法静态判定）。
 *   · 不校验报表页是否渲染（那是 check:wall-monitor 的成对断言）。
 *
 * 用法：
 *   node miniprogram/scripts/check-hook-registration.mjs
 *   node miniprogram/scripts/check-hook-registration.mjs --selftest
 * 退出码：有缺口 1；锚点失效（**无法判定**，E16）也是 1，但消息明确写「无法判定」。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const SELF = fileURLToPath(import.meta.url)
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')

const F = {
  mpFlags: 'miniprogram/utils/contentDisplayFlags.js',
  fnFlags: 'miniprogram/cloudfunctions/getContentDisplayFlags/index.js',
  erpFlags: 'admin/src/components/ContentDisplayFlags.vue',
  mgrWxml: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
  mpSchema: 'miniprogram/utils/analytics/eventSchema.js',
  erpSchema: 'admin/src/utils/analyticsSchema.js',
  // 报表分桶那一侧的排除清单（`REPORT_EXCLUDED_GATES`）—— 用于 B4「两本账必须同源」
  wallMonitor: 'miniprogram/scripts/check-wall-monitor.mjs',
}

/** 锚点失效 = **无法判定**，不是「通过」（AGENTS.md 错题本 E16） */
class Unjudgeable extends Error {}

/**
 * 允许「后台有、但链上没有」的孤儿开关。空 = 零容忍。
 * 每条必须写清理由；若某开关后来进了链，该条会因「过期例外」判红（例外只许变小）。
 * 例：{ showXxx: '只用于 ERP 内部灰度，C 端暂不读（产品 2026-xx-xx 确认）' }
 */
const ADMIN_ORPHAN_ALLOWED = {}

/**
 * 允许「已登记为漏斗、但故意不进 ERP FUNNELS 卡」的钩子。每条必须写清理由。
 * 与 check:wall-monitor 的 REPORT_EXCLUDED_GATES 同一理由（同一批钩子的另一个面）。
 */
const FUNNEL_CARD_EXCLUDED = {
  wiki_register_gate:
    '百科注册门禁钩子未进 ERP「漏斗」卡：口径与入口独立，另立需求（与 check:wall-monitor 的 REPORT_EXCLUDED_GATES 同理由）',
}

/* ─────────────────────────── 解析（纯函数） ─────────────────────────── */

const sorted = (s) => [...s].sort()
const diff = (a, b) => sorted(a).filter((x) => !b.has(x))
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
const union = (a, b) => new Set([...a, ...b])

/** 顶层函数体：从 `marker` 到其后第一个「行首 `}`」。锚点失效 → Unjudgeable */
function bodyOf(src, marker) {
  const i = src.indexOf(marker)
  if (i < 0) throw new Unjudgeable(`找不到锚点 \`${marker}\``)
  const end = src.indexOf('\n}', i)
  if (end < 0) throw new Unjudgeable(`锚点 \`${marker}\` 之后找不到顶层收尾 \`\\n}\``)
  return src.slice(i, end)
}

/** 对象字面量里的 `showXxx:` 键（要求行首缩进 + 冒号，避免把注释里的词算进来） */
function showKeys(body) {
  return new Set([...body.matchAll(/^[ \t]*(show[A-Z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]))
}

/** ERP 后台入口：整份组件里的 `form.showXxx`（v-model / applyFlags / reset 三处形态都认） */
function erpAdminFlags(src) {
  return new Set([...src.matchAll(/form\.(show[A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))
}

/**
 * 店长端后台入口：**同一标签**同时带 `bindchange="onContentFlagToggle"` 与 `data-field="showXxx"`。
 * 收窄到 `onContentFlagToggle`（内容开关面板专属处理器）—— 与 check-product-save-fields 用
 * `bindPInput` 圈定藏品表单同一手法，避免把同页别的表单的 `data-field` 算成假阳性。
 */
function mgrAdminFlags(src) {
  const out = new Set()
  for (const m of src.matchAll(/<[a-zA-Z-]+\b[^>]*>/g)) {
    const tag = m[0]
    if (!/bindchange="onContentFlagToggle"/.test(tag)) continue
    const f = /data-field="(show[A-Z][A-Za-z0-9]*)"/.exec(tag)
    if (f) out.add(f[1])
  }
  return out
}

/** eventSchema 里登记的 `*_gate` 漏斗事件 */
function gateEvents(src) {
  return new Set([...src.matchAll(/^\s{2}([a-z0-9_]+_gate):\s*\{/gm)].map((m) => m[1]))
}

/** ERP `FUNNELS` 里「有卡」的漏斗 action（卡的步骤形如 `action: 'wish_ritual_gate:show'`） */
function funnelCardActions(src) {
  const i = src.indexOf('export const FUNNELS')
  if (i < 0) throw new Unjudgeable('analyticsSchema 里找不到 `export const FUNNELS`')
  const end = src.indexOf('\n]', i)
  if (end < 0) throw new Unjudgeable('`export const FUNNELS` 之后找不到顶层 `\\n]` 收尾')
  const body = src.slice(i, end)
  if (!/action:\s*'/.test(body)) throw new Unjudgeable('FUNNELS 里一个 `action:` 都没解析到（格式变了？）')
  return new Set([...body.matchAll(/action:\s*'([a-z0-9_]+):[a-z0-9_]+'/g)].map((m) => m[1]))
}

/** 读全部输入（读不到就抛 Unjudgeable，绝不静默当空集） */
export function inspectChainA(src = {}) {
  const mpFlags = src.mpFlags ?? read(F.mpFlags)
  const fnFlags = src.fnFlags ?? read(F.fnFlags)
  const erpFlags = src.erpFlags ?? read(F.erpFlags)
  const mgrWxml = src.mgrWxml ?? read(F.mgrWxml)

  const mpBody = bodyOf(mpFlags, 'function normalizeContentDisplayFlags(')
  if (!/src\.show[A-Z]/.test(mpBody)) throw new Unjudgeable('小程序 normalize 体里没有 `src.showXxx`（函数被重写？）')
  const defBody = bodyOf(fnFlags, 'function getDefaultFlags(')
  if (!/return\s*\{/.test(defBody)) throw new Unjudgeable('云函数 getDefaultFlags 体里没有 `return {`')
  const normBody = bodyOf(fnFlags, 'function normalizeFlags(')
  if (!/const src\s*=\s*doc\b/.test(normBody)) throw new Unjudgeable('云函数 normalizeFlags 体里没有 `const src = doc`')
  const saveBody = bodyOf(fnFlags, 'async function saveFlags(')
  if (!/const incoming\s*=/.test(saveBody)) throw new Unjudgeable('云函数 saveFlags 体里没有 `const incoming =`（保存载荷被重写？）')

  if (!/content-display-flags/.test(erpFlags)) throw new Unjudgeable('ERP 组件不是 ContentDisplayFlags.vue（根节点变了？）')
  const erp = erpAdminFlags(erpFlags)
  const mgr = mgrAdminFlags(mgrWxml)
  if (!erp.size) throw new Unjudgeable('ERP 后台入口一个 `form.showXxx` 都没解析到')
  if (!mgr.size) throw new Unjudgeable('店长端后台入口一个 `data-field="showXxx"` 都没解析到')

  const out = { mp: showKeys(mpBody), fnDefault: showKeys(defBody), fnNormalize: showKeys(normBody), fnSave: showKeys(saveBody), erp, mgr }
  // 任一处理点解析为空 → 判据链断了，**无法判定**，绝不当「一致」放过去
  for (const k of ['mp', 'fnDefault', 'fnNormalize', 'fnSave']) {
    if (!out[k].size) throw new Unjudgeable(`${k} 处一个 showXxx 都没解析到（判据链断了）`)
  }
  return out
}

export function inspectChainB(src = {}) {
  const mpSchema = src.mpSchema ?? read(F.mpSchema)
  const erpSchema = src.erpSchema ?? read(F.erpSchema)
  const mpGates = gateEvents(mpSchema)
  if (!mpGates.size) throw new Unjudgeable('小程序 eventSchema 里一个 `*_gate` 都没解析到')
  return { gates: union(mpGates, gateEvents(erpSchema)), cards: funnelCardActions(erpSchema) }
}

/* ─────────────────────────── 判据（纯函数，可被自检喂合成输入） ─────────────────────────── */

export function evalChainA(input, allowedOrphans = ADMIN_ORPHAN_ALLOWED) {
  const { mp, fnDefault, fnNormalize, fnSave, erp, mgr } = input
  const problems = []
  const admin = union(erp, mgr)

  // A2：云函数三处枚举两两相等（集合相等 —— 「补一个老的 + 漏一个新的」这种 swap 计数骗术必红）
  if (!setEq(fnDefault, fnNormalize)) {
    problems.push(
      `A2: 云函数 getDefaultFlags 与 normalizeFlags 的 showXxx 集合不一致` +
        `（default\\normalize=[${diff(fnDefault, fnNormalize)}] normalize\\default=[${diff(fnNormalize, fnDefault)}]）`
    )
  }
  if (!setEq(fnDefault, fnSave)) {
    problems.push(
      `A2: 云函数 getDefaultFlags 与 saveFlags 的 showXxx 集合不一致` +
        `（default\\save=[${diff(fnDefault, fnSave)}] save\\default=[${diff(fnSave, fnDefault)}]）` +
        ` —— saveFlags 漏字段 = 后台保存成功、字段被静默重置`
    )
  }
  // A3：小程序 ↔ 云函数
  if (!setEq(mp, fnDefault)) {
    problems.push(
      `A3: 小程序 normalizeContentDisplayFlags 与云函数集合不一致` +
        `（小程序\\云函数=[${diff(mp, fnDefault)}] 云函数\\小程序=[${diff(fnDefault, mp)}]）`
    )
  }
  // A4：链上每个开关至少一个后台入口（**不要求两处都有** —— 后台是分工）
  const noAdmin = diff(mp, admin)
  if (noAdmin.length) {
    problems.push(
      `A4: 这些 showXxx 在 ERP 与店长端**两处都没有**入口（超管没法开关，等于静默失效）：${noAdmin.join(', ')}`
    )
  }
  // A5：后台孤儿开关（切了不生效的死开关）
  const orphans = diff(admin, mp).filter((f) => !allowedOrphans[f])
  if (orphans.length) {
    problems.push(
      `A5: 后台有、但链上没有的孤儿开关（切换不会生效）：${orphans.join(', ')}` +
        ` —— 要么在云函数 + 小程序登记它，要么在 ADMIN_ORPHAN_ALLOWED 登记理由`
    )
  }
  const staleAllowed = Object.keys(allowedOrphans).filter((f) => !admin.has(f) || mp.has(f))
  if (staleAllowed.length) {
    problems.push(`A5-stale: ADMIN_ORPHAN_ALLOWED 里有过期例外（该开关已不是孤儿）——例外只许变小：${staleAllowed.join(', ')}`)
  }
  return problems
}

/**
 * 两份「某漏斗故意不进 ERP 报表」的排除清单必须**同源**。
 *
 * 为什么要有这一条（2026-09-20 集成官复核时发现的风险）：
 *   同一个概念现在有**两本账** ——
 *   `check:wall-monitor` 的 `REPORT_EXCLUDED_GATES`（管**报表分桶**）
 *   与本守卫的 `FUNNEL_CARD_EXCLUDED`（管 **FUNNELS 卡**）。
 *   两本账各自漂移时会出现**互相矛盾**的结论：「分桶那边排除了、这边却以为该有卡」。
 *   （本守卫的作者自己也报过同类风险：`wall-monitor` 的 `REPORT_COVERED_GATES` 与
 *    `COVERED_PAIRS` 是两份清单。）
 *
 * 判据：两边的**键集合必须相等** —— 任一侧多/少都红，并点名差在哪一侧。
 * 这不是"新增判据"而是"防两本账打架"：本来该只有一本。
 */
export function evalExclusionParity(cardExcluded, reportExcluded) {
  const a = [...cardExcluded].sort()
  const b = [...reportExcluded].sort()
  const onlyCard = a.filter((x) => !b.includes(x))
  const onlyReport = b.filter((x) => !a.includes(x))
  const problems = []
  if (onlyCard.length) {
    problems.push(
      `B4: 这些钩子在 FUNNEL_CARD_EXCLUDED 里排除了，但 check:wall-monitor 的 REPORT_EXCLUDED_GATES **没排除**` +
        `（两本账打架）：${onlyCard.join(', ')}`
    )
  }
  if (onlyReport.length) {
    problems.push(
      `B4: 这些钩子在 REPORT_EXCLUDED_GATES 里排除了，但本守卫的 FUNNEL_CARD_EXCLUDED **没登记理由**：${onlyReport.join(', ')}`
    )
  }
  return problems
}

/** 从 check:wall-monitor 源码里取 `REPORT_EXCLUDED_GATES` 的键（取不到 = 无法判定，不许当通过） */
export function parseWallMonitorExcluded(src) {
  const i = src.indexOf('REPORT_EXCLUDED_GATES')
  if (i < 0) throw new Unjudgeable('check:wall-monitor 里找不到 REPORT_EXCLUDED_GATES（锚点失效）')
  const open = src.indexOf('{', i)
  const close = src.indexOf('}', open)
  if (open < 0 || close < 0) throw new Unjudgeable('REPORT_EXCLUDED_GATES 的对象字面量取不到')
  const body = src.slice(open + 1, close)
  return new Set([...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]))
}

export function evalChainB(input, excluded = FUNNEL_CARD_EXCLUDED) {
  const { gates, cards } = input
  const problems = []
  const noCard = sorted(gates).filter((g) => !cards.has(g) && !excluded[g])
  if (noCard.length) {
    problems.push(
      `B2: 这些漏斗 action 已登记为事件、但 ERP FUNNELS 里**没有卡**（看板画不出这条漏斗）：${noCard.join(', ')}` +
        ` —— 补一张卡，或在 FUNNEL_CARD_EXCLUDED 登记理由`
    )
  }
  const staleExcluded = Object.keys(excluded)
    .filter((g) => cards.has(g) || !gates.has(g))
    .sort()
  if (staleExcluded.length) {
    problems.push(`B2-stale: FUNNEL_CARD_EXCLUDED 里有过期例外（已有卡 / 已不是 gate）——例外只许变小：${staleExcluded.join(', ')}`)
  }
  return problems
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

function report() {
  const a = inspectChainA()
  const b = inspectChainB()
  const aProblems = evalChainA(a)
  const bProblems = evalChainB(b)
  // 两份排除清单必须同源（同一概念不许有两本会各自漂移的账）
  const reportExcluded = parseWallMonitorExcluded(read(F.wallMonitor))
  const parityProblems = evalExclusionParity(new Set(Object.keys(FUNNEL_CARD_EXCLUDED)), reportExcluded)

  const admin = union(a.erp, a.mgr)
  console.log('钩子登记链守卫（check:hook-registration）')
  console.log('【链 A · showXxx 五处登记】')
  console.log(`  小程序 normalizeContentDisplayFlags : ${a.mp.size}`)
  console.log(`  云函数 getDefaultFlags              : ${a.fnDefault.size}`)
  console.log(`  云函数 normalizeFlags               : ${a.fnNormalize.size}`)
  console.log(`  云函数 saveFlags                    : ${a.fnSave.size}`)
  console.log(`  后台 ERP form.showXxx               : ${a.erp.size}`)
  console.log(`  后台 店长端 data-field              : ${a.mgr.size}`)
  console.log(`  后台并集（ERP ∪ 店长端）             : ${admin.size}`)
  console.log(`  差集 default\\normalize=[${diff(a.fnDefault, a.fnNormalize)}]`)
  console.log(`  差集 default\\save=[${diff(a.fnDefault, a.fnSave)}] save\\default=[${diff(a.fnSave, a.fnDefault)}]`)
  console.log(`  差集 小程序\\云函数=[${diff(a.mp, a.fnDefault)}] 云函数\\小程序=[${diff(a.fnDefault, a.mp)}]`)
  console.log(`  差集 小程序\\(ERP∪店长端)=[${diff(a.mp, admin)}] (ERP∪店长端)\\小程序=[${diff(admin, a.mp)}]`)
  console.log(`  （分工实测：仅 ERP=[${diff(a.erp, a.mgr)}] · 仅店长端=[${diff(a.mgr, a.erp)}]）`)
  console.log('【链 B · 漏斗登记链】')
  console.log(`  双端 *_gate 事件（并集）            : ${b.gates.size}  ${sorted(b.gates).join(', ')}`)
  console.log(`  ERP FUNNELS 有卡的 gate             : ${sorted(b.cards).join(', ') || '(无)'}`)
  console.log(`  无卡（B2 判据）                     : [${sorted(b.gates).filter((g) => !b.cards.has(g))}]`)
  console.log(
    `  其中带理由排除（FUNNEL_CARD_EXCLUDED）: [${Object.keys(FUNNEL_CARD_EXCLUDED).sort()}]` +
      ` —— 有据的**刻意排除**（非漂移；与 check:wall-monitor 的 REPORT_EXCLUDED_GATES 同源，B4 会核两边同源）`
  )
  console.log(`  （B1 双端镜像 = check:analytics-schema；B3 报表分桶 = check:wall-monitor，本守卫不重复）`)

  const problems = [...aProblems, ...bProblems, ...parityProblems]
  if (problems.length) {
    problems.forEach((p) => console.error(`✗ ${p}`))
    console.error(`\n✗ 钩子登记链未通过：${problems.length} 处`)
    process.exit(1)
  }
  console.log('✓ 链 A：云函数三处 + 小程序 + 后台（≥1 处）集合自洽；链 B：每个 gate 有 FUNNELS 卡或带理由的例外')
}

function main() {
  try {
    report()
  } catch (e) {
    if (e instanceof Unjudgeable) {
      console.error(`⚠ 无法判定（锚点失效，不是「通过」）：${e.message}`)
      console.error('  判据的输入必须真实存在 —— 请同步修锚点或本守卫。')
      process.exit(1)
    }
    throw e
  }
}

/* ─────────────────────────── 自检 ─────────────────────────── */

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function selftest() {
  let ok = 0
  let bad = 0
  const t = (name, cond, extra) => {
    if (cond) {
      ok += 1
      console.log(`  ✓ ${name}`)
    } else {
      bad += 1
      console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
    }
  }
  const S = (...a) => new Set(a)

  console.log('① 判据的**窄**：分工不算漏、只在单侧后台的开关不许判红（纯逻辑）')
  // 基线：Alpha 只在 ERP；Beta/Gamma/Delta 只在店长端 —— 这正是本仓现状的分工形态
  const baseA = {
    mp: S('showAlpha', 'showBeta', 'showGamma', 'showDelta'),
    fnDefault: S('showAlpha', 'showBeta', 'showGamma', 'showDelta'),
    fnNormalize: S('showAlpha', 'showBeta', 'showGamma', 'showDelta'),
    fnSave: S('showAlpha', 'showBeta', 'showGamma', 'showDelta'),
    erp: S('showAlpha'),
    mgr: S('showBeta', 'showGamma', 'showDelta'),
  }
  t('基线（分工：ERP 只有 Alpha / 店长端只有 Beta·Gamma·Delta）通过', evalChainA(baseA).length === 0, evalChainA(baseA).join(' / '))
  // 反例 1：新增一个**只在店长端**的开关（两端登记齐全）→ 不该红
  const mgrOnly = {
    ...baseA,
    mp: S('showAlpha', 'showBeta', 'showGamma', 'showDelta', 'showManagerOnly'),
    fnDefault: S('showAlpha', 'showBeta', 'showGamma', 'showDelta', 'showManagerOnly'),
    fnNormalize: S('showAlpha', 'showBeta', 'showGamma', 'showDelta', 'showManagerOnly'),
    fnSave: S('showAlpha', 'showBeta', 'showGamma', 'showDelta', 'showManagerOnly'),
    mgr: S('showBeta', 'showGamma', 'showDelta', 'showManagerOnly'),
  }
  t('反例：只在**店长端**有的开关不被判红', evalChainA(mgrOnly).length === 0, evalChainA(mgrOnly).join(' / '))
  // 反例 2：只在 ERP 有的开关（Alpha）已经在基线里 → 同上，显式再列一条
  t('反例：只在 **ERP** 有的开关不被判红', evalChainA({ ...baseA, erp: S('showAlpha', 'showDelta'), mgr: S('showBeta', 'showGamma') }).length === 0)

  console.log('② 判据的**硬**：漏登记 / swap 骗术 / 孤儿开关必须红（纯逻辑）')
  const cases = [
    ['★ saveFlags 抽掉 Delta（后台保存成功但字段被静默重置）', { ...baseA, fnSave: S('showAlpha', 'showBeta', 'showGamma') }],
    [
      '★ swap 骗术：saveFlags 删 Delta 加 showEpsilon（计数不变，集合变了）',
      { ...baseA, fnSave: S('showAlpha', 'showBeta', 'showGamma', 'showEpsilon') },
    ],
    ['normalizeFlags 抽掉 Delta', { ...baseA, fnNormalize: S('showAlpha', 'showBeta', 'showGamma') }],
    ['小程序 normalize 抽掉 Delta（双端不同步）', { ...baseA, mp: S('showAlpha', 'showBeta', 'showGamma') }],
    ['后台两处都缺 Delta（谁都没法开关）', { ...baseA, mgr: S('showBeta', 'showGamma') }],
    ['后台多一个 showOrphan（切了不生效的死开关）', { ...baseA, mgr: S('showBeta', 'showGamma', 'showDelta', 'showOrphan') }],
  ]
  for (const [name, input] of cases) {
    const got = evalChainA(input)
    t(name, got.length > 0, '未被检出')
  }
  t('过期例外：ADMIN_ORPHAN_ALLOWED 里的开关已进链 → 红', evalChainA(baseA, { showBeta: 'x' }).length > 0)

  console.log('③ 链 B：FUNNELS 卡 + 例外棘轮（纯逻辑）')
  const baseB = { gates: S('wish_wall_register_gate', 'wiki_register_gate'), cards: S('wish_wall_register_gate') }
  const excl = { wiki_register_gate: '另立需求' }
  t('基线（wiki 带理由排除）通过', evalChainB(baseB, excl).length === 0, evalChainB(baseB, excl).join(' / '))
  t('★ 把 wish_wall_register_gate 的 FUNNELS 卡抽掉 → 必须红', evalChainB({ ...baseB, cards: S() }, excl).length > 0)
  t('★ 新登记一个 gate 却既没卡也没例外 → 必须红', evalChainB({ gates: S('brand_new_gate'), cards: S() }, excl).length > 0)
  t('★ 过期例外（wiki 已有卡）→ 必须红（例外只许变小）', evalChainB({ ...baseB, cards: S('wish_wall_register_gate', 'wiki_register_gate') }, excl).length > 0)

  console.log('③b B4：两份「不进报表」排除清单必须同源（防两本账打架）')
  t(
    '同源（两边都只有 wiki_register_gate）→ 通过',
    evalExclusionParity(S('wiki_register_gate'), S('wiki_register_gate')).length === 0
  )
  t(
    '★ 只在 FUNNEL_CARD_EXCLUDED（报表那侧没排除）→ 必须红',
    evalExclusionParity(S('wiki_register_gate'), S()).length === 1
  )
  t(
    '★ 只在 REPORT_EXCLUDED_GATES（本守卫没登记理由）→ 必须红',
    evalExclusionParity(S(), S('wiki_register_gate')).length === 1
  )

  console.log('④ 文件级注入 → 真实 CLI 必须 exit≠0 → 源文件逐字节还原')
  const WISH_RITUAL_STEP = "'wish_ritual_gate:"
  const INJECTIONS = [
    {
      name: '把 showRitualProfile 从云函数 saveFlags 抽掉（任务点名的那一条）',
      file: F.fnFlags,
      from: '    showRitualProfile: incoming.showRitualProfile\n',
      to: '',
    },
    {
      name: '把 showGift 从店长端开关面板抽掉（该开关在后台消失）',
      file: F.mgrWxml,
      from: ' data-field="showGift"',
      to: '',
    },
    {
      name: '把 ERP 的 form.showAtlas 改名（ERP 开关消失）',
      file: F.erpFlags,
      from: 'form.showAtlas',
      to: 'form.atlasFlag',
      all: true,
    },
    {
      name: '把 showMaShangYou 从小程序 normalize 抽掉（双端不同步）',
      file: F.mpFlags,
      from: '    showMaShangYou: src.showMaShangYou === true',
      to: '    showMaShangYouOff: src.showMaShangYou === true',
    },
    {
      name: '把 wish_ritual_gate 从 ERP FUNNELS 卡里抽掉（埋点发了、漏斗没有）',
      file: F.erpSchema,
      from: WISH_RITUAL_STEP,
      to: "'wish_ritual_gate_OFF:",
      all: true,
    },
  ]
  for (const inj of INJECTIONS) {
    const target = resolve(ROOT, inj.file)
    const before = readFileSync(target) // Buffer：用于逐字节还原与比对
    const beforeStr = before.toString('utf8')
    const mutated = inj.all ? beforeStr.split(inj.from).join(inj.to) : beforeStr.replace(inj.from, inj.to)
    if (mutated === beforeStr) {
      t(`注入「${inj.name}」锚点命中`, false, `在 ${inj.file} 里找不到锚点`)
      continue
    }
    let status = null
    let stderr = ''
    try {
      writeFileSync(target, mutated)
      const run = spawnSync(process.execPath, [SELF], { encoding: 'utf8' })
      status = run.status
      stderr = run.stderr || ''
    } finally {
      writeFileSync(target, before) // 逐字节还原（写回原始 Buffer）
    }
    t(`★ 注入「${inj.name}」被检出（exit=${status}）`, status !== 0, stderr.split('\n').find((l) => l.startsWith('✗')) || '守卫没红')
    const after = readFileSync(target)
    t(
      `「${inj.name}」源文件逐字节还原（sha256 ${sha(before).slice(0, 12)}）`,
      Buffer.compare(before, after) === 0,
      `还原后 ${sha(after).slice(0, 12)}`
    )
  }

  // 还原后基线必须恢复绿（证明还原彻底、且不是"一直红"）
  const aAfter = inspectChainA()
  const bAfter = inspectChainB()
  t('注入全部还原后，守卫恢复通过', evalChainA(aAfter).length === 0 && evalChainB(bAfter).length === 0)

  console.log('⑤ 锚点失效必须报「无法判定」，不许假绿（错题本 E16）')
  {
    const target = resolve(ROOT, F.fnFlags)
    const before = readFileSync(target)
    const beforeStr = before.toString('utf8')
    const from = 'const incoming = (event && event.flags)'
    const mutated = beforeStr.replace(from, 'const incomingPayload = (event && event.flags)')
    if (mutated === beforeStr) {
      t('锚点失效注入锚点命中', false, '在云函数里找不到 `const incoming = …`')
    } else {
      let status = null
      let stderr = ''
      try {
        writeFileSync(target, mutated)
        const run = spawnSync(process.execPath, [SELF], { encoding: 'utf8' })
        status = run.status
        stderr = run.stderr || ''
      } finally {
        writeFileSync(target, before)
      }
      t(
        '★ 保存载荷锚点被改名 → exit 1 且 stderr 明写「无法判定」（不是静默通过）',
        status !== 0 && /无法判定/.test(stderr),
        `exit=${status}`
      )
      t('「无法判定」用例源文件逐字节还原', Buffer.compare(before, readFileSync(target)) === 0)
    }
  }

  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${ok} 项（含反例证明判据窄 + swap 骗术被拦 + ${INJECTIONS.length} 条文件注入被检出并逐字节还原）`)
  process.exit(0)
}

if (process.argv.includes('--selftest')) selftest()
else main()
