#!/usr/bin/env node
/**
 * 工作通知声音（需求 #29）—— 资产 / 语料 / 接线 / 逻辑 四向守卫
 *
 * 为什么需要它：这个功能有四类东西必须永远对齐，而它们分散在四个地方：
 *   ① 语料清单  `utils/workNoticeCatalog.js`（文案 + 角色 + 计数来源）
 *   ② 音频资产  `subpackages/manager/assets/audio/work-notice/*.mp3` + `manifest.json`
 *   ③ 页面接线  工作台 hub / 标本师工作台（`syncWorkNoticeVoice` + 组件注册）
 *   ④ 判定逻辑  `utils/workNoticeVoice.js` 的 `diffNoticeSnapshot`（只播新增）
 * 任何一处漏改都不会报错，只会「安静地不响」或「每次都响」——正是最难发现的那类故障。
 *
 * 用法：
 *   node miniprogram/scripts/check-work-notice-voice.cjs
 *   node miniprogram/scripts/check-work-notice-voice.cjs --selftest   # 证明每条检查都会失败
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const MP = path.join(ROOT, 'miniprogram')
const CATALOG_FILE = path.join(MP, 'utils', 'workNoticeCatalog.js')
const VOICE_FILE = path.join(MP, 'utils', 'workNoticeVoice.js')
const AUDIO_DIR = path.join(MP, 'subpackages', 'manager', 'assets', 'audio', 'work-notice')
const MANIFEST_FILE = path.join(AUDIO_DIR, 'manifest.json')
const HUB_JS = path.join(MP, 'subpackages', 'manager', 'manager', 'managerPageConfig.js')
const HUB_JSON = path.join(MP, 'subpackages', 'manager', 'manager', 'index.json')
const HUB_WXML = path.join(MP, 'subpackages', 'manager', 'manager', 'index.wxml')
const ARTISAN_JS = path.join(MP, 'subpackages', 'extra', 'artisan', 'index.js')
const ARTISAN_JSON = path.join(MP, 'subpackages', 'extra', 'artisan', 'index.json')
const ARTISAN_WXML = path.join(MP, 'subpackages', 'extra', 'artisan', 'index.wxml')
const COMPONENT_DIR = path.join(MP, 'subpackages', 'manager', 'components', 'WorkNoticeVoice')

const failures = []
const passes = []

function check(name, ok, detail) {
  if (ok) passes.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// ─────────────────────────── 载入被测模块（CJS 求值） ───────────────────────────
/**
 * 小程序侧是 CommonJS，而仓库根 package.json 是 type:module —— 直接 require 会被当 ESM。
 * 这里按 CJS 求值，并让相对 require 走同一套求值（引擎 require 了语料清单）。
 */
function loadMiniProgramCjs(file, cache = {}) {
  const abs = path.resolve(file)
  if (cache[abs]) return cache[abs].exports
  const src = fs.readFileSync(abs, 'utf8')
  const mod = { exports: {} }
  cache[abs] = mod
  const dir = path.dirname(abs)
  const localRequire = (spec) => {
    if (!spec.startsWith('.')) return require(spec)
    const target = path.resolve(dir, spec.endsWith('.js') ? spec : `${spec}.js`)
    return loadMiniProgramCjs(target, cache)
  }
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', src)
  fn(mod, mod.exports, localRequire, abs, dir)
  return mod.exports
}

// ─────────────────────────── 检查 1：清单自身 ───────────────────────────
const KNOWN_ROLES = ['super_admin', 'store_manager', 'store_staff', 'specimen_artisan']

function catalogProblems(entries) {
  const problems = []
  const seen = {}
  entries.forEach((t) => {
    const who = t && t.type ? t.type : '(无 type)'
    if (!t || !t.type) problems.push('存在没有 type 的条目')
    if (seen[who]) problems.push(`${who}: type 重复`)
    seen[who] = true
    if (!String(t.text || '').trim()) problems.push(`${who}: 文案为空`)
    if (!/\.mp3$/.test(String(t.file || ''))) problems.push(`${who}: file 不是 .mp3`)
    if (!(Number(t.priority) > 0)) problems.push(`${who}: priority 非法`)
    if (!Array.isArray(t.roles) || !t.roles.length) problems.push(`${who}: roles 为空`)
    else {
      t.roles.forEach((r) => {
        if (KNOWN_ROLES.indexOf(r) === -1) problems.push(`${who}: 未知角色 ${r}`)
      })
    }
    if (!t.previewOnly && !String(t.source || '').trim()) problems.push(`${who}: 缺少计数来源 source`)
    if (String(t.text || '').length > 20) problems.push(`${who}: 文案过长（${String(t.text).length} 字），播报会拖沓`)
  })
  return problems
}

// ─────────────────────────── 检查 2：资产一致性 ───────────────────────────
function assetProblems(catalog, manifest, listDir, statSize) {
  const problems = []
  const entries = catalog.listAudioEntries()
  const rec = (manifest && manifest.entries) || {}
  const wanted = {}
  entries.forEach((t) => {
    wanted[t.file] = true
    const r = rec[t.type]
    if (!r) {
      problems.push(`${t.type}: manifest 未登记（跑 npm run tts:work-notice）`)
      return
    }
    if (r.file !== t.file) problems.push(`${t.type}: manifest 文件名 ${r.file} ≠ 清单 ${t.file}`)
    if (!/^[0-9a-f]{16}$/.test(String(r.textHash || ''))) problems.push(`${t.type}: manifest 缺 textHash`)
    if (Number(r.bytes) !== Number(statSize(t.file))) {
      problems.push(`${t.type}: 音频体积与 manifest 不一致（清单/音频之一被改过）`)
    }
  })
  listDir().forEach((f) => {
    if (f === 'manifest.json') return
    if (!wanted[f]) problems.push(`存在清单里没有的音频：${f}（删除或补登记）`)
  })
  return problems
}

/** manifest 的 textHash 必须与当前文案一致（改了文案没重录 = 播出来的和写的不一样） */
function textHashProblems(catalog, manifest, hashFn) {
  const problems = []
  const entries = catalog.listAudioEntries()
  const rec = (manifest && manifest.entries) || {}
  entries.forEach((t) => {
    const r = rec[t.type]
    if (!r) return
    if (r.textHash !== hashFn(t.text)) problems.push(`${t.type}: 文案改了但音频没重录`)
    if (String(r.text || '') !== String(t.text || '')) problems.push(`${t.type}: manifest 里的文案与清单不一致`)
  })
  return problems
}

// ─────────────────────────── 检查 3：页面接线 ───────────────────────────
function hubWiringProblem(js) {
  // 声音判定必须在「全部待办落地后」那一次调用里：即 prefetchHubTodoBadges 的 finally 内
  const m = js.match(/prefetchHubTodoBadges\(options = \{\}\)[\s\S]*?\n {2}\},/)
  if (!m) return '找不到 prefetchHubTodoBadges'
  if (m[0].indexOf('this.syncWorkNoticeVoice()') === -1) {
    return 'prefetchHubTodoBadges 完成时没有调用 syncWorkNoticeVoice（漏了就没声音）'
  }
  if (js.indexOf('syncWorkNoticeVoice() {') === -1) return '缺少 syncWorkNoticeVoice 实现'
  if (js.indexOf("require('../../../utils/workNoticeVoice')") === -1) return '未引入 workNoticeVoice'
  if (js.indexOf("require('../../../utils/workNoticeCatalog')") === -1) return '未引入 workNoticeCatalog'
  return ''
}

function artisanWiringProblem(js) {
  if (js.indexOf('syncWorkNoticeVoice()') === -1) return '标本师工作台未接入声音'
  if (js.indexOf('statsOk') === -1) return '标本师工作台未在统计成功后再生效（半截计数会误报）'
  if (js.indexOf("require('../../../utils/workNoticeVoice')") === -1) return '未引入 workNoticeVoice'
  return ''
}

function jsonRegistersComponent(text) {
  try {
    const j = JSON.parse(text)
    return !!(j.usingComponents && j.usingComponents['work-notice-voice'])
  } catch (e) {
    return false
  }
}

/**
 * 声音 chip 必须是**纯图标**：它是头部右侧的第二枚元素，一旦带「声音/静音」文字，
 * 窄屏上两个字会被挤成竖排，把日期徽标顶下去 —— 2026-09-16 真机截图实测到的形态。
 */
function iconOnlyProblem(wxml, wxss) {
  if (/wnv-text/.test(wxml) || /wnv-text/.test(wxss)) return 'wxml/wxss 里仍有 wnv-text（文字会换行挤行）'
  if (/>\s*(声音|静音)\s*</.test(wxml)) return 'wxml 里直接写了「声音/静音」文字'
  if (!/wnv-icon/.test(wxml)) return 'wxml 缺少 wnv-icon（铃铛图标）'
  if (!/\{\{\s*enabled\s*\?/.test(wxml)) return 'wxml 未按开关状态切换图标（🔔/🔕）'
  return ''
}

// ─────────────────────────── 检查 4：判定逻辑（纯函数） ───────────────────────────
/** 用被测 diff 跑一组固定用例；返回失败描述数组（空 = 全过） */
function diffCaseFailures(diffFn, catalog) {
  const out = []
  const snap = (o) => o
  const A = 'order'
  const B = 'workOrder'

  // ① 无基线 → 只建基线不播
  let r = diffFn(null, { [A]: { count: 3 } }, { allowed: [A] })
  if (!r.baseline || r.announce.length) out.push('无基线时应只建基线不出声')

  // ② 计数上涨 → 播
  r = diffFn({ [A]: { count: 1 } }, { [A]: { count: 2 } }, { allowed: [A] })
  if (r.announce.join() !== A) out.push(`计数上涨应播 ${A}，实际 ${r.announce.join() || '无'}`)

  // ③ 计数不变 → 不播
  r = diffFn({ [A]: { count: 2 } }, { [A]: { count: 2 } }, { allowed: [A] })
  if (r.announce.length) out.push('计数不变时不该播')

  // ④ 计数下降（处理掉一条）→ 不播
  r = diffFn({ [A]: { count: 2 } }, { [A]: { count: 1 } }, { allowed: [A] })
  if (r.announce.length) out.push('计数下降时不该播')

  // ⑤ id 差集：读了 1 条又来 1 条，计数不变但确实有新单
  r = diffFn({ [A]: { count: 1, ids: ['m1'] } }, { [A]: { count: 1, ids: ['m1', 'm2'] } }, { allowed: [A] })
  if (r.announce.join() !== A) out.push('id 差集有新增时应播（计数法会漏）')

  // ⑥ id 完全相同 → 不播
  r = diffFn({ [A]: { count: 1, ids: ['m1'] } }, { [A]: { count: 1, ids: ['m1'] } }, { allowed: [A] })
  if (r.announce.length) out.push('id 未变时不该播')

  // ⑦ 角色过滤：不在 allowed 里的类型再涨也不播
  r = diffFn({ [B]: { count: 0 } }, { [B]: { count: 5 } }, { allowed: [A] })
  if (r.announce.length) out.push('不属于该角色的类型不该播')

  // ⑧ 排序按 priority（order=10 先于 workOrder=30）
  r = diffFn(
    { [A]: { count: 0 }, [B]: { count: 0 } },
    { [A]: { count: 1 }, [B]: { count: 1 } },
    { allowed: [B, A] }
  )
  if (r.announce.join() !== `${A},${B}`) out.push(`应按 priority 排序，实际 ${r.announce.join()}`)

  // ⑨ 上限截断
  r = diffFn(
    { order: { count: 0 }, workOrder: { count: 0 }, aftersale: { count: 0 }, booking: { count: 0 } },
    { order: { count: 1 }, workOrder: { count: 1 }, aftersale: { count: 1 }, booking: { count: 1 } },
    { allowed: ['order', 'workOrder', 'aftersale', 'booking'], max: 3 }
  )
  if (r.announce.length !== 3) out.push(`应截断到 3 条，实际 ${r.announce.length}`)

  // ⑩ 清单新增的类型（prev 没有 next 有）→ 先建基线，不当成新增
  r = diffFn({ [A]: { count: 0 } }, { [A]: { count: 0 }, [B]: { count: 9 } }, { allowed: [A, B] })
  if (r.announce.length) out.push('清单新加的类型首次出现不该立刻播')

  // ⑪ 脏数据不炸
  try {
    diffFn({ [A]: { count: 'x' } }, { [A]: { count: null, ids: 'nope' } }, { allowed: [A, 'ghost'] })
  } catch (e) {
    out.push(`脏快照不应抛异常：${e.message}`)
  }

  // ⑫ 快照构造：点号路径 / 数组长度 / 非法值
  const snapData = {
    newOrderUnreadCount: 2,
    newOrderUnreadIds: ['m1', 'm2'],
    opsOrderCounts: { aftersale: 3 },
    supportTickets: [{}, {}],
    framerRecruitApps: null
  }
  const built = catalog.buildSnapshot(snapData, 'super_admin')
  if (built.order.count !== 2 || built.order.ids.join() !== 'm1,m2') out.push('buildSnapshot 未按点号路径取计数/ids')
  if (built.aftersale.count !== 3) out.push('buildSnapshot 未支持点号路径（opsOrderCounts.aftersale）')
  if (built.workOrder.count !== 2) out.push('buildSnapshot 未把数组换算成长度')
  if (built.recruit.count !== 0) out.push('buildSnapshot 未把非法值归零')

  // ⑬ 角色覆盖：需求点名的三类角色都要有可播类型
  const byRole = {}
  catalog.listTypes().forEach((t) => (t.roles || []).forEach((r) => { byRole[r] = (byRole[r] || 0) + 1 }))
  ;['super_admin', 'store_manager', 'specimen_artisan'].forEach((r) => {
    if (!byRole[r]) out.push(`角色 ${r} 没有任何可播类型（需求点名要覆盖）`)
  })

  return out
}

// ─────────────────────────── 跑检查 ───────────────────────────
function catalogHash(text) {
  return require('crypto').createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16)
}

function collect(deps) {
  const d = deps || {}
  const catalog = d.catalog || loadMiniProgramCjs(CATALOG_FILE)
  const voice = d.voice || loadMiniProgramCjs(VOICE_FILE)
  const manifest = d.manifest !== undefined ? d.manifest : JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  const listDir = d.listDir || (() => fs.readdirSync(AUDIO_DIR))
  const statSize = d.statSize || ((f) => fs.statSync(path.join(AUDIO_DIR, f)).size)
  const read = d.read || ((f) => fs.readFileSync(f, 'utf8'))

  // 1. 清单自身
  const cp = catalogProblems(catalog.listAudioEntries())
  check('语料清单结构合法（type/文案/文件/角色/优先级/来源）', cp.length === 0, cp.slice(0, 3).join(' / '))

  // 2. 资产
  const ap = assetProblems(catalog, manifest, listDir, statSize)
  check('音频资产与 manifest 一一对应（含体积一致、无孤儿文件）', ap.length === 0, ap.slice(0, 3).join(' / '))
  const tp = textHashProblems(catalog, manifest, d.hashFn || catalogHash)
  check('音频文案与清单同源（改文案必须重录）', tp.length === 0, tp.slice(0, 3).join(' / '))
  check('音频目录随包发货（manager 分包内）', fs.existsSync(AUDIO_DIR) && fs.existsSync(MANIFEST_FILE), AUDIO_DIR)
  check('组件四件套齐备（js/json/wxml/wxss）',
    ['index.js', 'index.json', 'index.wxml', 'index.wxss'].every((f) => fs.existsSync(path.join(COMPONENT_DIR, f))),
    COMPONENT_DIR)

  // 3. 接线
  check('工作台 hub：待办全部落地后判定声音', hubWiringProblem(read(HUB_JS)) === '', hubWiringProblem(read(HUB_JS)))
  check('标本师工作台：统计成功后判定声音', artisanWiringProblem(read(ARTISAN_JS)) === '', artisanWiringProblem(read(ARTISAN_JS)))
  check('hub 注册了 work-notice-voice 组件', jsonRegistersComponent(read(HUB_JSON)))
  check('标本师工作台注册了 work-notice-voice 组件', jsonRegistersComponent(read(ARTISAN_JSON)))
  check('两个页面都摆了组件', read(HUB_WXML).indexOf('<work-notice-voice') !== -1 && read(ARTISAN_WXML).indexOf('<work-notice-voice') !== -1)
  const iconProblem = iconOnlyProblem(read(path.join(COMPONENT_DIR, 'index.wxml')), read(path.join(COMPONENT_DIR, 'index.wxss')))
  check('声音 chip 为纯图标（不放文字，避免头部挤行）', iconProblem === '', iconProblem)

  // 4. 判定逻辑
  const df = diffCaseFailures(voice.diffNoticeSnapshot, catalog)
  check('增量判定正确（基线/上涨/id 差集/排序/截断/角色过滤/脏数据）', df.length === 0, df.slice(0, 3).join(' / '))

  // 5. 无平台环境下引擎不许抛（Node 里 wx 不存在）
  let engineOk = true
  let engineDetail = ''
  try {
    if (voice.isEnabled() !== true) { engineOk = false; engineDetail = '默认应为开启' }
    if (voice.isSupported() !== false) { engineOk = false; engineDetail = 'Node 下不应报告音频可用' }
    const r1 = voice.announce(catalog.buildSnapshot({ newOrderUnreadCount: 1 }, 'super_admin'), 'super_admin')
    if (!r1 || r1.baseline !== true) { engineOk = false; engineDetail = '首次调用应只建基线' }
    const r2 = voice.announce(catalog.buildSnapshot({ newOrderUnreadCount: 2 }, 'super_admin'), 'super_admin')
    if (!r2 || !Array.isArray(r2.announced)) { engineOk = false; engineDetail = '第二次调用应返回播报列表' }
    voice.preview()
    voice.stop()
    voice.destroy()
    voice.setEnabled(true)
  } catch (e) {
    engineOk = false
    engineDetail = `无 wx 环境下抛异常：${e.message}`
  }
  check('引擎在无 wx 环境下静默降级（不抛、默认开、首次只建基线）', engineOk, engineDetail)
}

// ─────────────────────────── 自检：证明每条检查会失败 ───────────────────────────
function runSelfTest() {
  console.log('自检：用「被破坏的输入」证明每条检查确实会失败\n')
  const catalog = loadMiniProgramCjs(CATALOG_FILE)
  const voice = loadMiniProgramCjs(VOICE_FILE)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  const cases = [
    ['音频文件缺失', () => assetProblems(catalog, manifest, () => ['manifest.json'], () => 0).length > 0],
    ['manifest 未登记类型', () => assetProblems(catalog, { entries: {} }, () => [], () => 0).length > 0],
    ['音频体积与登记不符（音频被替换）',
      () => assetProblems(catalog, manifest, () => Object.keys(manifest.entries).map((k) => manifest.entries[k].file), () => -1).length > 0],
    ['存在清单没有的孤儿音频',
      () => assetProblems(catalog, manifest, () => ['manifest.json', 'ghost.mp3'], (f) => (manifest.entries.order && f === 'order.mp3' ? manifest.entries.order.bytes : 0)).length > 0],
    ['改了文案没重录（hash 不一致）',
      () => textHashProblems({ listAudioEntries: () => [{ type: 'order', text: '改过的文案' }] }, manifest, catalogHash).length > 0],
    ['清单出现重复 type',
      () => catalogProblems([{ type: 'x', text: 'a', file: 'a.mp3', priority: 1, roles: ['super_admin'], source: 's' },
        { type: 'x', text: 'b', file: 'b.mp3', priority: 2, roles: ['super_admin'], source: 's' }]).length > 0],
    ['清单出现未知角色',
      () => catalogProblems([{ type: 'x', text: 'a', file: 'a.mp3', priority: 1, roles: ['ghost_role'], source: 's' }]).length > 0],
    ['清单缺计数来源',
      () => catalogProblems([{ type: 'x', text: 'a', file: 'a.mp3', priority: 1, roles: ['super_admin'], source: '' }]).length > 0],
    ['hub 漏掉「待办落地后判定」',
      () => hubWiringProblem('prefetchHubTodoBadges(options = {}) {\n    return Promise.resolve()\n  },') !== ''],
    ['标本师工作台漏掉成功判断（半截计数会误报）',
      () => artisanWiringProblem("require('../../../utils/workNoticeVoice')\nthis.syncWorkNoticeVoice()") !== ''],
    ['页面 json 未注册组件', () => !jsonRegistersComponent('{"usingComponents":{}}')],
    ['声音 chip 又被加回文字（会挤成竖排）',
      () => iconOnlyProblem('<view class="wnv"><text class="wnv-icon">🔔</text><text class="wnv-text">声音</text></view>', '.wnv-text{font-size:22rpx}') !== ''],
    ['声音 chip 写死了文字',
      () => iconOnlyProblem('<view class="wnv"><text class="wnv-icon">🔔</text><text>声音</text></view>', '') !== ''],
    ['声音 chip 丢了铃铛图标',
      () => iconOnlyProblem('<view class="wnv"><text class="wnv-text">声音</text></view>', '') !== ''],
    ['diff 被改成「永远不播」', () => diffCaseFailures(() => ({ announce: [], next: {}, baseline: false }), catalog).length > 0],
    ['diff 被改成「永远播全部」（首次也播）',
      () => diffCaseFailures((p, n, o) => ({ announce: (o && o.allowed) || [], next: n, baseline: false }), catalog).length > 0],
    ['diff 不按 priority 排序',
      () => diffCaseFailures((p, n, o) => {
        const allowed = (o && o.allowed) || []
        if (!p) return { announce: [], next: n, baseline: true }
        const hits = allowed.filter((t) => ((n[t] || {}).count || 0) > ((p[t] || {}).count || 0)).reverse()
        return { announce: hits, next: n, baseline: false }
      }, catalog).length > 0]
  ]

  let allDetected = true
  cases.forEach(([label, probe]) => {
    let detected = false
    try {
      detected = probe() === true
    } catch (e) {
      detected = false
    }
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}`)
  })
  console.log()
  if (!allDetected) {
    console.error('自检失败：存在漏检用例，检查本身不可信。')
    process.exit(1)
  }
  console.log(`自检通过：${cases.length} 个破坏用例均被检出。\n`)
}

const selftest = process.argv.includes('--selftest')
if (selftest) runSelfTest()

failures.length = 0
passes.length = 0
try {
  collect()
} catch (e) {
  failures.push(`检查执行异常：${e.message}`)
}

console.log(`工作通知声音检查：${passes.length} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：语料、音频资产、页面接线、增量判定、无平台降级均一致。')
