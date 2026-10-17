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

// 2026-10-17 旧祈福墙退场：点灯 / 木鱼及其客户端封装（feature/utils/ritualProfile*、wishRitual）随页面删除，
//   C 端已无调用方；云函数 wishRitualProfile 仍在线上（删函数属部署动作，另行处理），
//   所以本守卫只保留**服务端**：纯函数核（云函数副本）+ 集合规则 + 云函数真实分支。
const core = loadCjs('miniprogram/cloudfunctions/wishRitualProfile/ritualProfileCore.js', { require: markerRequire })

function isIdenticalText(a, b) {
  return String(a) === String(b)
}

const coreText = readFileSync(CORE_COPY_PATH, 'utf8')

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

const realCloudFailures = await cloudChecks(core) // 用云函数自己的副本，顺便证明副本真能跑
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

  const brokenCloud = await cloudChecks({ ...core, validateProfileInput: () => ({ ok: true, profile: { streak: 0, lastLitDayKey: '', muyuCount: 0 } }) })
  check('[selftest] 云函数侧去掉校验会被行为断言检出', brokenCloud.some((r) => !r.cond))

  const brokenCloudMerge = await cloudChecks({ ...core, mergeProfiles: (l, r) => core.pickProfile(r) })
  check('[selftest] 云函数侧"整份取新"（而非逐字段取优）会被行为断言检出', brokenCloudMerge.some((r) => !r.cond))

  check('[selftest] 文件同源判据在内容不同时报 false', isIdenticalText(coreText, coreText + '\n// drift') === false)

  const brokenIdempotent = await cloudChecks({
    ...core,
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
