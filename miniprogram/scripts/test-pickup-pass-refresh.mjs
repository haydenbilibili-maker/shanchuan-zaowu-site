/**
 * #6 门店自取 · 核销联动（已自提水印 + 自动刷新）行为断言
 *
 * 为什么必须跑真源码：这条链路的三个关键行为**只在运行时**才成立 ——
 *   1. 店员在柜台核销（managerShipOrder.verifyPickup → orders.status='received' /
 *      pickupStatus='claimed'）后，顾客端必须**自己**收口成「本次自取已完成」，
 *      不能要求顾客手动下拉（原实现只有 15s 节流的 onShow + 下拉刷新）；
 *   2. 收口时二维码要盖「已自提」水印、且**自取码不再出示**，避免拿着旧码二次出示；
 *   3. 顾客一打开就是历史已核销单时**不得**弹「刚完成」反馈（否则每次进页面都像刚核销）。
 * 另外把「C 端不再称馆长」从文档口径升级为**可复现的守卫**（排除荣誉馆长 / 员工侧）。
 *
 * 用法：
 *   node miniprogram/scripts/test-pickup-pass-refresh.mjs
 *   node miniprogram/scripts/test-pickup-pass-refresh.mjs --selftest
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const PAGE = 'miniprogram/subpackages/business/pickup-pass/index.js'
const WXML = 'miniprogram/subpackages/business/pickup-pass/index.wxml'
const WXSS = 'miniprogram/subpackages/business/pickup-pass/index.wxss'
const MODEL = 'miniprogram/subpackages/business/utils/pickupPass.js'

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

/* ------------------------------------------------------------------ *
 * 回归注入：每个都必须让断言真的失败（否则守卫无效）
 * ------------------------------------------------------------------ */

const INJECTIONS = {
  'no-poll': {
    file: PAGE,
    from: 'this._pollTimer = setInterval(() => this.pollOrderStatus(), PASS_POLL_MS);',
    to: 'this._pollTimer = null;'
  },
  'no-stop-on-claim': {
    file: PAGE,
    from: 'if (claimedNow) {\n        this.stopWatching();',
    to: 'if (claimedNow) {'
  },
  'no-announce': {
    file: PAGE,
    from: 'this.announceClaimed();',
    to: 'void 0;'
  },
  'poll-forever': {
    file: PAGE,
    from: 'if (Date.now() - this._pollStartedAt > PASS_POLL_MAX_MS) {',
    to: 'if (false) {'
  },
  'no-read-dedup': {
    file: PAGE,
    from: 'if (this._loadingOrder) return this._loadingOrder;',
    to: 'if (false) return this._loadingOrder;'
  },
  'no-hide-stop': {
    file: PAGE,
    from: 'onHide() {\n    this.stopWatching();',
    to: 'onHide() {'
  },
  'wxml-drop-watermark': {
    file: WXML,
    from: 'class="pass-qr-stamp"',
    to: 'class="pass-qr-stamp-disabled"'
  },
  'wxml-show-code-when-done': {
    file: WXML,
    from: '<block wx:if="{{pass.statusTone !== \'done\'}}">',
    to: '<block wx:if="{{true}}">'
  },
  'copy-curator': {
    file: WXML,
    from: '需要帮助？联系专员 →',
    to: '需要帮助？联系馆长 →'
  }
}

const INJECT = String(process.env.PICKUP_PASS_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

const realSetTimeout = globalThis.setTimeout
const flush = () => new Promise((r) => realSetTimeout(r, 0))

/* ------------------------------------------------------------------ *
 * 1) 真源码 + 桩 wx / Page / require / 时钟
 * ------------------------------------------------------------------ */

const pageSrc = readSrc(PAGE)
const wxmlSrc = readSrc(WXML)
const wxssSrc = readFileSync(resolve(ROOT, WXSS), 'utf8')

/** 真实模型模块（不桩）：水印态由 buildPickupPass 判定，测的是同一条口径 */
function loadModel() {
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readFileSync(resolve(ROOT, MODEL), 'utf8'))(mod, mod.exports)
  return mod.exports
}
const model = loadModel()

function makeEnv() {
  const state = { order: null, reads: 0, toasts: [], vibrates: 0, brightness: [], intervals: [], clock: 1000000 }
  const timers = []
  const wx = {
    cloud: {
      database: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              state.reads += 1
              return { data: state.order }
            }
          })
        })
      })
    },
    hideShareMenu: () => {},
    showToast: (o) => state.toasts.push(o),
    vibrateShort: () => { state.vibrates += 1 },
    getScreenBrightness: ({ success, complete }) => {
      if (success) success({ value: 0.6 })
      if (complete) complete()
    },
    setScreenBrightness: (o) => state.brightness.push(o && o.value),
    stopPullDownRefresh: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    switchTab: () => {},
    showModal: () => {}
  }
  const requireFn = (id) => {
    if (id === '../utils/pickupPass') return model
    if (id === '../utils/qrCanvas') return { drawMemberQr: () => Promise.resolve(true) }
    if (id === '../../../utils/storeCatalog') {
      return { fetchStoreCatalog: async () => [], findCatalogStore: () => null }
    }
    if (id === '../../../utils/orderScope') {
      return { ensureOpenId: async () => 'openid-1', canAccessOrder: () => true, denyOrderAccess: () => {} }
    }
    if (id === '../utils/refundPolicy') return { canUserRequestRefund: () => ({ ok: false }) }
    throw new Error('unexpected require ' + id)
  }
  let def = null
  // eslint-disable-next-line no-new-func
  new Function('require', 'Page', 'getApp', 'wx', 'setInterval', 'clearInterval', 'setTimeout', 'Date', pageSrc)(
    requireFn,
    (d) => { def = d },
    () => ({ globalData: {} }),
    wx,
    (fn, ms) => {
      const t = { fn, ms, cleared: false }
      timers.push(t)
      state.intervals.push(ms)
      return t
    },
    (t) => { if (t) t.cleared = true },
    () => 0,
    { now: () => state.clock }
  )
  if (!def) throw new Error('Page() 未被调用')
  return { def, state, timers }
}

function makePage(env) {
  const page = {}
  Object.keys(env.def).forEach((k) => {
    if (typeof env.def[k] === 'function') page[k] = env.def[k].bind(page)
  })
  page.data = JSON.parse(JSON.stringify(env.def.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

const activeTimers = (env) => env.timers.filter((t) => !t.cleared)
const tick = (env) => activeTimers(env).forEach((t) => t.fn())

const READY_ORDER = {
  _id: 'o1',
  _openid: 'openid-1',
  orderNo: 'SC20260916001',
  storeId: 'main',
  storeName: '山川造物主店',
  storePickup: true,
  pickupCode: '034757D363',
  status: 'ready_pickup',
  pickupStatus: 'pending'
}
const CLAIMED_ORDER = {
  ...READY_ORDER,
  status: 'received',
  pickupStatus: 'claimed',
  pickupClaimedAt: new Date('2026-09-16T17:29:00+08:00')
}

/** 建页并走完 onLoad → onShow 的首个微任务周期 */
async function openPage(order, options) {
  const env = makeEnv()
  env.state.order = order
  const page = makePage(env)
  page.onLoad(options || { id: 'o1', code: '034757D363' })
  page.onShow()
  await flush()
  return { env, page }
}

/* ------------------------------------------------------------------ *
 * 2) 待领取：自动轮询 + 读到核销后收口成「已自提」
 * ------------------------------------------------------------------ */

{
  const { env, page } = await openPage(READY_ORDER)
  eq('待领取时启动 3s 轮询', activeTimers(env).length, 1)
  eq('轮询周期为 3000ms', env.state.intervals[0], 3000)
  eq('首屏状态为待领取（可领取）', page.data.pass.statusTone, 'ready')
  eq('首屏不弹完成反馈', env.state.toasts.length, 0)
  const readsAfterOpen = env.state.reads
  eq('onLoad 只读一次订单（onShow 被节流避开，不重复拉）', readsAfterOpen, 1)

  tick(env)
  await flush()
  eq('轮询命中一次读库', env.state.reads, readsAfterOpen + 1)
  check('已看到待领取基线（用于区分历史核销）', page._sawPending === true)

  // 柜台核销：managerShipOrder.verifyPickup 写回 status=received / pickupStatus=claimed
  env.state.order = CLAIMED_ORDER
  tick(env)
  await flush()

  eq('★ 核销后自动收口为 done（已交付）', page.data.pass.statusTone, 'done')
  eq('★ 收口 headline 为「本次自取已完成」', page.data.pass.headline, '本次自取已完成')
  check('★ 核销时间已展示', /\d{4}\.\d{1,2}\.\d{1,2} \d{2}:\d{2}/.test(page.data.claimedAtText), page.data.claimedAtText)
  eq('★ 收口后停止轮询', activeTimers(env).length, 0)
  eq('★ 收口给顾客明确反馈（toast 一次）', env.state.toasts.length, 1)
  eq('★ 收口震动一次', env.state.vibrates, 1)
  check('★ 凭证已收口即恢复屏幕亮度（不再维持最亮）', env.state.brightness.indexOf(0.6) >= 0, JSON.stringify(env.state.brightness))
  eq('收口后不再申请退款入口', page.data.showRefundEntry, false)

  // 已经收口：再 tick 也不会重复读库 / 重复提示
  tick(env)
  await flush()
  eq('收口后不再读库', env.state.reads, readsAfterOpen + 2)
  eq('收口后不再重复提示', env.state.toasts.length, 1)
}

/* ------------------------------------------------------------------ *
 * 3) 历史已核销：打开即终态，但不得误报「刚刚完成」
 * ------------------------------------------------------------------ */

{
  const { env, page } = await openPage(CLAIMED_ORDER)
  eq('历史已核销：直接是 done 态', page.data.pass.statusTone, 'done')
  eq('★ 历史已核销不弹「刚完成」提示', env.state.toasts.length, 0)
  eq('★ 历史已核销不震动', env.state.vibrates, 0)
  eq('历史已核销不轮询', activeTimers(env).length, 0)
}

/* ------------------------------------------------------------------ *
 * 4) 生命周期：隐藏 / 卸载必须停表；回到前台重新盯
 * ------------------------------------------------------------------ */

{
  const { env, page } = await openPage(READY_ORDER)
  eq('前台在盯', activeTimers(env).length, 1)
  page.onHide()
  eq('★ onHide 停止轮询（不后台空转）', activeTimers(env).length, 0)
  page.onShow()
  eq('回到前台重新盯', activeTimers(env).length, 1)
  page.onUnload()
  eq('★ onUnload 停止轮询', activeTimers(env).length, 0)
}

/* ------------------------------------------------------------------ *
 * 5) 只有自取码（无订单号）不许查库：顾客不能按码查别人订单
 * ------------------------------------------------------------------ */

{
  const { env, page } = await openPage(READY_ORDER, { code: '034757D363' })
  eq('★ 无订单号不轮询', activeTimers(env).length, 0)
  eq('★ 无订单号不读库', env.state.reads, 0)
  eq('无订单号标为待核实', page.data.statusUnknown, true)
  eq('无订单号仍可出示自取码', page.data.code, '034757D363')
}

/* ------------------------------------------------------------------ *
 * 6) 并发读库去重 + 轮询上限
 * ------------------------------------------------------------------ */

{
  const { env, page } = await openPage(READY_ORDER)
  const before = env.state.reads
  const p1 = page.loadOrder('o1', { silent: true })
  const p2 = page.loadOrder('o1', { silent: true })
  await Promise.all([p1, p2])
  await flush()
  eq('★ 并发读库只发一次请求', env.state.reads, before + 1)
  eq('并发两次调用返回同一 Promise', p1, p2)
}

{
  const { env } = await openPage(READY_ORDER)
  const before = env.state.reads
  // 超过 15 分钟：停表，不再空耗
  env.state.clock += 16 * 60 * 1000
  tick(env)
  await flush()
  eq('★ 超过轮询上限后停止轮询', activeTimers(env).length, 0)
  eq('★ 上限触发的那一次也不再读库', env.state.reads, before)
}

/* ------------------------------------------------------------------ *
 * 7) WXML/WXSS：已自提水印 + 收口不再出示自取码
 * ------------------------------------------------------------------ */

{
  const stamp = wxmlSrc.match(/class="pass-qr-stamp"[^>]*>([^<]*)</)
  check('★ 二维码水印文案为「已自提」', !!stamp && stamp[1] === '已自提', stamp && stamp[1])
  check(
    '★ 水印只在 done 态出现',
    /class="pass-qr-wrap \{\{pass\.statusTone === 'done' \? 'pass-qr-used' : ''\}\}"/.test(wxmlSrc) &&
      /wx:if="\{\{pass\.statusTone === 'done'\}\}" aria-hidden="true">已自提</.test(wxmlSrc)
  )
  check('二维码 canvas 全页唯一（避免 selectorQuery 取到旧节点）', (wxmlSrc.match(/id="passQrCanvas"/g) || []).length === 1)
  check(
    '★ done 态不再出示自取码（code-row 收在「非 done」分支内）',
    /<block wx:if="\{\{pass\.statusTone !== 'done'\}\}">[\s\S]*pass-code-row[\s\S]*?<\/block>/.test(wxmlSrc)
  )
  check('★ done 态提示不再可扫', /此自取码已核销，请勿再次出示/.test(wxmlSrc))
  check('恢复亮度：水印态码面变灰', /\.pass-qr-used \.pass-qr \{[\s\S]*?opacity:/.test(wxssSrc))
  check('水印层压住码面（absolute + z-index）', /\.pass-qr-stamp \{[\s\S]*?position: absolute;[\s\S]*?z-index: 2;/.test(wxssSrc))
  check('页面提示已改为「自动更新」而非只靠下拉', /店员核销后本页自动更新/.test(wxmlSrc))
}

/* ------------------------------------------------------------------ *
 * 8) 术语守卫：C 端不再出现「馆长」（荣誉馆长 / 员工侧 / 云函数除外）
 * ------------------------------------------------------------------ */

{
  const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', '.tmp', 'docs', 'scripts'])
  const hits = []
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        // 员工/后台侧（店长·馆长口径）与云函数不在 C 端口径内。
        // 不能再写死 `subpackages/manager`：2026-09-16 包体优化把 16 个后台分组
        // 搬到了 subpackages/extra/*，写死前缀会让店主后台页面漏进 C 端扫描（假阳性）。
        // 口径改为「后台 = manager 全部 + extra 里除 user 以外的全部」，
        // 将来分组再搬迁也不会失效。
        const rel = relative(MP, full).replace(/\\/g, '/')
        const isBackOffice = rel.startsWith('subpackages/manager')
          || (rel.startsWith('subpackages/extra/') && !rel.startsWith('subpackages/extra/user'))
        if (isBackOffice || rel.startsWith('cloudfunctions')) continue
        walk(full)
        continue
      }
      if (!/\.(js|wxml|json|wxss|mjs)$/.test(name)) continue
      const rel = relative(ROOT, full).replace(/\\/g, '/')
      let text
      try { text = readSrc(rel) } catch (e) { continue }
      text.split('\n').forEach((line, i) => {
        if (!line.includes('馆长')) return
        if (line.includes('荣誉馆长')) return
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`)
      })
    }
  }
  walk(MP)
  check('★ C 端代码已无「馆长」（荣誉馆长 / 员工侧 / 云函数除外）', hits.length === 0, hits.slice(0, 5).join(' | '))
  check('★ 自取凭证页脚为「联系专员」', /需要帮助？联系专员 →/.test(wxmlSrc))
  check('模型文案已改「专员」', /专员正在备妥/.test(readFileSync(resolve(ROOT, MODEL), 'utf8')))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, PICKUP_PASS_INJECT: name },
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

console.log(`\n#6 门店自取核销联动断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 核销联动通过（自动收口 / 已自提水印 / 历史核销不误报 / 停表与去重 / 术语守卫）')
