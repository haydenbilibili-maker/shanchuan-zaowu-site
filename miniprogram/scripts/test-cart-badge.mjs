#!/usr/bin/env node
/**
 * test:cart-badge —— 购物车红色角标不因切 tab / 拉取失败而消失（2026-11-25 产品负责人：点「我的」角标消失）
 *
 * 真跑 utils/cartHelper.js（桩 wx / getApp）：
 *   C1 数量未知（null）时**不写**角标：不许把「拉取失败」显示成 0 件
 *   C2 明确数量才写：globalData 与本地兜底键同步落盘
 *   C3 拉取失败返回 null（而不是 0），refresh 不覆盖旧值
 *   C4 tab 栏：globalData 为 0 时用本地兜底恢复（本机退出态除外）；setCartBadge 正数才落盘
 *   C5 本机退出时清掉兜底键，避免换号串号
 *
 *   node miniprogram/scripts/test-cart-badge.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const F = {
  helper: join(MP, 'utils/cartHelper.js'),
  tabBar: join(MP, 'custom-tab-bar/index.js'),
  userJs: join(MP, 'pages/user/index.js')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))

function makeEnv({ saved = 0 } = {}) {
  const store = {}
  if (saved) store.cart_badge_count_v1 = saved
  const g = { globalData: { cartBadgeCount: 0 } }
  const wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: (k) => { delete store[k] },
    cloud: null,
    getStorageSyncRaw: () => store
  }
  return { store, g, wx, getApp: () => g }
}

function load(env) {
  return loadCjsModule(F.helper, {
    transform,
    stubs: { './orderScope': { ensureOpenId: async () => 'o1' } },
    globals: { wx: env.wx, getApp: env.getApp, getCurrentPages: () => [] }
  })
}

function runChecks() {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }

  // C1 / C2
  const env = makeEnv()
  const H = load(env)
  H.updateCartTabBadge(3)
  const afterSet = env.g.globalData.cartBadgeCount
  const savedAfter = env.store.cart_badge_count_v1
  H.updateCartTabBadge(null)
  ok(afterSet === 3 && savedAfter === 3, 'C1/C2 明确数量要同时写入 globalData 与本地兜底键')
  ok(env.g.globalData.cartBadgeCount === 3 && env.store.cart_badge_count_v1 === 3, 'C1 数量未知时不得把角标清成 0')

  // C3
  env.wx.cloud = { callFunction: async () => { throw new Error('network') }, database: () => ({}) }
  return (async () => {
    const count = await H.fetchCartCount(env.getApp())
    ok(count === null, 'C3 拉取失败应返回 null（不是 0）')
    const kept = await H.refreshCartTabBadge(env.getApp())
    ok(kept === null && env.g.globalData.cartBadgeCount === 3, 'C3 刷新失败不得覆盖已有角标')

    // C4 / C5 静态：tab 栏兜底与退出清键
    const tab = read(F.tabBar)
    const user = read(F.userJs)
    ok(/readSavedBadge\(\)/.test(tab) && /isLocalLoggedOut\(\)/.test(tab), 'C4 tab 栏在 globalData 为 0 时要用本地兜底（退出态除外）')
    ok(/saveBadge\(n\)/.test(tab), 'C4 tab 栏恢复值要回写本地兜底')
    ok(/removeStorageSync\('cart_badge_count_v1'\)/.test(user), 'C5 本机退出要清掉兜底键')
    return fails
  })()
}

if (process.argv.includes('--selftest')) {
  const base = await runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  const INJ = [
    { name: '未知数量写成 0', file: F.helper, find: '  if (count == null) return\n', replace: '' },
    { name: '拉取失败返回 0', file: F.helper, find: '    console.warn(\'fetchCartCount cloud failed\', e)\n  }\n\n  const openid', replace: '    return 0\n  }\n\n  const openid' },
    { name: 'tab 栏不做兜底', file: F.tabBar, find: 'if (!loggedOut) count = readSavedBadge();', replace: '' },
    { name: '退出不清键', file: F.userJs, find: "try { wx.removeStorageSync('cart_badge_count_v1'); } catch (e) { /* ignore */ }", replace: '' }
  ]
  let bad = 0
  for (const inj of INJ) {
    INJECT = inj
    let res = []
    try { res = await runChecks() } catch (e) { res = [String(e.message || e)] }
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  INJECT = null
  if (bad) { console.error(`\n✗ test:cart-badge 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${INJ.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ 购物车角标不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:cart-badge：未知数量不覆盖 / 失败返回 null / tab 栏本地兜底 / 退出清键 全部通过')
}
