/**
 * 钱包枢纽「页面 → 组件」生命周期不变量（批 1：积分面板）
 *
 * 为什么必须跑真源码 + 模拟时序：
 *   把 Page 搬进 Component 后，**页面的 onShow 不会自动落到组件上**了。
 *   面板的 onShow 就是 `refreshAll()`（真取数），于是有两条路可以触发它：
 *     · 宿主页 onShow 转发（selectComponent）
 *     · 组件自己的 pageLifetimes.show
 *   而页生命周期是 onLoad → onShow → onReady，**首屏那次 onShow 早于组件 ready**：
 *     - 只接宿主转发 → 首屏 selectComponent 还是 null → 页面永远不取数（最坏：静默空白）；
 *     - 两条路都接 → 每次回到页面 refreshAll 跑两遍（重复请求，后到的响应还可能覆盖先到的）。
 *   正确解只有「两条路各管一段」：首次由组件 lifetimes.ready，之后由宿主 onShow 且跳过首屏那次。
 *   这类错误**静态扫描看不出来**（代码都在、都合法、都不报错），必须按时序真跑一遍。
 *
 * 断言（A＝静态，S＝时序模拟）：
 *   A1 面板用 lifetimes.ready 首次取数，且**没有** pageLifetimes.show（否则必然重复）
 *   A2 宿主 onShow 有「跳过首屏」分支，onLoad 里置位
 *   A3 宿主 PANELS 的面板 id 与 wxml 上的 id 一致（否则转发静默失效 = 下拉不刷新）
 *   A4 面板 onShow 保持原语义（只有 refreshAll，没有私加去重/短路）
 *   S1 首次进入（onShow → 组件 ready）refreshAll 恰好 1 次
 *   S2 时序变体（组件 ready → onShow）refreshAll 恰好 1 次
 *   S3 重新显示页面：每次 +1
 *   S4 切 tab 回来（wx:if 重建实例）新实例恰好 1 次、旧实例不再触发
 *   S5 下拉刷新转发到当前面板并收掉 loading；面板没有该方法时宿主也兜底收掉
 *   S6 未并入的平台（tab 未登记）被忽略，不会把页面切空
 *
 * 用法：
 *   node miniprogram/scripts/test-wallet-hub-lifecycle.mjs
 *   node miniprogram/scripts/test-wallet-hub-lifecycle.mjs --selftest   # 注入回归，证明会失败
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const HOST_JS = 'miniprogram/subpackages/business/wallet-hub/index.js'
const HOST_WXML = 'miniprogram/subpackages/business/wallet-hub/index.wxml'
const PANEL_JS = 'miniprogram/subpackages/business/components/WalletPanelPoints/index.js'

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

/** 万能桩：任何属性/调用都返回自身（面板顶层会 getApp() / wx.cloud.database()） */
function anyStub() {
  const f = function () { return proxy }
  const proxy = new Proxy(f, { get: () => proxy, apply: () => proxy, construct: () => proxy })
  return proxy
}

/** 带覆盖项的 wx 桩：已知的走覆盖，未知的一律万能桩 */
function wxStub(overrides = {}) {
  const base = anyStub()
  return new Proxy(overrides, { get: (t, k) => (k in t ? t[k] : base[k]) })
}

/**
 * 载入小程序 CJS 真源码。仓根 package.json 是 "type":"module"，直接 require 会被当 ESM，
 * 故与 test-coupon-fold.mjs 同法：自己喂 module/exports/require 执行真源码。
 * 依赖全部打桩：本检查只关心**被调用了几次**，不关心取数结果。
 * 但 `storePoints` 必须给**具名且可拼接**的桩 —— 面板在模块顶层就用
 * `buildEarnRuleText(STORE_RULE_FALLBACK)` 拼进 data，万能桩会因无法转原始值而抛错。
 */
function loadCjs(file, globals = {}) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  const deps = {
    storePoints: {
      RULE_TEXT_FALLBACK: '',
      STORE_RULE_FALLBACK: {},
      buildEarnRuleText: () => '',
      EXCHANGE_RULE_TEXT: '',
      STORE_POINTS_NOTICE: '',
      POINT_TYPE_TEXT: {},
      EXCHANGE_CONFIRM_HINT: ''
    }
  }
  const saved = new Map()
  for (const [k, v] of Object.entries(globals)) {
    saved.set(k, Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined)
    globalThis[k] = v
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', src)(module, module.exports, (id) => {
      const key = String(id)
      for (const [needle, value] of Object.entries(deps)) {
        if (key.includes(needle)) return value
      }
      return anyStub()
    })
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete globalThis[k]
      else globalThis[k] = v
    }
  }
  return module.exports
}

function loadCaptured(file, key, globals) {
  let cfg = null
  loadCjs(file, { ...globals, [key]: (c) => { cfg = c } })
  if (!cfg) throw new Error(`${file} 没有调用 ${key}({...})`)
  return cfg
}

/**
 * 造一个「实例」：data 深拷、setData 生效。
 * 页面（Page）的方法在配置**顶层**，组件（Component）的在 `methods` 里 —— 两种形态都收。
 */
function instantiate(cfg) {
  const inst = { data: JSON.parse(JSON.stringify(cfg.data || {})) }
  for (const [k, v] of Object.entries(cfg)) {
    if (k !== 'data' && typeof v === 'function') inst[k] = v
  }
  Object.assign(inst, cfg.methods || {})
  inst.setData = function (patch) { Object.assign(this.data, patch) }
  return inst
}

// ── 加载真源码 ────────────────────────────────────────────────────────────────
const panelCfg = loadCaptured(PANEL_JS, 'Component', { wx: anyStub(), getApp: () => anyStub() })
const hostCfg = loadCaptured(HOST_JS, 'Page', { wx: anyStub() })
const hostSrc = readFileSync(resolve(ROOT, HOST_JS), 'utf8')
const panelSrc = readFileSync(resolve(ROOT, PANEL_JS), 'utf8')
const hostWxml = readFileSync(resolve(ROOT, HOST_WXML), 'utf8')

/** 宿主 PANELS 里登记的面板 id（selectComponent 的锚点） */
const HOST_PANEL_ID = (() => {
  const m = /id:\s*'([^']+)'/.exec(hostSrc)
  return m ? m[1] : null
})()

/**
 * 时序模拟器 —— 尽量贴近真机语义：
 *   pageShow() → 先派发给页面 onShow，再派发给「已 attached 的组件」的 pageLifetimes.show；
 *                组件还没 attached 时 selectComponent 返回 null（真机首屏 onShow 就是这种情形）
 *   attach()   → 组件被创建（首屏首次渲染 / wx:if 变 true）→ 触发 lifetimes.ready
 */
function makeWorld() {
  const panel = instantiate(panelCfg)
  panel.__refresh = 0
  panel.refreshAll = function () { this.__refresh += 1; return Promise.resolve() }

  const host = instantiate(hostCfg)
  let attached = false
  host.selectComponent = (sel) => (attached && sel === '#' + HOST_PANEL_ID ? panel : null)

  return {
    host,
    panel,
    get attached() { return attached },
    attach() {
      attached = true
      if (panelCfg.lifetimes && typeof panelCfg.lifetimes.ready === 'function') {
        panelCfg.lifetimes.ready.call(panel)
      }
    },
    pageShow() {
      if (typeof host.onShow === 'function') host.onShow.call(host)
      if (attached && panelCfg.pageLifetimes && typeof panelCfg.pageLifetimes.show === 'function') {
        panelCfg.pageLifetimes.show.call(panel)
      }
    },
    pageLoad(options) {
      if (typeof host.onLoad === 'function') host.onLoad.call(host, options || {})
    }
  }
}

// ── A 静态断言 ────────────────────────────────────────────────────────────────
check('A1 面板用 lifetimes.ready 做首次取数',
  !!(panelCfg.lifetimes && typeof panelCfg.lifetimes.ready === 'function'))
check('A1 面板没有 pageLifetimes.show（有它 = 与宿主转发双触发）',
  !(panelCfg.pageLifetimes && typeof panelCfg.pageLifetimes.show === 'function'))
check('A2 宿主 onShow 跳过首屏那次',
  /if\s*\(this\._skipFirstShow\)\s*\{\s*this\._skipFirstShow\s*=\s*false;\s*return\s*\}/.test(hostSrc))
check('A2 宿主 onLoad 置位首屏标记', /this\._skipFirstShow\s*=\s*true/.test(hostSrc))
check('A3 宿主 PANELS 的面板 id 与 wxml 一致',
  !!HOST_PANEL_ID && hostWxml.includes(`id="${HOST_PANEL_ID}"`), `id=${HOST_PANEL_ID}`)
check('A4 面板 onShow 保持原语义（只有 refreshAll，无私加去重/短路）',
  /onShow\(\)\s*\{\s*this\.refreshAll\(\)\s*;?\s*\}/.test(panelSrc))

// ── S 时序断言 ────────────────────────────────────────────────────────────────
{
  const w = makeWorld()
  w.pageLoad({ tab: 'points' })
  w.pageShow()   // 首屏：宿主必须放过这一次（此时组件还没 attached）
  w.attach()     // 组件就绪 → 首次取数
  eq('S1 首次进入 refreshAll 恰好 1 次', w.panel.__refresh, 1)
  w.pageShow()
  eq('S3 重新显示页面第 1 次 +1', w.panel.__refresh, 2)
  w.pageShow()
  eq('S3 重新显示页面第 2 次 +1', w.panel.__refresh, 3)
}
{
  const w = makeWorld()
  w.pageLoad({})
  w.attach()     // 变体：组件先 ready
  w.pageShow()   // 首屏 onShow 仍必须被跳过
  eq('S2 时序变体（ready → onShow）仍恰好 1 次', w.panel.__refresh, 1)
}
{
  const w = makeWorld()
  w.pageLoad({})
  w.pageShow()
  w.attach()
  w.pageShow()
  const before = w.panel.__refresh
  // 切 tab 再切回：宿主 wxml 用 wx:if，实例被重建 → 新实例自己 ready 取一次
  const w2 = makeWorld()
  w2.pageLoad({})
  w2.pageShow()
  w2.attach()
  eq('S4 重建实例（切 tab 回来）恰好 1 次', w2.panel.__refresh, 1)
  eq('S4 旧实例不再被重复触发', w.panel.__refresh, before)
}

// ── S5 下拉刷新转发（面板实现在宿主页，加载 loading 必须被收掉）────────────────
{
  const savedWx = Object.prototype.hasOwnProperty.call(globalThis, 'wx') ? globalThis.wx : undefined
  try {
    const w = makeWorld()
    w.pageLoad({})
    w.pageShow()
    w.attach()
    let stop = 0
    globalThis.wx = wxStub({ stopPullDownRefresh: () => { stop += 1 } })
    w.panel.onPullDownRefresh.call(w.panel)
    await Promise.resolve()
    await Promise.resolve()
    check('S5 面板下拉刷新真取数', w.panel.__refresh >= 2, `refresh=${w.panel.__refresh}`)
    eq('S5 面板下拉刷新收掉 loading', stop, 1)

    const w3 = makeWorld()
    w3.pageLoad({})
    w3.pageShow()
    w3.attach()
    delete w3.panel.onPullDownRefresh
    let stop3 = 0
    globalThis.wx = wxStub({ stopPullDownRefresh: () => { stop3 += 1 } })
    w3.host.onPullDownRefresh.call(w3.host)
    eq('S5 面板无该方法时宿主兜底收掉 loading', stop3, 1)
  } finally {
    if (savedWx === undefined) delete globalThis.wx
    else globalThis.wx = savedWx
  }
}

// ── S6 未并入的平台 ───────────────────────────────────────────────────────────
{
  const w = makeWorld()
  w.pageLoad({ tab: 'points' })
  w.pageShow()
  w.attach()
  const before = w.host.data.curTab
  w.host.onTabChange.call(w.host, { detail: { tab: 'coupons' } })
  eq('S6 未并入的平台被忽略（页面不会被切空）', w.host.data.curTab, before)
}

// ── 输出 / 自检 ───────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 钱包枢纽生命周期检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 钱包枢纽生命周期：${passed} 项通过（首屏不重复取数 / 重新显示会刷新 / 下拉刷新转发）`)
}

/**
 * 自检：注入回归 → 必须被检出 → 逐字还原源文件。
 * 另含一条「中性改动」负对照，证明本检查不是「文件一变就报错」。
 */
function selftest() {
  const injections = [
    {
      name: '面板重新接上 pageLifetimes.show（与宿主转发双触发）',
      file: PANEL_JS,
      from: '  methods: _methods,\n',
      to: '  methods: _methods,\n  pageLifetimes: { show() { _methods.onShow.call(this) } },\n'
    },
    {
      name: '宿主删掉「跳过首屏」分支（时序变体下重复取数）',
      file: HOST_JS,
      from: '    if (this._skipFirstShow) { this._skipFirstShow = false; return }\n',
      to: ''
    },
    {
      name: '面板 ready 改名（首屏永不取数）',
      file: PANEL_JS,
      from: '    ready() {\n',
      to: '    readyX() {\n'
    },
    {
      name: '宿主不再转发 onShow（离开再回来不刷新）',
      file: HOST_JS,
      from: "    if (p && typeof p.onShow === 'function') p.onShow()\n",
      to: ''
    }
  ]
  const controls = [
    {
      name: '负对照：纯注释改动必须仍然通过',
      file: HOST_JS,
      from: 'const PANELS = {',
      to: '// 负对照注释\nconst PANELS = {'
    }
  ]

  let bad = 0
  for (const inj of injections) {
    if (!expectDetected(inj, '注入回归未被检出')) bad += 1
    else console.log(`  ✓ 已检出：${inj.name}`)
  }
  for (const c of controls) {
    const r = withInjection(c, () => {
      const res = runChild()
      return res.status === 0 ? null : `负对照误报（中性改动被当成回归）：${c.name}`
    })
    if (r) { console.log(`✗ ${r}`); bad += 1 } else console.log(`  ✓ ${c.name}`)
  }

  if (bad) {
    console.log(`✗ 自检失败：${bad} 项（${injections.length} 条注入 / ${controls.length} 条负对照）`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、${controls.length} 条负对照不误报、源文件逐字还原`)
}

/** 注入 → 必须失败 → 逐字还原；返回 false 表示自检本身有问题（锚点不唯一/未还原/未被检出） */
function expectDetected(inj, msg) {
  const r = withInjection(inj, () => (runChild().status === 0 ? msg : null))
  if (r) { console.log(`✗ ${r}：${inj.name}`); return false }
  return true
}

/** 统一处理「唯一锚点 → 写入 → 跑 → 逐字还原」，回调返回错误串或 null */
function withInjection(inj, fn) {
  const abs = resolve(ROOT, inj.file)
  const orig = readFileSync(abs, 'utf8')
  const hits = orig.split(inj.from).length - 1
  if (hits !== 1) {
    console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
    return '锚点问题'
  }
  writeFileSync(abs, orig.replace(inj.from, inj.to))
  let err = null
  try {
    err = fn()
  } catch (e) {
    err = `自检过程抛异常：${e && e.message}`
  } finally {
    writeFileSync(abs, orig)
  }
  if (readFileSync(abs, 'utf8') !== orig) {
    console.log(`✗ 自检未能逐字还原：${inj.file}`)
    return '还原失败'
  }
  return err
}

/** 子进程里跑「无 --selftest」的本检查，取退出码 */
function runChild() {
  return spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
}
