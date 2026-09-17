/**
 * 钱包枢纽「页面 → 组件」生命周期不变量（批 1 积分 / 批 2 礼券夹）
 *
 * 为什么必须跑真源码 + 模拟时序：
 *   把 Page 搬进 Component 后，**页面的生命周期不会自动落到组件上**了。
 *   而面板的 onShow 就是真取数（积分 refreshAll / 礼券夹 loadCoupons），onHide 要停轮询与倒计时，
 *   onUnload 要收亮码弹层。于是每个页面级生命周期都有两条可能的路：
 *     · 宿主页转发（selectComponent）
 *     · 组件自己的 pageLifetimes.show / hide
 *   而页生命周期是 onLoad → onShow → onReady，**首屏那次 onShow 早于组件 ready**：
 *     - 只接宿主转发 → 首屏 selectComponent 还是 null → 页面永远不取数（静默空白）；
 *     - 两条路都接 → 每次回到页面 onShow 跑两遍（重复请求，后到的响应还可能覆盖先到的）。
 *   正确解只有「两条路各管一段」：首次由组件 lifetimes.ready，之后由宿主转发且跳过首屏那次；
 *   销毁清理放 lifetimes.detached（切走 tab 也要清，页面 onUnload 转发是多余的）。
 *   这类错误**静态扫描看不出来**（代码都在、都合法、都不报错），必须按时序真跑一遍。
 *
 * 断言（A＝静态，S＝时序模拟）：
 *   A1 每个面板：lifetimes.ready 首次取数、**没有** pageLifetimes.show（否则必然重复）
 *   A2 宿主 onShow 跳过首屏那次（onLoad 置位）
 *   A3 宿主 PANELS 的每个面板 id 都在 wxml 上有对应节点（否则转发静默失效）
 *   A4 顶栏能派发的每个 tab 都有归宿：已并入 PANELS，或 PENDING_TAB_URL 有已注册的退回页
 *   A5 积分面板 onShow 保持原语义（只有 refreshAll，没有私加去重/短路）
 *   A6 宿主转发 onHide（礼券夹要靠它停核销轮询）；且不转发 onUnload（清理只在 detached，
 *      两条都接会双重清理）
 *   A7 宿主把 couponCount 喂给顶栏（三 tab 共用一份角标口径）
 *   S1 首次进入（onShow → 组件 ready）onShow 恰好 1 次
 *   S2 时序变体（组件 ready → onShow）仍恰好 1 次
 *   S3 重新显示页面：每次 +1
 *   S4 切 tab 回来（wx:if 重建实例）新实例恰好 1 次、旧实例不再触发
 *   S5 下拉刷新转发到当前面板并收掉 loading；面板没有该方法时宿主也兜底收掉
 *   S6 已并入的 tab 页内切（不跳页）；未并入的 tab 退回原页面（不会点了没反应）
 *   S7 深链 tab 写错 → 落回已登记面板
 *   S8 礼券夹：销毁 → 原 onUnload 清理跑一次；页面 onHide → 面板 onHide 跑一次；
 *      usableCouponCount 变化 → 回传 couponcount → 宿主 couponCount 更新
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
const BAR_WXML = 'miniprogram/subpackages/business/components/WalletHubBar/index.wxml'
/** 已并入枢纽的面板（宿主 PANELS 的键必须在这里有落点，A3/A1 逐面板核对） */
const PANEL_FILES = {
  points: 'miniprogram/subpackages/business/components/WalletPanelPoints/index.js',
  coupons: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.js'
}

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
 * 但模块顶层会被调用的那些必须给**可拼接的真值** —— 积分面板顶层就执行
 * `buildEarnRuleText(STORE_RULE_FALLBACK)`，万能桩会因无法转原始值而抛错。
 */
const DEPS = {
  storePoints: {
    RULE_TEXT_FALLBACK: '',
    STORE_RULE_FALLBACK: {},
    buildEarnRuleText: () => '',
    EXCHANGE_RULE_TEXT: '',
    STORE_POINTS_NOTICE: '',
    POINT_TYPE_TEXT: {},
    EXCHANGE_CONFIRM_HINT: ''
  },
  couponHelper: { couponTimeMs: () => 0 },
  couponService: { fetchMyCoupons: async () => ({ ok: true, list: [] }) },
  passRedeemFeedback: {
    REDEEM_POLL_MS: 1000,
    REDEEM_ANIM_MS: 1000,
    softVibrate: () => {},
    pollMemberPassRedeem: async () => ({}),
    shouldAcceptRedeem: () => false,
    formatRedeemValueText: () => ''
  },
  userSession: {
    isLocalLoggedOut: () => false,
    resumeLocalSession: () => {},
    ensureSession: async () => ({}),
    needsOnboarding: () => false,
    navigateToOnboarding: () => {},
    fetchUserSession: async () => ({})
  },
  orderScope: { ensureOpenId: async () => '' },
  qrCanvas: { drawMemberQr: () => {} },
  cacheInvalidate: { invalidateAfterCoupon: () => {} }
}

function loadCjs(file, globals = {}) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  const saved = new Map()
  for (const [k, v] of Object.entries(globals)) {
    saved.set(k, Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined)
    globalThis[k] = v
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', src)(module, module.exports, (id) => {
      const key = String(id)
      for (const [needle, value] of Object.entries(DEPS)) {
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
 * 造一个「实例」：data 深拷、setData 生效、triggerEvent 记账。
 * 页面（Page）的方法在配置**顶层**，组件（Component）的在 `methods` 里 —— 两种形态都收。
 */
function instantiate(cfg) {
  const inst = { data: JSON.parse(JSON.stringify(cfg.data || {})), __events: [] }
  for (const [k, v] of Object.entries(cfg)) {
    if (k !== 'data' && typeof v === 'function') inst[k] = v
  }
  Object.assign(inst, cfg.methods || {})
  inst.setData = function (patch) { Object.assign(this.data, patch) }
  inst.triggerEvent = function (name, detail) { this.__events.push({ name, detail }) }
  return inst
}

/** 从 lifetimes 里取钩子（兼容 top-level 旧写法） */
const life = (cfg, name) => (cfg.lifetimes && cfg.lifetimes[name]) || cfg[name]

// ── 加载真源码 ────────────────────────────────────────────────────────────────
const hostCfg = loadCaptured(HOST_JS, 'Page', { wx: anyStub() })
const hostSrc = readFileSync(resolve(ROOT, HOST_JS), 'utf8')
const hostWxml = readFileSync(resolve(ROOT, HOST_WXML), 'utf8')
const barWxml = readFileSync(resolve(ROOT, BAR_WXML), 'utf8')
const panelCfgs = {}
for (const [tab, file] of Object.entries(PANEL_FILES)) {
  panelCfgs[tab] = loadCaptured(file, 'Component', { wx: anyStub(), getApp: () => anyStub() })
}

/** 宿主 PANELS 登记的面板（key → {id}） */
const PANELS = (() => {
  const m = /const PANELS = \{([\s\S]*?)\n\}/.exec(hostSrc) || /const PANELS = \{([^\n]*)\}/.exec(hostSrc)
  if (!m) return {}
  const out = {}
  for (const x of m[1].matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    const id = /id:\s*'([^']+)'/.exec(x[2])
    out[x[1]] = { id: id ? id[1] : null }
  }
  return out
})()

/** 尚未并入的 tab → 原页面（app.json 里必须真注册过，否则点了直接失败） */
const PENDING_TAB_URL = (() => {
  const block = /const PENDING_TAB_URL = \{([\s\S]*?)\n\}/.exec(hostSrc) || /const PENDING_TAB_URL = \{([^\n]*)\}/.exec(hostSrc)
  if (!block) return {}
  const out = {}
  for (const m of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2]
  return out
})()

/** app.json 注册过的全部页面路径（主包 + 分包） */
const REGISTERED_PAGES = (() => {
  const app = JSON.parse(readFileSync(resolve(ROOT, 'miniprogram/app.json'), 'utf8'))
  const out = new Set(app.pages || [])
  for (const sub of app.subpackages || []) {
    for (const p of sub.pages || []) out.add(`${sub.root}/${p}`)
  }
  return out
})()

/** 顶栏真正能派发出来的 tab（wxml 上的 data-tab） */
const BAR_TABS = [...new Set([...barWxml.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]))]

// ── A 静态断言 ────────────────────────────────────────────────────────────────
for (const [tab, cfg] of Object.entries(panelCfgs)) {
  check(`A1 ${tab} 面板用 lifetimes.ready 做首次取数`, typeof life(cfg, 'ready') === 'function')
  check(`A1 ${tab} 面板没有 pageLifetimes.show（有它 = 与宿主转发双触发）`,
    !(cfg.pageLifetimes && typeof cfg.pageLifetimes.show === 'function'))
}
check('A2 宿主 onShow 跳过首屏那次',
  /if\s*\(this\._skipFirstShow\)\s*\{\s*this\._skipFirstShow\s*=\s*false;\s*return\s*\}/.test(hostSrc))
check('A2 宿主 onLoad 置位首屏标记', /this\._skipFirstShow\s*=\s*true/.test(hostSrc))

for (const [tab, meta] of Object.entries(PANELS)) {
  check(`A3 ${tab} 面板在宿主 wxml 上有节点（id=${meta.id}）`, !!meta.id && hostWxml.includes(`id="${meta.id}"`))
}
check('A3 已登记面板都有对应组件文件', Object.keys(PANELS).every((t) => PANEL_FILES[t]),
  `PANELS=${Object.keys(PANELS).join(',')}`)

check('A4 顶栏派发的 tab 都能被识别', BAR_TABS.length >= 3, JSON.stringify(BAR_TABS))
for (const tab of BAR_TABS) {
  check(`A4 ${tab} tab 有归宿（已并入或有退回页）`, !!PANELS[tab] || !!PENDING_TAB_URL[tab])
}
for (const [tab, url] of Object.entries(PENDING_TAB_URL)) {
  check(`A4 退回页已注册（${tab} → ${url}）`, REGISTERED_PAGES.has(url.replace(/^\//, '')), url)
}

check('A5 积分面板 onShow 保持原语义（只有 refreshAll，无私加去重/短路）',
  /onShow\(\)\s*\{\s*this\.refreshAll\(\)\s*;?\s*\}/.test(
    readFileSync(resolve(ROOT, PANEL_FILES.points), 'utf8')))

check('A6 宿主转发 onHide（礼券夹要用它停核销轮询）',
  /onHide\(\)\s*\{[\s\S]*?typeof p\.onHide === 'function'[\s\S]*?p\.onHide\(\)/.test(hostSrc))
check('A6 宿主不转发 onUnload（清理只在 detached，避免双重清理）',
  !/onUnload\(\)\s*\{/.test(hostSrc))
check('A7 宿主把 couponCount 喂给顶栏', /coupon-count="\{\{couponCount\}\}"/.test(hostWxml))

// ── 时序模拟器 ────────────────────────────────────────────────────────────────
const HOST_PANEL_ID = PANELS.points && PANELS.points.id

/**
 * 尽量贴近真机语义：
 *   pageShow() → 先派发给页面 onShow，再派发给「已 attached 的组件」的 pageLifetimes.show；
 *                组件还没 attached 时 selectComponent 返回 null（真机首屏 onShow 就是这种情形）
 *   attach()   → 组件被创建（首屏首次渲染 / wx:if 变 true）→ lifetimes.attached → lifetimes.ready
 *   detach()   → 组件被销毁（切走 tab / 页面卸载）→ lifetimes.detached
 */
function makeWorld(tab = 'points') {
  const cfg = panelCfgs[tab]
  const panel = instantiate(cfg)
  panel.__refresh = 0
  if (typeof panel.refreshAll === 'function') {
    panel.refreshAll = function () { this.__refresh += 1; return Promise.resolve() }
  }
  if (typeof panel.loadCoupons === 'function') {
    panel.loadCoupons = function () { this.__refresh += 1; return Promise.resolve() }
  }

  const host = instantiate(hostCfg)
  let attached = false
  host.selectComponent = (sel) => (attached && sel === '#' + PANELS[tab].id ? panel : null)

  return {
    host,
    panel,
    cfg,
    get attached() { return attached },
    attach() {
      attached = true
      if (typeof life(cfg, 'attached') === 'function') life(cfg, 'attached').call(panel)
      if (typeof life(cfg, 'ready') === 'function') life(cfg, 'ready').call(panel)
    },
    detach() {
      attached = false
      if (typeof life(cfg, 'detached') === 'function') life(cfg, 'detached').call(panel)
    },
    pageShow() {
      if (typeof host.onShow === 'function') host.onShow.call(host)
      if (attached && cfg.pageLifetimes && typeof cfg.pageLifetimes.show === 'function') {
        cfg.pageLifetimes.show.call(panel)
      }
    },
    pageHide() {
      if (typeof host.onHide === 'function') host.onHide.call(host)
      if (attached && cfg.pageLifetimes && typeof cfg.pageLifetimes.hide === 'function') {
        cfg.pageLifetimes.hide.call(panel)
      }
    },
    pageLoad(options) {
      if (typeof host.onLoad === 'function') host.onLoad.call(host, options || {})
    }
  }
}

// ── S 时序断言 ────────────────────────────────────────────────────────────────
{
  const w = makeWorld('points')
  w.pageLoad({ tab: 'points' })
  w.pageShow()   // 首屏：宿主必须放过这一次（此时组件还没 attached）
  w.attach()     // 组件就绪 → 首次取数
  eq('S1 首次进入 取数恰好 1 次', w.panel.__refresh, 1)
  w.pageShow()
  eq('S3 重新显示页面第 1 次 +1', w.panel.__refresh, 2)
  w.pageShow()
  eq('S3 重新显示页面第 2 次 +1', w.panel.__refresh, 3)
}
{
  const w = makeWorld('points')
  w.pageLoad({})
  w.attach()     // 变体：组件先 ready
  w.pageShow()   // 首屏 onShow 仍必须被跳过
  eq('S2 时序变体（ready → onShow）仍恰好 1 次', w.panel.__refresh, 1)
}
{
  const w = makeWorld('points')
  w.pageLoad({})
  w.pageShow()
  w.attach()
  w.pageShow()
  const before = w.panel.__refresh
  const w2 = makeWorld('points')
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
    const w = makeWorld('points')
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

    const w3 = makeWorld('points')
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

// ── S6/S7 切 tab：已并入的页内切，未并入的退回原页面 ──────────────────────────
{
  const savedWx = Object.prototype.hasOwnProperty.call(globalThis, 'wx') ? globalThis.wx : undefined
  try {
    const redirects = []
    globalThis.wx = wxStub({
      redirectTo: (o) => { redirects.push(o.url) },
      showToast: () => {},
      setNavigationBarTitle: () => {}
    })

    // 已并入：页内切，绝不跳页面
    const w = makeWorld('coupons')
    w.pageLoad({ tab: 'points' })
    w.pageShow()
    w.attach()
    w.host.onTabChange.call(w.host, { detail: { tab: 'coupons' } })
    eq('S6 已并入的 tab 页内切换（curTab 跟着变）', w.host.data.curTab, 'coupons')
    eq('S6 已并入的 tab 不产生页面跳转', redirects.length, 0)
    eq('S6 切过去后顶栏标题跟着变', w.host.data.barTitle, '我的礼券夹')

    // 未并入：退回原页面，且当前面板不动
    const w2 = makeWorld('points')
    w2.pageLoad({ tab: 'points' })
    w2.pageShow()
    w2.attach()
    w2.host.onTabChange.call(w2.host, { detail: { tab: 'wallet' } })
    eq('S6 未并入的 tab 退回原页面（不会点了没反应）', redirects[0], PENDING_TAB_URL.wallet)
    eq('S6 未并入的 tab 不改当前面板', w2.host.data.curTab, 'points')

    // 深链写错 tab
    const w3 = makeWorld('points')
    w3.pageLoad({ tab: 'nope' })
    check('S7 深链 tab 写错 → 落回已登记面板', !!PANELS[w3.host.data.curTab], `curTab=${w3.host.data.curTab}`)
  } finally {
    if (savedWx === undefined) delete globalThis.wx
    else globalThis.wx = savedWx
  }
}

// ── S8 礼券夹特有：销毁清理 / 切后台停轮询 / 券数回传角标 ──────────────────────
{
  const w = makeWorld('coupons')
  w.pageLoad({ tab: 'coupons' })
  w.pageShow()
  w.attach()
  eq('S8 礼券夹首次进入取数 1 次', w.panel.__refresh, 1)

  let closed = 0
  const rawClose = w.panel.closePassModal
  if (typeof rawClose === 'function') {
    w.panel.closePassModal = function () { closed += 1; return rawClose.apply(this, arguments) }
  }
  let hides = 0
  const rawHide = w.panel.onHide
  if (typeof rawHide === 'function') {
    w.panel.onHide = function () { hides += 1; return rawHide.apply(this, arguments) }
  }
  w.detach()
  eq('S8 销毁（切走 tab/卸载）触发原 onUnload 清理', closed, 1)
  w.pageShow()
  eq('S8 销毁后页面 onShow 不再打到已销毁的面板', hides, 0)

  const w2 = makeWorld('coupons')
  w2.pageLoad({ tab: 'coupons' })
  w2.pageShow()
  w2.attach()
  let hides2 = 0
  const rawHide2 = w2.panel.onHide
  if (typeof rawHide2 === 'function') {
    w2.panel.onHide = function () { hides2 += 1; return rawHide2.apply(this, arguments) }
  }
  w2.pageHide()
  eq('S8 切后台/息屏 → 宿主把 onHide 转给面板（停核销轮询与倒计时）', hides2, 1)
  eq('S8 切后台不销毁面板（亮码弹层状态要保留）', w2.attached, true)

  // 券数变化 → 回传 → 宿主 → 顶栏
  eq('S8 面板初始没有回传事件', w2.panel.__events.length, 0)
  w2.panel.setData({ usableCouponCount: 3 })
  const ev = w2.panel.__events.find((e) => e.name === 'couponcount')
  check('S8 券数变化回传 couponcount', !!ev, JSON.stringify(w2.panel.__events))
  if (ev) eq('S8 回传的券数正确', ev.detail && ev.detail.count, 3)
  w2.host.onCouponCount.call(w2.host, ev || { detail: {} })
  eq('S8 宿主收到券数 → 顶栏角标数据就位', w2.host.data.couponCount, 3)
  w2.panel.setData({ usableCouponCount: 0 })
  w2.host.onCouponCount.call(w2.host, w2.panel.__events[w2.panel.__events.length - 1])
  eq('S8 券数归零也会同步（角标不会停在旧值）', w2.host.data.couponCount, 0)
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
  console.log(`✓ 钱包枢纽生命周期：${passed} 项通过（首屏不重复取数 / 回页会刷新 / 切后台停轮询 / 销毁清理 / 券数角标）`)
}

/**
 * 自检：注入回归 → 必须被检出 → 逐字还原源文件。
 * 另含一条「中性改动」负对照，证明本检查不是「文件一变就报错」。
 */
function selftest() {
  const P = PANEL_FILES
  const injections = [
    {
      name: '积分面板重新接上 pageLifetimes.show（与宿主转发双触发）',
      file: P.points,
      from: '  methods: _methods,\n',
      to: '  methods: _methods,\n  pageLifetimes: { show() { _methods.onShow.call(this) } },\n'
    },
    {
      name: '礼券夹面板重新接上 pageLifetimes.show（与宿主转发双触发）',
      file: P.coupons,
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
      name: '积分面板 ready 改名（首屏永不取数）',
      file: P.points,
      from: '    ready() {\n',
      to: '    readyX() {\n'
    },
    {
      name: '宿主不再转发 onShow（离开再回来不刷新）',
      file: HOST_JS,
      from: "    if (p && typeof p.onShow === 'function') p.onShow()\n",
      to: ''
    },
    {
      name: '宿主不再转发 onHide（切后台核销轮询不停）',
      file: HOST_JS,
      from: "    if (p && typeof p.onHide === 'function') p.onHide()\n",
      to: ''
    },
    {
      name: '礼券夹删掉 detached 清理（销毁后定时器遗留）',
      file: P.coupons,
      from: '    detached() {\n',
      to: '    detachedX() {\n'
    },
    {
      name: '礼券夹不再回传券数（顶栏角标停在 0）',
      file: P.coupons,
      from: "          this.triggerEvent('couponcount', { count: patch.usableCouponCount })\n",
      to: ''
    },
    {
      name: '宿主不把 couponCount 传给顶栏',
      file: HOST_WXML,
      from: ' coupon-count="{{couponCount}}"',
      to: ''
    },
    {
      name: '退回表被清空（未并入的 tab 点了没反应）',
      file: HOST_JS,
      from: "const PENDING_TAB_URL = {\n  wallet: '/subpackages/extra/user/stored-value/index'\n}\n",
      to: 'const PENDING_TAB_URL = {}\n'
    },
    {
      name: '退回页路径拼错（点 tab 直接跳失败）',
      file: HOST_JS,
      from: "  wallet: '/subpackages/extra/user/stored-value/index'",
      to: "  wallet: '/subpackages/extra/user/stored-value/index2'"
    },
    {
      name: 'applyTab 不再校验登记（curTab 可被切成不存在的面板）',
      file: HOST_JS,
      from: "    const key = PANELS[tab] ? tab : 'points'\n",
      to: "    const key = tab || 'points'\n"
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
    const r = withInjection(inj, () => (runChild().status === 0 ? '注入回归未被检出' : null))
    if (r) { console.log(`✗ ${r}：${inj.name}`); bad += 1 }
    else console.log(`  ✓ 已检出：${inj.name}`)
  }
  for (const c of controls) {
    const r = withInjection(c, () => (runChild().status === 0 ? null : `负对照误报（中性改动被当成回归）：${c.name}`))
    if (r) { console.log(`✗ ${r}`); bad += 1 }
    else console.log(`  ✓ ${c.name}`)
  }

  if (bad) {
    console.log(`✗ 自检失败：${bad} 项（${injections.length} 条注入 / ${controls.length} 条负对照）`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、${controls.length} 条负对照不误报、源文件逐字还原`)
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
