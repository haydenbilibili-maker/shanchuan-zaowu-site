/**
 * 祈福墙「仪式档案云存储」行为断言
 *
 * 覆盖的是一层**持久化 + 合并**逻辑，最容易出错的地方都不是"页面好不好看"，而是：
 *   1. 合并语义两处各写一遍 → 漂移（云函数与客户端算出来的档案不一致）；
 *   2. 合并用"最新覆盖"而不是"只前进" → 换手机后第一次同步把云端已有记录清零；
 *   3. 服务端不校验 → 一次手搓请求就能写 streak=9999 / 未来日期；
 *   4. 校验写太死（例如读不到 updateTime 就拒绝）→ 用户的本地权威档案永远同步不上；
 *   5. 幂等写成"每次都加一点" → 重复调用结果不一致；
 *   6. 云端失败把本地也带崩 → 网络挂了就不能点灯（本功能的核心底线）。
 *
 * 纯函数核（合并/校验）**逐字节同源**于两处，本脚本逐字节比对，防"改一份忘另一份"。
 *
 * 用法：
 *   node miniprogram/scripts/test-ritual-profile.mjs
 *   node miniprogram/scripts/test-ritual-profile.mjs --selftest
 *
 * ⚠️ 本脚本**尚未登记进守卫链**（`guards/20-wish-wall.txt` 与 `package.json` 的
 *    `test:ritual-profile` 归集成官，见交付说明）；先按上面的命令直接跑。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, isBuiltin } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const nodeRequire = createRequire(import.meta.url)

const R = (p) => resolve(ROOT, p)
const CORE_PATH = R('miniprogram/subpackages/feature/utils/ritualProfileCore.js')
const CORE_COPY_PATH = R('miniprogram/cloudfunctions/wishRitualProfile/ritualProfileCore.js')
const CLOUD_INDEX = R('miniprogram/cloudfunctions/wishRitualProfile/index.js')

/**
 * 小程序代码是 CommonJS，但本仓根 `package.json` 有 `"type": "module"`，
 * Node 的 `require()` 会把 `.js` 当 ESM 拒绝 —— 所以照 `test-wish-wall.mjs` 的既有形态，
 * 用 `new Function` + 自实现的 require 加载（顺带能对 `wx-server-sdk` 打桩）。
 */
function readSrc(file) {
  return readFileSync(resolve(ROOT, file), 'utf8')
}

const markerRequire = (id) => { throw new Error('unexpected require ' + id) }

function loadSibling(baseFile, id, cache) {
  const abs = resolve(dirname(resolve(ROOT, baseFile)), id)
  let rel = relative(ROOT, abs).replace(/\\/g, '/')
  if (!rel.endsWith('.js')) rel += '.js'
  return loadCjs(rel, {
    require: (name) => { throw new Error('unexpected require ' + name) },
    _cache: cache
  })
}

function loadCjs(file, { require: req, _cache } = {}) {
  const cache = _cache || new Map()
  if (cache.has(file)) return cache.get(file)
  const module = { exports: {} }
  cache.set(file, module.exports)
  const fallback = req || (() => { throw new Error('require not stubbed') })
  const localRequire = (id) => {
    const name = String(id)
    try {
      return fallback(name)
    } catch (e) {
      const marker = `unexpected require ${name}`
      if (!e || e.message !== marker) throw e
      if (name.startsWith('./') || name.startsWith('../')) return loadSibling(file, name, cache)
      if (isBuiltin(name)) return nodeRequire(name)
      throw e
    }
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readSrc(file))(module, module.exports, localRequire)
  cache.set(file, module.exports)
  return module.exports
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
function record(list, prefix) {
  for (const r of list) {
    if (r.cond) passed += 1
    else {
      failed += 1
      failures.push(`${prefix}${r.name}${r.extra ? ' — ' + r.extra : ''}`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 0) 契约面：文件同源 / 三处同步 / 云函数登记
 * ------------------------------------------------------------------ */

const core = loadCjs('miniprogram/subpackages/feature/utils/ritualProfileCore.js', { require: markerRequire })
const coreCopy = loadCjs('miniprogram/cloudfunctions/wishRitualProfile/ritualProfileCore.js', { require: markerRequire })
const wishRitual = loadCjs('miniprogram/subpackages/feature/utils/wishRitual.js', { require: markerRequire })
const ritualProfile = loadCjs('miniprogram/subpackages/feature/utils/ritualProfile.js', { require: markerRequire })

function isIdenticalText(a, b) {
  return String(a) === String(b)
}

const coreText = readFileSync(CORE_PATH, 'utf8')
const coreCopyText = readFileSync(CORE_COPY_PATH, 'utf8')
check(
  '纯函数核两份副本逐字节同源（客户端 ↔ 云函数）',
  isIdenticalText(coreText, coreCopyText),
  '改一份必须同步另一份；否则合并语义漂移'
)
eq('STREAK_MAX 与本地存档窗口 KEEP_DAYS 一致（防两处漂移）', core.STREAK_MAX, wishRitual.KEEP_DAYS)

const rule = JSON.parse(readFileSync(R('cloudbase/rules/wish_ritual_profiles.json'), 'utf8'))
eq('集合规则 write 必须为 false（禁止客户端直写绕过校验）', rule.write, false)
check(
  '集合规则 read 按 _openid 隔离（只能读自己的）',
  /_openid/.test(rule.read) && /auth/.test(rule.read),
  JSON.stringify(rule.read)
)
const schemaText = readFileSync(R('cloudbase/schema/wish_ritual_profiles.md'), 'utf8')
check('schema 文档写清 write:false 的原因（防绕过校验）', /write: false|`write: false`/.test(schemaText))
check('schema 文档给出合并语义（三个字段各自取法）', /较大值/.test(schemaText) && /更晚的一天/.test(schemaText))
check('schema 文档给出文档示例', /"streak"/.test(schemaText) && /"lastLitDayKey"/.test(schemaText))
check(
  'admin/src/cloud.js 的 COLLECTIONS 已登记 wish_ritual_profiles',
  /WISH_RITUAL_PROFILES:\s*'wish_ritual_profiles'/.test(readFileSync(R('admin/src/cloud.js'), 'utf8'))
)
const cloudbaseRc = JSON.parse(readFileSync(R('miniprogram/cloudbaserc.json'), 'utf8'))
check(
  'cloudbaserc.json 已登记 wishRitualProfile（否则部署不到线上）',
  (cloudbaseRc.functions || []).some((f) => f && f.name === 'wishRitualProfile'),
  '缺少登记 → 云函数永远不会被部署'
)
check('云函数目录至少含 index.js / package.json / ritualProfileCore.js', ['index.js', 'package.json', 'ritualProfileCore.js']
  .every((f) => existsSync(resolve(dirname(CLOUD_INDEX), f))))
eq('客户端封装的云函数名与目录/登记一致', ritualProfile.CLOUD_FN, 'wishRitualProfile')

/* ------------------------------------------------------------------ *
 * 1) 纯函数核：合并语义 / 校验 / 跳变闸
 * ------------------------------------------------------------------ */

/** 在给定实现上跑全部纯函数断言，返回失败清单（用于 --selftest 证明断言会失败） */
function coreChecks(C) {
  const out = []
  const t = (name, cond, extra) => out.push({ name, cond: !!cond, extra })
  const cEq = (name, got, want) => t(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  const cDeep = (name, got, want) =>
    t(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

  // 1a. 日期键严格解析
  t('非法日期键被拒：2026-1-1', C.isValidDayKey('2026-1-1') === false)
  t('非法日期键被拒：2026-02-30', C.isValidDayKey('2026-02-30') === false)
  t('非法日期键被拒：2026-13-01', C.isValidDayKey('2026-13-01') === false)
  t('非法日期键被拒：空串', C.isValidDayKey('') === false)
  t('非法日期键被拒：非字符串', C.isValidDayKey(20260920) === false)
  t('合法日期键通过', C.isValidDayKey('2026-09-20') === true)
  cEq('日期键 ± 天（跨月）', C.shiftDayKey('2026-03-01', -1), '2026-02-28')
  cEq('日期键 ± 天（跨年）', C.shiftDayKey('2026-01-01', -1), '2025-12-31')
  cEq('日期差', C.dayDiff('2026-09-20', '2026-09-01'), 19)
  cEq('更晚的一天', C.laterDayKey('2026-09-01', '2026-09-20'), '2026-09-20')
  cEq('一端为空取另一端', C.laterDayKey('', '2026-09-20'), '2026-09-20')
  cEq('两端都空仍为空', C.laterDayKey('', ''), '')

  // 1b. 合并语义：逐字段取优
  cDeep('合并取 max/更晚日', C.mergeProfiles(
    { streak: 3, lastLitDayKey: '2026-09-18', muyuCount: 10 },
    { streak: 5, lastLitDayKey: '2026-09-20', muyuCount: 4 }
  ), { streak: 5, lastLitDayKey: '2026-09-20', muyuCount: 10 })
  cDeep('本地更大时不被云端改小（换手机场景）', C.mergeProfiles(
    { streak: 9, lastLitDayKey: '2026-09-20', muyuCount: 100 },
    { streak: 0, lastLitDayKey: '', muyuCount: 0 }
  ), { streak: 9, lastLitDayKey: '2026-09-20', muyuCount: 100 })
  cDeep('云端更大时本地被提升（跨设备场景）', C.mergeProfiles(
    { streak: 1, lastLitDayKey: '2026-09-19', muyuCount: 1 },
    { streak: 6, lastLitDayKey: '2026-09-20', muyuCount: 30 }
  ), { streak: 6, lastLitDayKey: '2026-09-20', muyuCount: 30 })

  // 幂等 / 交换：同一份输入重复调用结果一致（不会累加、不会抖动）
  const a = { streak: 4, lastLitDayKey: '2026-09-20', muyuCount: 7 }
  const b = { streak: 2, lastLitDayKey: '2026-09-18', muyuCount: 11 }
  const m = C.mergeProfiles(a, b)
  cDeep('merge 幂等：merge(merge(a,b),a) === merge(a,b)', C.mergeProfiles(m, a), m)
  cDeep('merge 幂等：merge(m,m) === m', C.mergeProfiles(m, m), m)
  cDeep('merge 可交换：merge(a,b) === merge(b,a)', C.mergeProfiles(a, b), C.mergeProfiles(b, a))
  t('sameProfile 判定无变化的档案', C.sameProfile(m, C.mergeProfiles(m, a)) === true)

  // 1c. 取值校验（服务端"拒绝不可能的值"）
  const todayKey = '2026-09-20'
  t('校验接受合法档案', C.validateProfileInput({ streak: 7, lastLitDayKey: '2026-09-20', muyuCount: 512 }, { todayKey }).ok === true)
  t('校验接受空档案', C.validateProfileInput({}, { todayKey }).ok === true)
  t('校验接受"从未点灯"空串', C.validateProfileInput({ lastLitDayKey: '' }, { todayKey }).ok === true)
  t('校验接受上界值 streak=STREAK_MAX', C.validateProfileInput({ streak: C.STREAK_MAX }, { todayKey }).ok === true)
  const negStreak = C.validateProfileInput({ streak: -1 }, { todayKey })
  t('拒绝负 streak', negStreak.ok === false && negStreak.code === 'OUT_OF_RANGE')
  const negMuyu = C.validateProfileInput({ muyuCount: -5 }, { todayKey })
  t('拒绝负 muyuCount', negMuyu.ok === false && negMuyu.code === 'OUT_OF_RANGE')
  const overStreak = C.validateProfileInput({ streak: C.STREAK_MAX + 1 }, { todayKey })
  t('拒绝超过窗口的 streak', overStreak.ok === false && overStreak.code === 'OUT_OF_RANGE')
  const overMuyu = C.validateProfileInput({ muyuCount: C.MUYU_MAX + 1 }, { todayKey })
  t('拒绝超过绝对上界的 muyuCount', overMuyu.ok === false && overMuyu.code === 'OUT_OF_RANGE')
  const floatStreak = C.validateProfileInput({ streak: 2.5 }, { todayKey })
  t('拒绝非整数 streak', floatStreak.ok === false && floatStreak.code === 'INVALID_TYPE')
  const strStreak = C.validateProfileInput({ streak: '7' }, { todayKey })
  t('拒绝数字字符串 streak（不静默 coerce）', strStreak.ok === false && strStreak.code === 'INVALID_TYPE')
  const future = C.validateProfileInput({ lastLitDayKey: '2026-09-21' }, { todayKey })
  t('拒绝未来日期', future.ok === false && future.code === 'FUTURE_DAY_KEY')
  const tooOld = C.validateProfileInput({ lastLitDayKey: '2025-12-31' }, { todayKey })
  t('拒绝早于功能上限的日期（脏数据）', tooOld.ok === false && tooOld.code === 'DAY_KEY_TOO_OLD')
  const badDay = C.validateProfileInput({ lastLitDayKey: '2026-02-30' }, { todayKey })
  t('拒绝不存在的日期（2026-02-30）', badDay.ok === false && badDay.code === 'INVALID_DAY_KEY')
  t('整份拒绝时不落任何字段（profile 不返回）', negStreak.profile === undefined)

  // 1d. 跳变闸
  const now = Date.UTC(2026, 8, 20, 4, 0, 0)
  const jumpOk = C.checkMonotonicJump(
    { streak: 3, lastLitDayKey: '2026-09-19', muyuCount: 10 },
    { streak: 4, lastLitDayKey: '2026-09-20', muyuCount: 12 },
    { nowMs: now, prevUpdateMs: now - 24 * 3600 * 1000 }
  )
  t('正常 +1 天 / 少量功德放行', jumpOk.ok === true)
  const streakJump = C.checkMonotonicJump(
    { streak: 1, lastLitDayKey: '2026-09-19', muyuCount: 0 },
    { streak: 30, lastLitDayKey: '2026-09-20', muyuCount: 0 },
    { nowMs: now, prevUpdateMs: now - 1000 }
  )
  t('streak 单次跳变过大被拒', streakJump.ok === false && streakJump.code === 'STREAK_JUMP')
  const muyuJump = C.checkMonotonicJump(
    { streak: 0, lastLitDayKey: '', muyuCount: 10 },
    { streak: 0, lastLitDayKey: '', muyuCount: 999999 },
    { nowMs: now, prevUpdateMs: now - 1000 }
  )
  t('muyuCount 单次跳变过大被拒', muyuJump.ok === false && muyuJump.code === 'MUYU_JUMP')
  const muyuAfterHour = C.checkMonotonicJump(
    { streak: 0, lastLitDayKey: '', muyuCount: 10 },
    { streak: 0, lastLitDayKey: '', muyuCount: 2000 },
    { nowMs: now, prevUpdateMs: now - 3600 * 1000 }
  )
  t('离线攒下的功德在更长窗口内放行（不是永久拒绝）', muyuAfterHour.ok === true)
  const noTime = C.checkMonotonicJump(
    { streak: 0, lastLitDayKey: '', muyuCount: 0 },
    { streak: 25, lastLitDayKey: '2026-09-20', muyuCount: 500000 },
    { nowMs: now, prevUpdateMs: 0 }
  )
  t('读不到上次改动时刻时放行（不把本地权威数据永久挡在门外）', noTime.ok === true)

  return out
}

const realCoreFailures = coreChecks(core)
record(realCoreFailures, '[core] ')
check('纯函数核自身零失败（--selftest 的对照）', realCoreFailures.every((r) => r.cond), `${realCoreFailures.filter((r) => !r.cond).length} 条失败`)

/* ------------------------------------------------------------------ *
 * 2) 客户端封装：本地快照 / 恢复回填 / 失败静默降级
 * ------------------------------------------------------------------ */

// 内存版 wx 存储桩（wishRitual 读写都走 wx.getStorageSync / setStorageSync）
const store = new Map()
const baseWx = {
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => { store.set(k, v) },
  removeStorageSync: (k) => { store.delete(k) }
}
globalThis.wx = baseWx
function resetStore() {
  store.clear()
  delete globalThis.wx.cloud
}

// 2a. 纯函数：本地快照 / 恢复计划
const snapEmpty = ritualProfile.snapshotFromState({ days: {} }, 0)
check('空存档快照为全 0', snapEmpty.streak === 0 && snapEmpty.lastLitDayKey === '' && snapEmpty.muyuCount === 0)
const snap = ritualProfile.snapshotFromState(
  { days: { '2026-09-18': { litAt: 1 }, '2026-09-19': { litAt: 2 }, '2026-09-20': { litAt: 3 } } },
  7
)
eq('快照连续天数 = 3', snap.streak, 3)
eq('快照最近点灯日', snap.lastLitDayKey, '2026-09-20')
eq('快照功德', snap.muyuCount, 7)
const snapGap = ritualProfile.snapshotFromState(
  { days: { '2026-09-17': { litAt: 1 }, '2026-09-19': { litAt: 2 }, '2026-09-20': { litAt: 3 } } },
  0
)
eq('断档后只算截至最近连续段（19→20 = 2）', snapGap.streak, 2)
check('快照锚点是最近点灯日（今天没点也不为 0）', snap.streak === 3)
eq('恢复计划按从早到晚给出日期', JSON.stringify(ritualProfile.planRestoreDays({ streak: 3, lastLitDayKey: '2026-09-20' })),
  JSON.stringify(['2026-09-18', '2026-09-19', '2026-09-20']))
eq('streak=0 不恢复任何日期', ritualProfile.planRestoreDays({ streak: 0, lastLitDayKey: '2026-09-20' }).length, 0)
eq('无锚点不恢复任何日期', ritualProfile.planRestoreDays({ streak: 5, lastLitDayKey: '' }).length, 0)
eq('恢复计划钳到本地窗口（99 → 30）', ritualProfile.planRestoreDays({ streak: 99, lastLitDayKey: '2026-09-20' }).length, core.STREAK_MAX)

// 2b. 回填本地：读得回来，且不超窗口
resetStore()
const after1 = ritualProfile.applyProfileToLocal({ streak: 3, lastLitDayKey: '2026-09-20', muyuCount: 12 })
eq('回填后本地连续天数 = 3', after1.streak, 3)
eq('回填后本地功德 = 12', after1.muyuCount, 12)
eq('回填后本地最近点灯日', after1.lastLitDayKey, '2026-09-20')
resetStore()
const after2 = ritualProfile.applyProfileToLocal({ streak: 99, lastLitDayKey: '2026-09-20', muyuCount: 1 })
eq('超窗口回填被钳到 30', after2.streak, core.STREAK_MAX)
check('超窗口回填后本地实际日期键 ≤ 30', Object.keys(wishRitual.readState().days).length <= core.STREAK_MAX,
  `got ${Object.keys(wishRitual.readState().days).length}`)

// 2c. 降级路径：没有 wx.cloud / 调用抛错 / 服务端拒绝 → 本地照常可用
resetStore()
wishRitual.writeMuyuCount(5)
wishRitual.lightLamp('2026-09-20') // 本地已经有状态
const localBefore = ritualProfile.readLocalProfile()
const noCloudLoad = await ritualProfile.loadFromCloud()
check('wx.cloud 缺失时 loadFromCloud 不抛、返回降级', noCloudLoad.ok === false && noCloudLoad.degraded === true)
eq('降级时返回本地档案（streak）', noCloudLoad.profile.streak, localBefore.streak)
eq('降级时返回本地档案（muyu）', noCloudLoad.profile.muyuCount, 5)
const noCloudSync = await ritualProfile.syncToCloud()
check('wx.cloud 缺失时 syncToCloud 不抛、返回降级', noCloudSync.ok === false && noCloudSync.degraded === true)
eq('降级后本地功德未被清零', wishRitual.readMuyuCount(), 5)
eq('降级后本地点灯记录仍在', wishRitual.getLamp('2026-09-20').lit, true)

resetStore()
wishRitual.writeMuyuCount(9)
globalThis.wx.cloud = { callFunction: async () => { throw new Error('network down') } }
const throwLoad = await ritualProfile.loadFromCloud()
check('callFunction 抛错时 loadFromCloud 静默降级', throwLoad.ok === false && throwLoad.degraded === true)
eq('抛错后本地功德仍在', wishRitual.readMuyuCount(), 9)
const throwSync = await ritualProfile.syncToCloud()
check('callFunction 抛错时 syncToCloud 静默降级', throwSync.ok === false && throwSync.degraded === true)
eq('抛错后本地功德仍为 9', wishRitual.readMuyuCount(), 9)

resetStore()
globalThis.wx.cloud = { callFunction: async () => ({ result: { success: false, code: 'MUYU_JUMP', msg: '跳变过大' } }) }
const rejected = await ritualProfile.syncToCloud()
check('服务端拒绝时客户端降级并带 code', rejected.ok === false && rejected.degraded === true && rejected.code === 'MUYU_JUMP')

// 2d. 正常路径：推送负载正确 / 云端合并结果回填本地
resetStore()
wishRitual.writeMuyuCount(4)
wishRitual.lightLamp('2026-09-20')
let sent = null
globalThis.wx.cloud = {
  callFunction: async (args) => {
    sent = args
    return { result: { success: true, changed: true, profile: { streak: 8, lastLitDayKey: '2026-09-20', muyuCount: 90 } } }
  }
}
const syncOk = await ritualProfile.syncToCloud()
check('正常同步返回 ok', syncOk.ok === true && syncOk.degraded === false)
eq('推送给云函数的 action', sent && sent.data && sent.data.action, 'sync')
eq('推送给云函数的云函数名', sent && sent.name, 'wishRitualProfile')
eq('推送 payload 含本地 streak', sent.data.streak, 1)
eq('推送 payload 含本地 lastLitDayKey', sent.data.lastLitDayKey, '2026-09-20')
eq('推送 payload 含本地 muyuCount', sent.data.muyuCount, 4)
eq('云端更大的 streak 回填本地', ritualProfile.readLocalProfile().streak, 8)
eq('云端更大的 muyuCount 回填本地', ritualProfile.readLocalProfile().muyuCount, 90)

resetStore()
globalThis.wx.cloud = {
  callFunction: async () => ({ result: { success: true, exists: true, profile: { streak: 6, lastLitDayKey: '2026-09-19', muyuCount: 42 } } })
}
const loadOk = await ritualProfile.loadFromCloud()
check('正常 loadFromCloud 返回 ok', loadOk.ok === true && loadOk.degraded === false)
eq('loadFromCloud 合并后 streak', loadOk.profile.streak, 6)
eq('loadFromCloud 后本地功德已回填', wishRitual.readMuyuCount(), 42)
eq('loadFromCloud 后本地点灯记录已恢复', ritualProfile.readLocalProfile().streak, 6)
delete globalThis.wx.cloud

/* ------------------------------------------------------------------ *
 * 3) 云函数：真源码加载 + stub db，跑真实分支（幂等 / 合并 / 校验 / 归属）
 * ------------------------------------------------------------------ */

/**
 * 云函数行为断言（在给定纯函数核实现上跑，便于 --selftest 注入破坏）。
 * 返回失败清单。
 */
async function cloudChecks(C) {
  const out = []
  const t = (name, cond, extra) => out.push({ name, cond: !!cond, extra })
  const cEq = (name, got, want) => t(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

  const docs = []
  const writes = []
  let openid = 'openid-a'

  // 云函数用**真实今天**做未来日校验，所以这里的日期必须相对今天算
  // （写死日期会让测试在某天之后突然变红 —— 典型的"时间炸弹"）。
  const TODAY = C.shanghaiDayKey(Date.now())
  const D1 = C.shiftDayKey(TODAY, -1)
  const D2 = C.shiftDayKey(TODAY, -2)

  const matches = (doc, where) => Object.keys(where || {}).every((k) => doc[k] === where[k])
  const db = {
    command: {},
    serverDate: () => new Date(),
    collection(name) {
      if (name !== 'wish_ritual_profiles') throw new Error('unexpected collection ' + name)
      let where = null
      let limitN = 20
      const api = {
        where(w) { where = w; return api },
        limit(n) { limitN = n; return api },
        async get() {
          return { data: docs.filter((d) => matches(d, where)).slice(0, limitN).map((d) => ({ ...d })) }
        },
        async add({ data }) {
          const _id = 'p' + (docs.length + 1)
          docs.push({ _id, ...data })
          writes.push({ op: 'add', _id })
          return { _id }
        },
        doc(id) {
          return {
            async update({ data }) {
              const hit = docs.find((d) => d._id === id)
              if (!hit) throw new Error('not exist')
              Object.assign(hit, data)
              writes.push({ op: 'update', _id: id })
              return { stats: { updated: 1 } }
            }
          }
        }
      }
      return api
    }
  }
  const sdk = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'env',
    database: () => db,
    getWXContext: () => ({ OPENID: openid })
  }

  const src = readFileSync(CLOUD_INDEX, 'utf8')
  const mod = { exports: {} }
  const localRequire = (id) => {
    if (id === 'wx-server-sdk') return sdk
    if (id === './ritualProfileCore') return C
    throw new Error('unexpected require ' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(mod, mod.exports, localRequire)
  const fn = mod.exports

  // 3a. get：没有存档
  const empty = await fn.main({ action: 'get' })
  cEq('get 无存档 success', empty.success, true)
  cEq('get 无存档 exists', empty.exists, false)
  cEq('get 无存档 streak 默认 0', empty.profile.streak, 0)
  cEq('get 无存档 lastLitDayKey 默认空', empty.profile.lastLitDayKey, '')

  // 3b. sync 首次创建
  const created = await fn.main({ action: 'sync', streak: 3, lastLitDayKey: D1, muyuCount: 12 })
  cEq('sync 首次成功', created.success, true)
  cEq('sync 首次 created', created.created, true)
  cEq('落库条数', docs.length, 1)
  cEq('落库归属当前 openid', docs[0]._openid, 'openid-a')
  cEq('落库 streak', docs[0].streak, 3)
  cEq('落库 muyuCount', docs[0].muyuCount, 12)
  cEq('落库 version', docs[0].version, 1)
  t('落库带 createTime/updateTime', !!docs[0].createTime && !!docs[0].updateTime)

  // 3c. 幂等：同一份输入重复调用 → 结果一致且不再写库
  const again = await fn.main({ action: 'sync', streak: 3, lastLitDayKey: D1, muyuCount: 12 })
  cEq('重复 sync success', again.success, true)
  cEq('重复 sync changed=false（幂等，不写库）', again.changed, false)
  cEq('重复 sync 后写入次数仍为 1', writes.length, 1)
  cEq('重复 sync 后 streak 未变', docs[0].streak, 3)
  cEq('重复 sync 后 muyuCount 未变', docs[0].muyuCount, 12)

  // 3d. 合并：云端更大时不被改小
  const lower = await fn.main({ action: 'sync', streak: 1, lastLitDayKey: D2, muyuCount: 2 })
  cEq('较小输入不改小已存档 streak', docs[0].streak, 3)
  cEq('较小输入不改小已存档 muyuCount', docs[0].muyuCount, 12)
  cEq('较小输入 changed=false', lower.changed, false)
  cEq('较小输入不写库', writes.length, 1)

  // 3e. 合并：更大的输入被接受
  const higher = await fn.main({ action: 'sync', streak: 4, lastLitDayKey: TODAY, muyuCount: 20 })
  cEq('更大输入 changed=true', higher.changed, true)
  cEq('更大输入更新 streak', docs[0].streak, 4)
  cEq('更大输入更新 muyuCount', docs[0].muyuCount, 20)
  cEq('更大输入更新 lastLitDayKey', docs[0].lastLitDayKey, TODAY)

  // 3f. 服务端校验：拒绝不可能的值，且不落任何字段
  const writesBefore = writes.length
  const neg = await fn.main({ action: 'sync', streak: -1 })
  cEq('负 streak 被拒', neg.success, false)
  cEq('负 streak 返回 OUT_OF_RANGE', neg.code, 'OUT_OF_RANGE')
  cEq('负 streak 不写库', writes.length, writesBefore)
  const future = await fn.main({ action: 'sync', lastLitDayKey: '2099-01-01' })
  cEq('未来日期被拒', future.success, false)
  cEq('未来日期返回 FUTURE_DAY_KEY', future.code, 'FUTURE_DAY_KEY')
  const over = await fn.main({ action: 'sync', muyuCount: 99999999 })
  cEq('超绝对上界被拒', over.success, false)
  cEq('超绝对上界返回 OUT_OF_RANGE', over.code, 'OUT_OF_RANGE')

  // 3g. 跳变闸：1 秒内涨 5000 次功德 → 拒绝；把上次改动时间推回 1 小时 → 接受
  docs[0].updateTime = new Date(Date.now() - 1000)
  const writesBeforeJump = writes.length
  const jump = await fn.main({ action: 'sync', streak: 4, lastLitDayKey: TODAY, muyuCount: 30000 })
  cEq('功德单次跳变过大被拒', jump.success, false)
  cEq('跳变返回 MUYU_JUMP', jump.code, 'MUYU_JUMP')
  cEq('跳变拒绝时不写库（连 updateTime 都不推进）', writes.length, writesBeforeJump)
  cEq('跳变拒绝后档案未被污染', docs[0].muyuCount, 20)
  docs[0].updateTime = new Date(Date.now() - 3600 * 1000)
  const jumped = await fn.main({ action: 'sync', streak: 4, lastLitDayKey: TODAY, muyuCount: 30000 })
  cEq('更长窗口内同一份输入被接受（暂缓而非丢弃）', jumped.success, true)
  cEq('更长窗口后 muyuCount 落地', docs[0].muyuCount, 30000)

  // 3h. 归属隔离：另一个 openid 看不到 openid-a 的档案
  openid = 'openid-b'
  const other = await fn.main({ action: 'get' })
  cEq('他人 get 不到他人档案（exists=false）', other.exists, false)
  const otherSync = await fn.main({ action: 'sync', streak: 1, lastLitDayKey: TODAY, muyuCount: 1 })
  cEq('他人 sync 新建自己的档案', otherSync.success, true)
  cEq('集合里两条档案分属不同 openid', docs.length, 2)
  t('归属均取服务端 openid', docs[0]._openid === 'openid-a' && docs[1]._openid === 'openid-b')

  // 3i. 边界：未知 action / 未登录
  openid = 'openid-a'
  const unknown = await fn.main({ action: 'nope' })
  cEq('未知 action 返回失败', unknown.success, false)
  openid = ''
  const noLogin = await fn.main({ action: 'get' })
  cEq('无 openid 返回失败', noLogin.success, false)
  cEq('无 openid 返回 NO_OPENID', noLogin.code, 'NO_OPENID')
  openid = 'openid-a'

  return out
}

const realCloudFailures = await cloudChecks(coreCopy) // 用云函数自己的副本，顺便证明副本真能跑
record(realCloudFailures, '[cloud] ')
check('云函数行为零失败（--selftest 的对照）', realCloudFailures.every((r) => r.cond), `${realCloudFailures.filter((r) => !r.cond).length} 条失败`)

/* ------------------------------------------------------------------ *
 * 4) --selftest：证明上面的断言**会失败**（不是恒真）
 * ------------------------------------------------------------------ */

if (process.argv.includes('--selftest')) {
  const brokenMerge = coreChecks({ ...core, mergeProfiles: () => ({ streak: 0, lastLitDayKey: '', muyuCount: 0 }) })
  check('[selftest] mergeProfiles 会被纯函数断言检出', brokenMerge.some((r) => !r.cond))

  const brokenValidate = coreChecks({ ...core, validateProfileInput: (raw) => ({ ok: true, profile: { streak: raw && raw.streak, lastLitDayKey: '', muyuCount: 0 } }) })
  check('[selftest] 去掉取值校验 会被纯函数断言检出', brokenValidate.some((r) => !r.cond))

  const brokenJump = coreChecks({ ...core, checkMonotonicJump: () => ({ ok: true }) })
  check('[selftest] 去掉跳变闸 会被纯函数断言检出', brokenJump.some((r) => !r.cond))

  const brokenCloud = await cloudChecks({ ...coreCopy, validateProfileInput: () => ({ ok: true, profile: { streak: 0, lastLitDayKey: '', muyuCount: 0 } }) })
  check('[selftest] 云函数侧去掉校验会被行为断言检出', brokenCloud.some((r) => !r.cond))

  const brokenCloudMerge = await cloudChecks({ ...coreCopy, mergeProfiles: (l, r) => coreCopy.pickProfile(r) })
  check('[selftest] 云函数侧"整份取新"（而非逐字段取优）会被行为断言检出', brokenCloudMerge.some((r) => !r.cond))

  check('[selftest] 文件同源判据在内容不同时报 false', isIdenticalText(coreText, coreText + '\n// drift') === false)

  const brokenIdempotent = await cloudChecks({
    ...coreCopy,
    sameProfile: () => false // 每次调用都当作"有变化" → 幂等断言必须失败
  })
  check('[selftest] 破坏"无变化不写库"会被幂等断言检出', brokenIdempotent.some((r) => !r.cond))
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

const mode = process.argv.includes('--selftest') ? '（含 --selftest）' : ''
console.log(`\ntest-ritual-profile${mode}: ${passed} passed, ${failed} failed`)
if (failed) {
  console.log('\n失败项：')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('OK')
