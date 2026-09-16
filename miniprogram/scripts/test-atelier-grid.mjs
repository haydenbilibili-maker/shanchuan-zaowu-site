/**
 * 标本工坊（pages/atelier）四功能宫格 行为断言
 *
 * 本次改动有三处「静默失效」风险，静态扫不出来：
 *   1. **编号稳定性**：原实现用 `{{showGift ? '02' : '01'}}`，任何一格开关变化后面编号全漂 ——
 *      用户看到的「03」今天是鉴定、明天变伴宠。断言：关掉任意组合，其余编号不变。
 *   2. **开关口径**：四个功能的默认值不同（礼赠/定制缺配置默认**关**；鉴定/伴宠默认**开**），
 *      写反了会「上线即消失」或「关不掉」。
 *   3. **鉴定入口的埋点不能重复计**：鉴定页自己会发 `identify_entry_click`（source 取 URL 的 from），
 *      宫格若再发一条，同一次点击就记两次。
 *
 * 用法：
 *   node miniprogram/scripts/test-atelier-grid.mjs
 *   node miniprogram/scripts/test-atelier-grid.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

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
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const INJECTIONS = {
  // 编号改为「按可见顺序重排」→ 关掉一格后面全漂（原实现的缺陷形态）
  'renumber-by-visibility': {
    file: 'miniprogram/pages/atelier/index.js',
    from: "    key: f.key,\n    no: f.no,",
    to: "    key: f.key,\n    no: String(idx + 1).padStart(2, '0'),"
  },
  // 鉴定默认值写反 → 缺配置时入口直接消失（而现网已开放）
  'identify-default-off': {
    file: 'miniprogram/pages/atelier/index.js',
    from: "    flag: 'showAiIdentify',\n    defaultOn: true,",
    to: "    flag: 'showAiIdentify',\n    defaultOn: false,"
  },
  // 去掉守卫 → 开关关闭时仍能进
  'drop-flag-gate': {
    file: 'miniprogram/pages/atelier/index.js',
    from: "    if (!this.data[feature.flag]) {\n      this.toastClosed(feature.toast)\n      return\n    }",
    to: "    if (false) {\n      this.toastClosed(feature.toast)\n      return\n    }"
  },
  // 宫格再补一条 identify_entry_click → 同一次点击被计两次
  'double-count-identify': {
    file: 'miniprogram/pages/atelier/index.js',
    from: "    url: '/subpackages/feature/identify/index?from=atelier',\n    track: null,",
    to: "    url: '/subpackages/feature/identify/index?from=atelier',\n    track: { action: 'identify_entry_click', type: 'identification', value: 'atelier' },"
  }
}

const INJECT = String(process.env.ATELIER_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/* ------------------------------------------------------------------ *
 * 加载真源码：捕获 Page 配置 + 取出模块级纯函数
 * ------------------------------------------------------------------ */

const trackCalls = []
const pageSrc = readSrc('miniprogram/pages/atelier/index.js')
const captured = { config: null }
const wxStub = {
  vibrateShort() {},
  showToast(o) { captured.lastToast = o && o.title },
  navigateTo(o) { captured.lastNav = o && o.url; if (o && o.fail) { /* 不主动触发 */ } },
  getTabBar: () => null
}
const requireStub = (id) => {
  if (String(id).includes('trackBehavior')) {
    return { trackBehavior: (action, type, value) => trackCalls.push({ action, type, value }) }
  }
  if (String(id).includes('storeMediaCdn')) return { xingchenCover: 'cdn://hero.png' }
  if (String(id).includes('contentDisplayFlags')) {
    return {
      fetchContentDisplayFlags: async () => ({ flags: {} }),
      toastSpecimenCustomClosed: () => { captured.lastToast = '标本定制暂未开放' },
      toastPetMemorialClosed: () => { captured.lastToast = '伴宠记忆暂未开放' },
      toastGiftClosed: () => { captured.lastToast = '礼赠暂未开放，柜门稍后再启' },
      toastAiIdentifyClosed: () => { captured.lastToast = 'AI 鉴定暂未开放' },
      getCachedContentDisplayFlags: () => null
    }
  }
  throw new Error('unexpected require ' + id)
}

// eslint-disable-next-line no-new-func
const factory = new Function(
  'Page',
  'require',
  'wx',
  `${pageSrc}\n;return { FEATURES, buildTiles, openKeysOf, buildIntroText }`
)
const exported = factory((cfg) => { captured.config = cfg }, requireStub, wxStub)

const { FEATURES, buildTiles, openKeysOf, buildIntroText } = exported

/* ------------------------------------------------------------------ *
 * 1) 四功能定义：顺序、编号、开关口径
 * ------------------------------------------------------------------ */

eq('默认四格数量', FEATURES.length, 4)
eq('① 顺序 = 礼赠', FEATURES[0].key, 'gift')
eq('② 顺序 = 定制', FEATURES[1].key, 'custom')
eq('③ 顺序 = 鉴定（新增）', FEATURES[2].key, 'identify')
eq('④ 顺序 = 伴宠', FEATURES[3].key, 'pet')

const IDENTIFY = FEATURES.find((f) => f.key === 'identify')
eq('★ 鉴定入口开关字段 = showAiIdentify（与功能开关一致）', IDENTIFY.flag, 'showAiIdentify')
eq('★ 鉴定缺配置默认开（现网已开放，写反会「上线即消失」）', IDENTIFY.defaultOn, true)
eq('鉴定跳转 URL', IDENTIFY.url, '/subpackages/feature/identify/index?from=atelier')
eq('★ 鉴定不在宫格补埋点（避免与鉴定页自身事件重复计）', IDENTIFY.track, null)
eq('礼赠缺配置默认关', FEATURES[0].defaultOn, false)
eq('定制缺配置默认关', FEATURES[1].defaultOn, false)
eq('伴宠缺配置默认开', FEATURES[3].defaultOn, true)

/* ------------------------------------------------------------------ *
 * 2) buildTiles：可见性与**编号稳定性**
 * ------------------------------------------------------------------ */

const ALL = { showGift: true, showSpecimenCustom: true, showAiIdentify: true, showPetMemorial: true }

eq('四开 → 四格', buildTiles(ALL).length, 4)
eq('四开 → 编号 01/02/03/04', buildTiles(ALL).map((t) => t.no).join(','), '01,02,03,04')
eq('四开 → 顺序', buildTiles(ALL).map((t) => t.key).join(','), 'gift,custom,identify,pet')

// ★ 核心断言：任意组合下，同一功能的编号恒定
const combos = [
  { showGift: false, showSpecimenCustom: true, showAiIdentify: true, showPetMemorial: true, expect: 'custom:02,identify:03,pet:04' },
  { showGift: true, showSpecimenCustom: false, showAiIdentify: true, showPetMemorial: true, expect: 'gift:01,identify:03,pet:04' },
  { showGift: true, showSpecimenCustom: true, showAiIdentify: false, showPetMemorial: true, expect: 'gift:01,custom:02,pet:04' },
  { showGift: true, showSpecimenCustom: true, showAiIdentify: true, showPetMemorial: false, expect: 'gift:01,custom:02,identify:03' },
  { showGift: false, showSpecimenCustom: false, showAiIdentify: false, showPetMemorial: false, expect: '' }
]
combos.forEach((c) => {
  const got = buildTiles(c).map((t) => `${t.key}:${t.no}`).join(',')
  eq(`★ 编号不随可见性漂移（${c.expect || '全关'}）`, got, c.expect)
})

// 注意：只给部分字段时，未给的是「缺配置」语义 —— 伴宠/鉴定默认开，礼赠/定制默认关。
// 所以这里必须把伴宠显式关掉，才是「只有鉴定」这个用例。
eq(
  '鉴定可单独显示（显式关掉其它三项）',
  buildTiles({ showGift: false, showSpecimenCustom: false, showAiIdentify: true, showPetMemorial: false }).map((t) => t.key).join(','),
  'identify'
)
eq(
  '鉴定显式关闭时不显示',
  buildTiles({ showGift: false, showSpecimenCustom: false, showAiIdentify: false, showPetMemorial: false }).map((t) => t.key).join(','),
  ''
)
// 缺字段语义（这才是「开关写反」最容易出错的地方）
eq('只传鉴定开 → 伴宠因缺配置默认开而同时出现', buildTiles({ showAiIdentify: true }).map((t) => t.key).join(','), 'identify,pet')
eq('只传鉴定关 → 伴宠仍在（鉴定不影响伴宠）', buildTiles({ showAiIdentify: false }).map((t) => t.key).join(','), 'pet')
eq('空入参 = 全默认（鉴定/伴宠在、礼赠/定制不在）', buildTiles({}).map((t) => t.key).join(','), 'identify,pet')
eq('null 入参安全', buildTiles(null).map((t) => t.key).join(','), 'identify,pet')

/* ------------------------------------------------------------------ *
 * 3) 开场文案：不再枚举组合，按实际开放说话
 * ------------------------------------------------------------------ */

check('四开文案点名四条', /四条路径都在/.test(buildIntroText(openKeysOf(ALL))))
check('部分开放文案列出名称', /礼赠、AI 鉴定/.test(buildIntroText(['gift', 'identify'])), buildIntroText(['gift', 'identify']))
check('全关文案不列功能名', buildIntroText([]) === '工坊服务逐步开放，敬请留意。')

/* ------------------------------------------------------------------ *
 * 4) 点击分发：守卫 / 跳转 / 埋点
 * ------------------------------------------------------------------ */

function makePage(flags) {
  const ctx = {
    data: { ...flags },
    toastClosed: captured.config.toastClosed,
    _toast: null
  }
  ctx.data[FEATURES.find((f) => f.key === 'identify').flag] = flags.showAiIdentify
  return ctx
}

async function tap(key, flags) {
  trackCalls.length = 0
  captured.lastNav = undefined
  captured.lastToast = undefined
  const cfg = captured.config
  // 用真实 applyFlags 把 tiles/守卫落进 data
  const ctx = {
    data: {},
    setData(patch) { Object.assign(this.data, patch) },
    toastClosed: cfg.toastClosed
  }
  cfg.applyFlags.call(ctx, flags)
  cfg.onFeatureTap.call(ctx, { currentTarget: { dataset: { key } } })
  return { prev: ctx, nav: captured.lastNav, toast: captured.lastToast, tracks: trackCalls.slice() }
}

{
  const r = await tap('identify', ALL)
  eq('★ 开关开 → 进鉴定页', r.nav, '/subpackages/feature/identify/index?from=atelier')
  eq('★ 宫格对鉴定不再补埋点（只有鉴定页自己记一次）', r.tracks.length, 0)
}
{
  const r = await tap('identify', { showAiIdentify: false })
  eq('★ 开关关 → 不跳转', r.nav, undefined)
  eq('★ 开关关 → 给出关闭提示', r.toast, 'AI 鉴定暂未开放')
}
{
  const r = await tap('gift', { showGift: true })
  eq('礼赠跳转保持原 URL', r.nav, '/subpackages/feature/gift/hub/index?from=atelier')
  eq('礼赠保留原埋点', r.tracks.map((t) => t.action).join(','), 'gift_entry_click')
}
{
  const r = await tap('custom', ALL)
  eq('定制跳转保持原 URL', r.nav, '/subpackages/feature/custom/index?from=hub')
  eq('定制埋点 type=standard', r.tracks[0] && r.tracks[0].value, 'standard')
}
{
  const r = await tap('pet', ALL)
  eq('伴宠跳转保持原 URL', r.nav, '/subpackages/feature/custom/pet/index?from=hub')
  eq('伴宠埋点 type=pet', r.tracks[0] && r.tracks[0].value, 'pet')
}
{
  const r = await tap('nope', ALL)
  eq('未知 key 不跳转', r.nav, undefined)
}

/* ------------------------------------------------------------------ *
 * 5) WXML/WXSS：宫格结构与四格数据驱动
 * ------------------------------------------------------------------ */

const wxml = readFileSync(resolve(ROOT, 'miniprogram/pages/atelier/index.wxml'), 'utf8')
const wxss = readFileSync(resolve(ROOT, 'miniprogram/pages/atelier/index.wxss'), 'utf8')
check('WXML 用宫格容器', /class="feature-grid"/.test(wxml))
check('WXML 由 tiles 数据驱动', /wx:for="\{\{tiles\}\}"/.test(wxml))
check('WXML 单一分发器', /bindtap="onFeatureTap"/.test(wxml))
eq('★ WXML 不再残留旧 fork-card', (wxml.match(/fork-card/g) || []).length, 0)
eq('★ WXSS 不再残留旧 fork-* 样式', (wxss.match(/\.fork-/g) || []).length, 0)
check('宫格为两列', /grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(wxss))
check('描述两行封顶（等高格子不被长文案撑破）', /-webkit-line-clamp:\s*2/.test(wxss))

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, ATELIER_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n工坊宫格断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 工坊四功能宫格通过（编号稳定 / 开关口径正确 / 鉴定入口不重复埋点 / 守卫与跳转保持原行为）')
